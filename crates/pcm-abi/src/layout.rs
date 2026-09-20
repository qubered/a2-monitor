use std::error::Error;
use std::fmt::{self, Display, Formatter};

pub const ABI_MAJOR: u16 = 0;
pub const ABI_MINOR: u16 = 2;
pub const ORDINARY_OWNERSHIP_MINOR: u16 = 2;
const MAGIC: [u8; 8] = *b"A2PCM\0\0\0";
const ENDIAN_MARKER: u32 = 0x0102_0304;
const DESCRIPTOR_BYTES: usize = 128;
pub const SLOT_HEADER_BYTES: usize = 64;
pub const PRODUCER_PUBLISHED_NEXT_OFFSET: usize = 32;
pub const PRODUCER_OVERWRITE_CLAIM_OFFSET: usize = 40;
pub const CONSUMER_CONSUMED_NEXT_OFFSET: usize = 32;
pub const CONSUMER_READ_CLAIM_OFFSET: usize = 40;
pub const PRODUCER_OVERWRITE_LOSS_PUBLISHED_NEXT_OFFSET: usize = 48;
pub const PRODUCER_DROPPED_LOSS_PUBLISHED_NEXT_OFFSET: usize = 56;
pub const CONSUMER_OVERWRITE_LOSS_CONSUMED_NEXT_OFFSET: usize = 48;
pub const CONSUMER_DROPPED_LOSS_CONSUMED_NEXT_OFFSET: usize = 56;
pub const SLOT_COMMITTED_SEQUENCE_OFFSET: usize = 0;
pub const SLOT_SOURCE_SEQUENCE_OFFSET: usize = 8;
pub const SLOT_CAPTURE_EPOCH_OFFSET: usize = 16;
pub const SLOT_FIRST_FRAME_INDEX_OFFSET: usize = 24;
pub const SLOT_MONOTONIC_CAPTURE_NS_OFFSET: usize = 32;
pub const SLOT_CUMULATIVE_SOURCE_XRUNS_OFFSET: usize = 40;
pub const SLOT_FRAME_COUNT_OFFSET: usize = 48;
pub const SLOT_CHANNEL_COUNT_OFFSET: usize = 50;
pub const SLOT_PRESENCE_FLAGS_OFFSET: usize = 52;
pub const SLOT_RESERVED_OFFSET: usize = 54;
pub const SLOT_TIMING_UNCERTAINTY_NS_OFFSET: usize = 56;
pub const SLOT_DISCONTINUITY_FLAGS_OFFSET: usize = 60;
pub const LOSS_ENTRY_BYTES: usize = 64;
pub const LOSS_COMMITTED_SEQUENCE_OFFSET: usize = 0;
pub const LOSS_KIND_OFFSET: usize = 8;
pub const LOSS_ORDERING_PUBLICATION_OFFSET: usize = 16;
pub const LOSS_CAPTURE_EPOCH_OFFSET: usize = 24;
pub const LOSS_SOURCE_SEQUENCE_OFFSET: usize = 32;
pub const LOSS_FIRST_FRAME_INDEX_OFFSET: usize = 40;
pub const LOSS_END_FRAME_INDEX_OFFSET: usize = 48;
pub const LOSS_KIND_OVERWRITTEN: u16 = 1;
pub const LOSS_KIND_DROPPED_INCOMING: u16 = 2;
pub const NO_CLAIM_SEQUENCE: u64 = u64::MAX;
const PRODUCER_MAGIC: [u8; 8] = *b"A2PPROD\0";
const CONSUMER_MAGIC: [u8; 8] = *b"A2PCON\0\0";
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
    pub loss_slots_offset: usize,
    pub dropped_loss_slots_offset: usize,
    pub loss_slots_length: usize,
    pub producer_diagnostics_offset: usize,
    pub producer_diagnostics_length: usize,
    pub consumer_diagnostics_offset: usize,
    pub consumer_diagnostics_length: usize,
    pub slot_stride: usize,
    pub loss_slot_stride: usize,
    pub total_length: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PcmDescriptor {
    pub abi_minor: u16,
    pub config: PcmAbiConfig,
    pub layout: PcmLayout,
}

