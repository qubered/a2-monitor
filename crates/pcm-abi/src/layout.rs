use std::error::Error;
use std::fmt::{self, Display, Formatter};

pub const ABI_MAJOR: u16 = 0;
pub const ABI_MINOR: u16 = 1;
const MAGIC: [u8; 8] = *b"A2PCM\0\0\0";
const ENDIAN_MARKER: u32 = 0x0102_0304;
const DESCRIPTOR_BYTES: usize = 128;
const SLOT_HEADER_BYTES: usize = 64;
const MINIMUM_PAGE_SIZE: u32 = 4096;
const MAXIMUM_CHANNELS: u16 = 128;
const MAXIMUM_FRAMES_PER_SLOT: u16 = 4096;
const MAXIMUM_CAPACITY: u32 = 4096;
const MAXIMUM_MAPPING_BYTES: usize = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u16)]
pub enum SampleFormat {
    F32 = 1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PcmAbiConfig {
    pub node_boot_id: [u8; 16],
    pub mapping_generation: u64,
    pub capture_epoch: u64,
    pub sample_format: SampleFormat,
    pub channels: u16,
    pub frames_per_slot: u16,
    pub capacity: u32,
    pub page_size: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PcmLayout {
    pub descriptor_offset: usize,
    pub descriptor_length: usize,
    pub producer_state_offset: usize,
    pub producer_state_length: usize,
    pub consumer_state_offset: usize,
    pub consumer_state_length: usize,
    pub slots_offset: usize,
    pub slots_length: usize,
    pub producer_diagnostics_offset: usize,
    pub producer_diagnostics_length: usize,
    pub consumer_diagnostics_offset: usize,
    pub consumer_diagnostics_length: usize,
    pub slot_stride: usize,
    pub total_length: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PcmDescriptor {
    pub config: PcmAbiConfig,
    pub layout: PcmLayout,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AbiError {
    InvalidPageSize,
    ZeroGeneration,
    ZeroEpoch,
    ZeroChannels,
    ZeroFramesPerSlot,
    ZeroCapacity,
    TooManyChannels,
    TooManyFramesPerSlot,
    TooManySlots,
    MappingTooLarge,
    AllocationFailed,
    SizeOverflow,
    BufferTooSmall,
    InvalidMagic,
    IncompatibleVersion,
    InvalidEndian,
    InvalidSampleFormat,
    InvalidLayout,
}

impl Display for AbiError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "invalid PCM ABI: {self:?}")
    }
}

impl Error for AbiError {}

impl PcmLayout {
    pub fn checked(config: PcmAbiConfig) -> Result<Self, AbiError> {
        validate_config(config)?;
        let page = config.page_size as usize;
        let samples = usize::from(config.channels)
            .checked_mul(usize::from(config.frames_per_slot))
            .ok_or(AbiError::SizeOverflow)?;
        let sample_bytes = samples
            .checked_mul(size_of::<f32>())
            .ok_or(AbiError::SizeOverflow)?;
        let slot_stride = align_up(
            SLOT_HEADER_BYTES
                .checked_add(sample_bytes)
                .ok_or(AbiError::SizeOverflow)?,
            64,
        )?;
        let raw_slots = slot_stride
            .checked_mul(config.capacity as usize)
            .ok_or(AbiError::SizeOverflow)?;
        let slots_length = align_up(raw_slots, page)?;
        let slots_offset = page.checked_mul(3).ok_or(AbiError::SizeOverflow)?;
        let producer_diagnostics_offset = slots_offset
            .checked_add(slots_length)
            .ok_or(AbiError::SizeOverflow)?;
        let consumer_diagnostics_offset = producer_diagnostics_offset
            .checked_add(page)
            .ok_or(AbiError::SizeOverflow)?;
        let total_length = consumer_diagnostics_offset
            .checked_add(page)
            .ok_or(AbiError::SizeOverflow)?;
        if total_length > MAXIMUM_MAPPING_BYTES {
            return Err(AbiError::MappingTooLarge);
        }
        Ok(Self {
            descriptor_offset: 0,
            descriptor_length: page,
            producer_state_offset: page,
            producer_state_length: page,
            consumer_state_offset: page.checked_mul(2).ok_or(AbiError::SizeOverflow)?,
            consumer_state_length: page,
            slots_offset,
            slots_length,
            producer_diagnostics_offset,
            producer_diagnostics_length: page,
            consumer_diagnostics_offset,
            consumer_diagnostics_length: page,
            slot_stride,
            total_length,
        })
    }
}

pub fn initialize_descriptor(
    destination: &mut [u8],
    config: PcmAbiConfig,
) -> Result<PcmDescriptor, AbiError> {
    let layout = PcmLayout::checked(config)?;
    if destination.len() < layout.descriptor_length {
        return Err(AbiError::BufferTooSmall);
    }
    destination[..layout.descriptor_length].fill(0);
    destination[0..8].copy_from_slice(&MAGIC);
    put_u16(destination, 8, ABI_MAJOR);
    put_u16(destination, 10, ABI_MINOR);
    put_u32(destination, 12, ENDIAN_MARKER);
    destination[16..32].copy_from_slice(&config.node_boot_id);
    put_u64(destination, 32, config.mapping_generation);
    put_u64(destination, 40, config.capture_epoch);
    put_u16(destination, 48, config.sample_format as u16);
    put_u16(destination, 50, config.channels);
    put_u16(destination, 52, config.frames_per_slot);
    put_u32(destination, 56, config.capacity);
    put_u32(destination, 60, config.page_size);
    put_u64(destination, 64, layout.producer_state_offset as u64);
    put_u64(destination, 72, layout.consumer_state_offset as u64);
    put_u64(destination, 80, layout.slots_offset as u64);
    put_u64(destination, 88, layout.producer_diagnostics_offset as u64);
    put_u64(destination, 96, layout.consumer_diagnostics_offset as u64);
    put_u64(destination, 104, layout.slot_stride as u64);
    put_u64(destination, 112, layout.total_length as u64);
    Ok(PcmDescriptor { config, layout })
}

pub fn decode_descriptor(source: &[u8]) -> Result<PcmDescriptor, AbiError> {
    if source.len() < DESCRIPTOR_BYTES {
        return Err(AbiError::BufferTooSmall);
    }
    if source[0..8] != MAGIC {
        return Err(AbiError::InvalidMagic);
    }
    if get_u16(source, 8) != ABI_MAJOR || get_u16(source, 10) > ABI_MINOR {
        return Err(AbiError::IncompatibleVersion);
    }
    if get_u32(source, 12) != ENDIAN_MARKER {
        return Err(AbiError::InvalidEndian);
    }
    let sample_format = match get_u16(source, 48) {
        1 => SampleFormat::F32,
        _ => return Err(AbiError::InvalidSampleFormat),
    };
    let mut node_boot_id = [0; 16];
    node_boot_id.copy_from_slice(&source[16..32]);
    let config = PcmAbiConfig {
        node_boot_id,
        mapping_generation: get_u64(source, 32),
        capture_epoch: get_u64(source, 40),
        sample_format,
        channels: get_u16(source, 50),
        frames_per_slot: get_u16(source, 52),
        capacity: get_u32(source, 56),
        page_size: get_u32(source, 60),
    };
    let layout = PcmLayout::checked(config)?;
    if source.len() < layout.descriptor_length {
        return Err(AbiError::BufferTooSmall);
    }
    let encoded = [
        get_u64(source, 64),
        get_u64(source, 72),
        get_u64(source, 80),
        get_u64(source, 88),
        get_u64(source, 96),
        get_u64(source, 104),
        get_u64(source, 112),
    ];
    let expected = [
        layout.producer_state_offset as u64,
        layout.consumer_state_offset as u64,
        layout.slots_offset as u64,
        layout.producer_diagnostics_offset as u64,
        layout.consumer_diagnostics_offset as u64,
        layout.slot_stride as u64,
        layout.total_length as u64,
    ];
    if encoded != expected {
        return Err(AbiError::InvalidLayout);
    }
    Ok(PcmDescriptor { config, layout })
}

fn validate_config(config: PcmAbiConfig) -> Result<(), AbiError> {
    let page = config.page_size;
    if page < MINIMUM_PAGE_SIZE || !page.is_power_of_two() {
        return Err(AbiError::InvalidPageSize);
    }
    if config.mapping_generation == 0 {
        return Err(AbiError::ZeroGeneration);
    }
    if config.capture_epoch == 0 {
        return Err(AbiError::ZeroEpoch);
    }
    if config.channels == 0 {
        return Err(AbiError::ZeroChannels);
    }
    if config.channels > MAXIMUM_CHANNELS {
        return Err(AbiError::TooManyChannels);
    }
    if config.frames_per_slot == 0 {
        return Err(AbiError::ZeroFramesPerSlot);
    }
    if config.frames_per_slot > MAXIMUM_FRAMES_PER_SLOT {
        return Err(AbiError::TooManyFramesPerSlot);
    }
    if config.capacity == 0 {
        return Err(AbiError::ZeroCapacity);
    }
    if config.capacity > MAXIMUM_CAPACITY {
        return Err(AbiError::TooManySlots);
    }
    Ok(())
}

fn align_up(value: usize, alignment: usize) -> Result<usize, AbiError> {
    value
        .checked_add(alignment - 1)
        .map(|value| value & !(alignment - 1))
        .ok_or(AbiError::SizeOverflow)
}

fn put_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn put_u64(bytes: &mut [u8], offset: usize, value: u64) {
    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn get_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(
        bytes[offset..offset + 2]
            .try_into()
            .expect("checked descriptor"),
    )
}

fn get_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("checked descriptor"),
    )
}