impl PcmDescriptor {
    #[must_use]
    pub const fn supports_ordinary_ownership(self) -> bool {
        self.abi_minor >= ORDINARY_OWNERSHIP_MINOR
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OrdinarySlotHeader {
    pub committed_sequence: u64,
    pub source_sequence: u64,
    pub capture_epoch: u64,
    pub first_frame_index: u64,
    pub monotonic_capture_ns: Option<u64>,
    pub cumulative_source_xruns: u64,
    pub frame_count: u16,
    pub channel_count: u16,
    pub timing_uncertainty_ns: Option<u32>,
    pub discontinuity_flags: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OrdinaryLossEntry {
    pub committed_sequence: u64,
    /// Overwritten publication sequence, or the publication frontier preceding a dropped input.
    pub ordering_publication: u64,
    pub capture_epoch: u64,
    pub source_sequence: u64,
    pub first_frame_index: u64,
    pub end_frame_index: u64,
    pub kind: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AbiError {
    InvalidPageSize,
    ZeroBootId,
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
        Self::checked_for_minor(config, ABI_MINOR)
    }

    pub(crate) fn checked_for_minor(
        config: PcmAbiConfig,
        abi_minor: u16,
    ) -> Result<Self, AbiError> {
        validate_config(config, abi_minor >= ORDINARY_OWNERSHIP_MINOR)?;
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
        let after_slots = slots_offset
            .checked_add(slots_length)
            .ok_or(AbiError::SizeOverflow)?;
        let loss_slots_length = if abi_minor >= ORDINARY_OWNERSHIP_MINOR {
            align_up(
                LOSS_ENTRY_BYTES
                    .checked_mul(config.capacity as usize)
                    .and_then(|bytes| bytes.checked_mul(2))
                    .ok_or(AbiError::SizeOverflow)?,
                page,
            )?
        } else {
            0
        };
        let loss_slots_offset = if abi_minor >= ORDINARY_OWNERSHIP_MINOR {
            after_slots
        } else {
            0
        };
        let producer_diagnostics_offset = after_slots
            .checked_add(loss_slots_length)
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
            loss_slots_offset,
            dropped_loss_slots_offset: if abi_minor >= ORDINARY_OWNERSHIP_MINOR {
                loss_slots_offset
                    .checked_add(LOSS_ENTRY_BYTES * config.capacity as usize)
                    .ok_or(AbiError::SizeOverflow)?
            } else {
                0
            },
            loss_slots_length,
            producer_diagnostics_offset,
            producer_diagnostics_length: page,
            consumer_diagnostics_offset,
            consumer_diagnostics_length: page,
            slot_stride,
            loss_slot_stride: LOSS_ENTRY_BYTES,
            total_length,
        })
    }
}

pub fn initialize_descriptor(
    destination: &mut [u8],
    config: PcmAbiConfig,
) -> Result<PcmDescriptor, AbiError> {
    initialize_descriptor_for_minor(destination, config, ABI_MINOR)
}

pub(crate) fn initialize_legacy_descriptor(
    destination: &mut [u8],
    config: PcmAbiConfig,
) -> Result<PcmDescriptor, AbiError> {
    initialize_descriptor_for_minor(destination, config, 1)
}

fn initialize_descriptor_for_minor(
    destination: &mut [u8],
    config: PcmAbiConfig,
    abi_minor: u16,
) -> Result<PcmDescriptor, AbiError> {
    let layout = PcmLayout::checked_for_minor(config, abi_minor)?;
    if destination.len() < layout.descriptor_length {
        return Err(AbiError::BufferTooSmall);
    }
    destination[..layout.descriptor_length].fill(0);
    destination[0..8].copy_from_slice(&MAGIC);
    put_u16(destination, 8, ABI_MAJOR);
    put_u16(destination, 10, abi_minor);
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
    put_u64(destination, 120, layout.loss_slots_offset as u64);
    Ok(PcmDescriptor {
        abi_minor,
        config,
        layout,
    })
}

pub fn decode_descriptor(source: &[u8]) -> Result<PcmDescriptor, AbiError> {
    if source.len() < DESCRIPTOR_BYTES {
        return Err(AbiError::BufferTooSmall);
    }
    if source[0..8] != MAGIC {
        return Err(AbiError::InvalidMagic);
    }
    let abi_minor = get_u16(source, 10);
    if get_u16(source, 8) != ABI_MAJOR || abi_minor > ABI_MINOR {
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
    if abi_minor == 0 {
        return Err(AbiError::IncompatibleVersion);
    }
    let layout = PcmLayout::checked_for_minor(config, abi_minor)?;
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
        get_u64(source, 120),
    ];
    let expected = [
        layout.producer_state_offset as u64,
        layout.consumer_state_offset as u64,
        layout.slots_offset as u64,
        layout.producer_diagnostics_offset as u64,
        layout.consumer_diagnostics_offset as u64,
        layout.slot_stride as u64,
        layout.total_length as u64,
        layout.loss_slots_offset as u64,
    ];
    if encoded != expected {
        return Err(AbiError::InvalidLayout);
    }
    Ok(PcmDescriptor {
        abi_minor,
        config,
        layout,
    })
}

/// Initializes the fixed candidate state-page bytes before atomic views exist.
pub fn initialize_ordinary_state_pages(
    producer: &mut [u8],
    consumer: &mut [u8],
    config: PcmAbiConfig,
) -> Result<(), AbiError> {
    let layout = PcmLayout::checked(config)?;
    if producer.len() < layout.producer_state_length
        || consumer.len() < layout.consumer_state_length
    {
        return Err(AbiError::BufferTooSmall);
    }
    producer[..layout.producer_state_length].fill(0);
    consumer[..layout.consumer_state_length].fill(0);
    initialize_state_identity(producer, &PRODUCER_MAGIC, config);
    initialize_state_identity(consumer, &CONSUMER_MAGIC, config);
    put_u64(producer, PRODUCER_PUBLISHED_NEXT_OFFSET, 0);
    put_u64(producer, PRODUCER_OVERWRITE_CLAIM_OFFSET, NO_CLAIM_SEQUENCE);
    put_u64(producer, PRODUCER_OVERWRITE_LOSS_PUBLISHED_NEXT_OFFSET, 0);
    put_u64(producer, PRODUCER_DROPPED_LOSS_PUBLISHED_NEXT_OFFSET, 0);
    put_u64(consumer, CONSUMER_CONSUMED_NEXT_OFFSET, 0);
    put_u64(consumer, CONSUMER_READ_CLAIM_OFFSET, NO_CLAIM_SEQUENCE);
    put_u64(consumer, CONSUMER_OVERWRITE_LOSS_CONSUMED_NEXT_OFFSET, 0);
    put_u64(consumer, CONSUMER_DROPPED_LOSS_CONSUMED_NEXT_OFFSET, 0);
    Ok(())
}

/// Encodes the candidate 64-byte producer-owned slot header.
pub fn encode_ordinary_slot_header(
    destination: &mut [u8],
    header: OrdinarySlotHeader,
) -> Result<(), AbiError> {
    if destination.len() < SLOT_HEADER_BYTES {
        return Err(AbiError::BufferTooSmall);
    }
    destination[..SLOT_HEADER_BYTES].fill(0);
    put_u64(
        destination,
        SLOT_COMMITTED_SEQUENCE_OFFSET,
        header.committed_sequence,
    );
    put_u64(
        destination,
        SLOT_SOURCE_SEQUENCE_OFFSET,
        header.source_sequence,
    );
    put_u64(destination, SLOT_CAPTURE_EPOCH_OFFSET, header.capture_epoch);
    put_u64(
        destination,
        SLOT_FIRST_FRAME_INDEX_OFFSET,
        header.first_frame_index,
    );
    put_u64(
        destination,
        SLOT_MONOTONIC_CAPTURE_NS_OFFSET,
        header.monotonic_capture_ns.unwrap_or(0),
    );
    put_u64(
        destination,
        SLOT_CUMULATIVE_SOURCE_XRUNS_OFFSET,
        header.cumulative_source_xruns,
    );
    put_u16(destination, SLOT_FRAME_COUNT_OFFSET, header.frame_count);
    put_u16(destination, SLOT_CHANNEL_COUNT_OFFSET, header.channel_count);
    let presence = u16::from(header.monotonic_capture_ns.is_some())
        | (u16::from(header.timing_uncertainty_ns.is_some()) << 1);
    put_u16(destination, SLOT_PRESENCE_FLAGS_OFFSET, presence);
    put_u32(
        destination,
        SLOT_TIMING_UNCERTAINTY_NS_OFFSET,
        header.timing_uncertainty_ns.unwrap_or(0),
    );
    put_u32(
        destination,
        SLOT_DISCONTINUITY_FLAGS_OFFSET,
        header.discontinuity_flags,
    );
    Ok(())
}

/// Encodes one fixed producer-owned exact-loss ledger entry.
pub fn encode_ordinary_loss_entry(
    destination: &mut [u8],
    entry: OrdinaryLossEntry,
) -> Result<(), AbiError> {
    if destination.len() < LOSS_ENTRY_BYTES {
        return Err(AbiError::BufferTooSmall);
    }
    destination[..LOSS_ENTRY_BYTES].fill(0);
    put_u64(
        destination,
        LOSS_COMMITTED_SEQUENCE_OFFSET,
        entry.committed_sequence,
    );
    put_u16(destination, LOSS_KIND_OFFSET, entry.kind);
    put_u64(
        destination,
        LOSS_ORDERING_PUBLICATION_OFFSET,
        entry.ordering_publication,
    );
    put_u64(destination, LOSS_CAPTURE_EPOCH_OFFSET, entry.capture_epoch);
    put_u64(
        destination,
        LOSS_SOURCE_SEQUENCE_OFFSET,
        entry.source_sequence,
    );
    put_u64(
        destination,
        LOSS_FIRST_FRAME_INDEX_OFFSET,
        entry.first_frame_index,
    );
    put_u64(
        destination,
        LOSS_END_FRAME_INDEX_OFFSET,
        entry.end_frame_index,
    );
    Ok(())
}

/// Initializes the candidate loss-ledger region before atomic views exist.
pub fn initialize_ordinary_loss_slots(
    destination: &mut [u8],
    config: PcmAbiConfig,
) -> Result<(), AbiError> {
    let layout = PcmLayout::checked(config)?;
    if destination.len() < layout.loss_slots_length {
        return Err(AbiError::BufferTooSmall);
    }
    destination[..layout.loss_slots_length].fill(0);
    for index in 0..config.capacity as usize * 2 {
        put_u64(
            destination,
            index * layout.loss_slot_stride + LOSS_COMMITTED_SEQUENCE_OFFSET,
            NO_CLAIM_SEQUENCE,
        );
    }
    Ok(())
}

fn initialize_state_identity(destination: &mut [u8], magic: &[u8; 8], config: PcmAbiConfig) {
    destination[0..8].copy_from_slice(magic);
    put_u16(destination, 8, ABI_MAJOR);
    put_u16(destination, 10, ORDINARY_OWNERSHIP_MINOR);
    put_u64(destination, 16, config.mapping_generation);
    put_u64(destination, 24, config.capture_epoch);
}

fn validate_config(config: PcmAbiConfig, require_boot_id: bool) -> Result<(), AbiError> {
    let page = config.page_size;
    if page < MINIMUM_PAGE_SIZE || !page.is_power_of_two() {
        return Err(AbiError::InvalidPageSize);
    }
    if require_boot_id && config.node_boot_id == [0; 16] {
        return Err(AbiError::ZeroBootId);
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
        assert_eq!(descriptor.abi_minor, ORDINARY_OWNERSHIP_MINOR);
        assert!(descriptor.supports_ordinary_ownership());
    }

    #[test]
    fn previous_minor_decodes_but_cannot_expose_ordinary_slots() {
        let layout = PcmLayout::checked(config(4096)).unwrap();
        let mut bytes = vec![0; layout.descriptor_length];
        let legacy = initialize_legacy_descriptor(&mut bytes, config(4096)).unwrap();
        assert_eq!(legacy.abi_minor, 1);
        assert!(!legacy.supports_ordinary_ownership());
        assert_eq!(decode_descriptor(&bytes), Ok(legacy));

        let mut historical_config = config(4096);
        historical_config.node_boot_id = [0; 16];
        let historical = initialize_legacy_descriptor(&mut bytes, historical_config).unwrap();
        assert_eq!(decode_descriptor(&bytes), Ok(historical));

        bytes[10..12].copy_from_slice(&(ABI_MINOR + 1).to_le_bytes());
        assert_eq!(
            decode_descriptor(&bytes),
            Err(AbiError::IncompatibleVersion)
        );
    }

    #[test]
    fn ordinary_candidate_bytes_and_atomic_offsets_are_exact() {
        let layout = PcmLayout::checked(config(4096)).unwrap();
        let mut producer = vec![0xaa; layout.producer_state_length];
        let mut consumer = vec![0xaa; layout.consumer_state_length];
        initialize_ordinary_state_pages(&mut producer, &mut consumer, config(4096)).unwrap();

        assert_eq!(&producer[0..8], b"A2PPROD\0");
        assert_eq!(&consumer[0..8], b"A2PCON\0\0");
        for page in [&producer, &consumer] {
            assert_eq!(&page[8..10], &ABI_MAJOR.to_le_bytes());
            assert_eq!(&page[10..12], &ORDINARY_OWNERSHIP_MINOR.to_le_bytes());
            assert_eq!(&page[16..24], &3_u64.to_le_bytes());
            assert_eq!(&page[24..32], &7_u64.to_le_bytes());
            assert!(page[64..].iter().all(|byte| *byte == 0));
        }
        assert_eq!(&producer[32..40], &0_u64.to_le_bytes());
        assert_eq!(&producer[40..48], &NO_CLAIM_SEQUENCE.to_le_bytes());
        assert_eq!(&consumer[32..40], &0_u64.to_le_bytes());
        assert_eq!(&consumer[40..48], &NO_CLAIM_SEQUENCE.to_le_bytes());
        assert_eq!(&producer[48..56], &0_u64.to_le_bytes());
        assert_eq!(&consumer[48..56], &0_u64.to_le_bytes());
        assert_eq!(&producer[56..64], &0_u64.to_le_bytes());
        assert_eq!(&consumer[56..64], &0_u64.to_le_bytes());
        for offset in [
            PRODUCER_PUBLISHED_NEXT_OFFSET,
            PRODUCER_OVERWRITE_CLAIM_OFFSET,
            CONSUMER_CONSUMED_NEXT_OFFSET,
            CONSUMER_READ_CLAIM_OFFSET,
            PRODUCER_OVERWRITE_LOSS_PUBLISHED_NEXT_OFFSET,
            PRODUCER_DROPPED_LOSS_PUBLISHED_NEXT_OFFSET,
            CONSUMER_OVERWRITE_LOSS_CONSUMED_NEXT_OFFSET,
            CONSUMER_DROPPED_LOSS_CONSUMED_NEXT_OFFSET,
            SLOT_COMMITTED_SEQUENCE_OFFSET,
            SLOT_SOURCE_SEQUENCE_OFFSET,
            SLOT_CAPTURE_EPOCH_OFFSET,
            SLOT_FIRST_FRAME_INDEX_OFFSET,
            SLOT_MONOTONIC_CAPTURE_NS_OFFSET,
            SLOT_CUMULATIVE_SOURCE_XRUNS_OFFSET,
        ] {
            assert_eq!(offset % align_of::<std::sync::atomic::AtomicU64>(), 0);
        }

        let mut slot = [0xaa; SLOT_HEADER_BYTES];
        encode_ordinary_slot_header(
            &mut slot,
            OrdinarySlotHeader {
                committed_sequence: 0x0102_0304_0506_0708,
                source_sequence: 0x1112_1314_1516_1718,
                capture_epoch: 0x2122_2324_2526_2728,
                first_frame_index: 0x3132_3334_3536_3738,
                monotonic_capture_ns: Some(0x4142_4344_4546_4748),
                cumulative_source_xruns: 0x5152_5354_5556_5758,
                frame_count: 0x6162,
                channel_count: 0x7172,
                timing_uncertainty_ns: Some(0x8182_8384),
                discontinuity_flags: 0x9192_9394,
            },
        )
        .unwrap();
        assert_eq!(&slot[0..8], &0x0102_0304_0506_0708_u64.to_le_bytes());
        assert_eq!(&slot[8..16], &0x1112_1314_1516_1718_u64.to_le_bytes());
        assert_eq!(&slot[48..50], &0x6162_u16.to_le_bytes());
        assert_eq!(&slot[50..52], &0x7172_u16.to_le_bytes());
        assert_eq!(&slot[52..54], &3_u16.to_le_bytes());
        assert_eq!(&slot[54..56], &[0, 0]);
        assert_eq!(&slot[56..60], &0x8182_8384_u32.to_le_bytes());
        assert_eq!(&slot[60..64], &0x9192_9394_u32.to_le_bytes());

        let mut loss = [0xaa; LOSS_ENTRY_BYTES];
        encode_ordinary_loss_entry(
            &mut loss,
            OrdinaryLossEntry {
                committed_sequence: 0x0102_0304_0506_0708,
                kind: 2,
                ordering_publication: 0x1112_1314_1516_1718,
                capture_epoch: 0x2122_2324_2526_2728,
                source_sequence: 0x3132_3334_3536_3738,
                first_frame_index: 0x4142_4344_4546_4748,
                end_frame_index: 0x5152_5354_5556_5758,
            },
        )
        .unwrap();
        assert_eq!(&loss[0..8], &0x0102_0304_0506_0708_u64.to_le_bytes());
        assert_eq!(&loss[8..10], &2_u16.to_le_bytes());
        assert_eq!(&loss[10..16], &[0; 6]);
        assert_eq!(&loss[16..24], &0x1112_1314_1516_1718_u64.to_le_bytes());
        assert_eq!(&loss[56..64], &[0; 8]);

        let mut ledger = vec![0xaa; layout.loss_slots_length];
        initialize_ordinary_loss_slots(&mut ledger, config(4096)).unwrap();
        for index in 0..config(4096).capacity as usize * 2 {
            let offset = index * layout.loss_slot_stride;
            assert_eq!(
                &ledger[offset..offset + 8],
                &NO_CLAIM_SEQUENCE.to_le_bytes()
            );
            assert!(
                ledger[offset + 8..offset + LOSS_ENTRY_BYTES]
                    .iter()
                    .all(|byte| *byte == 0)
            );
        }
        assert!(
            ledger[config(4096).capacity as usize * 2 * layout.loss_slot_stride..]
                .iter()
                .all(|byte| *byte == 0)
        );
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
                layout.loss_slots_offset,
                layout.producer_diagnostics_offset,
                layout.consumer_diagnostics_offset,
                layout.total_length,
            ] {
                assert_eq!(offset % page_size as usize, 0);
            }
            assert!(
                layout.producer_diagnostics_offset
                    >= layout.loss_slots_offset + layout.loss_slots_length
            );
        }
    }

    #[test]
    fn rejects_invalid_config_and_descriptor_corruption() {
        let mut invalid = config(4096);
        invalid.node_boot_id = [0; 16];
        assert_eq!(PcmLayout::checked(invalid), Err(AbiError::ZeroBootId));
        invalid = config(4096);
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
            (120, AbiError::InvalidLayout),
        ] {
            let mut corrupted = bytes.clone();
            corrupted[offset] ^= 0xff;
            assert_eq!(decode_descriptor(&corrupted), Err(expected));
        }
    }
}