fn get_u64(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(
        bytes[offset..offset + 8]
            .try_into()
            .expect("checked descriptor"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(page_size: u32) -> PcmAbiConfig {
        PcmAbiConfig {
            node_boot_id: *b"node-boot-id-001",
            mapping_generation: 3,
            capture_epoch: 7,
            sample_format: SampleFormat::F32,
            channels: 64,
            frames_per_slot: 480,
            capacity: 8,
            page_size,
        }
    }

    #[test]
    fn descriptor_round_trips_exact_little_endian_fields() {
        let layout = PcmLayout::checked(config(4096)).unwrap();
        let mut bytes = vec![0xaa; layout.descriptor_length];
        let descriptor = initialize_descriptor(&mut bytes, config(4096)).unwrap();
        assert_eq!(&bytes[0..8], b"A2PCM\0\0\0");
        assert_eq!(&bytes[32..40], &3_u64.to_le_bytes());
        assert_eq!(&bytes[40..48], &7_u64.to_le_bytes());
        assert!(bytes[DESCRIPTOR_BYTES..].iter().all(|byte| *byte == 0));
        assert_eq!(decode_descriptor(&bytes), Ok(descriptor));
    }

    #[test]
    fn every_region_is_page_separated_for_supported_model_page_sizes() {
        for page_size in [4096, 16_384, 65_536] {
            let layout = PcmLayout::checked(config(page_size)).unwrap();
            for offset in [
                layout.descriptor_offset,
                layout.producer_state_offset,
                layout.consumer_state_offset,
                layout.slots_offset,
                layout.producer_diagnostics_offset,
                layout.consumer_diagnostics_offset,
                layout.total_length,
            ] {
                assert_eq!(offset % page_size as usize, 0);
            }
            assert!(
                layout.producer_diagnostics_offset >= layout.slots_offset + layout.slots_length
            );
        }
    }

    #[test]
    fn rejects_invalid_config_and_descriptor_corruption() {
        let mut invalid = config(4096);
        invalid.capture_epoch = 0;
        assert_eq!(PcmLayout::checked(invalid), Err(AbiError::ZeroEpoch));
        invalid = config(4096);
        invalid.page_size = 1000;
        assert_eq!(PcmLayout::checked(invalid), Err(AbiError::InvalidPageSize));
        invalid = config(4096);
        invalid.channels = 129;
        assert_eq!(PcmLayout::checked(invalid), Err(AbiError::TooManyChannels));
        invalid = config(4096);
        invalid.frames_per_slot = 4097;
        assert_eq!(
            PcmLayout::checked(invalid),
            Err(AbiError::TooManyFramesPerSlot)
        );
        invalid = config(4096);
        invalid.capacity = 4097;
        assert_eq!(PcmLayout::checked(invalid), Err(AbiError::TooManySlots));

        invalid = config(4096);
        invalid.channels = 128;
        invalid.frames_per_slot = 4096;
        invalid.capacity = 4096;
        assert_eq!(PcmLayout::checked(invalid), Err(AbiError::MappingTooLarge));

        let mut bytes = vec![0; 4096];
        initialize_descriptor(&mut bytes, config(4096)).unwrap();
        for (offset, expected) in [
            (0, AbiError::InvalidMagic),
            (8, AbiError::IncompatibleVersion),
            (12, AbiError::InvalidEndian),
            (48, AbiError::InvalidSampleFormat),
            (64, AbiError::InvalidLayout),
        ] {
            let mut corrupted = bytes.clone();
            corrupted[offset] ^= 0xff;
            assert_eq!(decode_descriptor(&corrupted), Err(expected));
        }
    }
}
