use std::cell::UnsafeCell;
use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};

use crate::{AbiError, PcmAbiConfig, PcmLayout, initialize_descriptor};

const SERIAL_HALF_RANGE: u64 = 1_u64 << 63;
const CONSUMER_MAGIC: [u8; 8] = *b"A2PCON\0\0";
const CONSUMER_MAJOR_OFFSET: usize = 8;
const CONSUMER_MINOR_OFFSET: usize = 10;
const CONSUMER_GENERATION_OFFSET: usize = 16;
const CONSUMER_EPOCH_OFFSET: usize = 24;
const CONSUMER_NEXT_OFFSET: usize = 32;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProducerAttach {
    pub mapping_generation: u64,
    pub capture_epoch: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ConsumerAttach {
    pub mapping_generation: u64,
    pub capture_epoch: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AttachError {
    Abi(AbiError),
    GenerationMismatch,
    EpochMismatch,
    ProducerAlreadyAttached,
    ConsumerAlreadyAttached,
}

impl Display for AttachError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "cannot attach to PCM ABI: {self:?}")
    }
}

impl Error for AttachError {}

impl From<AbiError> for AttachError {
    fn from(value: AbiError) -> Self {
        Self::Abi(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PcmBlockMetadata {
    pub sequence: u64,
    pub capture_epoch: u64,
    pub first_frame_index: u64,
    pub frame_count: u16,
    pub channel_count: u16,
    pub monotonic_capture_ns: Option<u64>,
    pub timing_uncertainty_ns: Option<u32>,
    pub discontinuity_flags: u32,
    pub cumulative_source_xruns: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PeerFault {
    InvalidConsumerControlPage,
    InvalidConsumedSequence,
    InvalidPublishedSequence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SequenceRange {
    pub start: u64,
    pub end_exclusive: u64,
}

impl SequenceRange {
    pub fn len(self) -> u64 {
        self.end_exclusive.wrapping_sub(self.start)
    }

    pub fn is_empty(self) -> bool {
        self.start == self.end_exclusive
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PublishOutcome {
    pub sequence: u64,
    pub slot_index: usize,
    pub overwritten: Option<SequenceRange>,
    pub peer_fault: Option<PeerFault>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PublishError {
    EpochMismatch,
    ChannelMismatch,
    InvalidFrameCount,
    SampleCountMismatch,
    FrameIndexOverflow,
}

impl Display for PublishError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "cannot publish PCM block: {self:?}")
    }
}

impl Error for PublishError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadOutcome {
    Empty,
    Block(PcmBlockMetadata),
    Gap(SequenceRange),
    Retry,
    RemapRequired(PeerFault),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadError {
    OutputTooSmall,
}

impl Display for ReadError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "cannot read PCM block: {self:?}")
    }
}

impl Error for ReadError {}

pub struct SharedPcmRing {
    inner: Rc<Inner>,
}

struct Inner {
    descriptor: Box<[u8]>,
    config: PcmAbiConfig,
    layout: PcmLayout,
    published_next: AtomicU64,
    consumer_page: Box<[AtomicU8]>,
    producer_attached: AtomicBool,
    consumer_attached: AtomicBool,
    overwritten_blocks: AtomicU64,
    invalid_consumer_updates: AtomicU64,
    slots: Box<[Slot]>,
}

struct Slot {
    stamp: AtomicU64,
    data: UnsafeCell<SlotData>,
}

struct SlotData {
    metadata: PcmBlockMetadata,
    samples: Box<[f32]>,
}

pub struct Producer {
    inner: Rc<Inner>,
    next_sequence: u64,
    loss_floor: u64,
    next_stamp: u64,
}

pub struct Consumer {
    inner: Rc<Inner>,
    next_sequence: u64,
}

impl SharedPcmRing {
    pub fn new(config: PcmAbiConfig) -> Result<Self, AbiError> {
        let layout = PcmLayout::checked(config)?;
        let mut descriptor = Vec::new();
        descriptor
            .try_reserve_exact(layout.descriptor_length)
            .map_err(|_| AbiError::AllocationFailed)?;
        descriptor.resize(layout.descriptor_length, 0);
        let mut descriptor = descriptor.into_boxed_slice();
        initialize_descriptor(&mut descriptor, config)?;
        let sample_capacity = usize::from(config.channels)
            .checked_mul(usize::from(config.frames_per_slot))
            .ok_or(AbiError::SizeOverflow)?;
        let mut slots = Vec::new();
        slots
            .try_reserve_exact(config.capacity as usize)
            .map_err(|_| AbiError::AllocationFailed)?;
        for _ in 0..config.capacity {
            let mut samples = Vec::new();
            samples
                .try_reserve_exact(sample_capacity)
                .map_err(|_| AbiError::AllocationFailed)?;
            samples.resize(sample_capacity, 0.0);
            slots.push(Slot {
                stamp: AtomicU64::new(0),
                data: UnsafeCell::new(SlotData {
                    metadata: empty_metadata(config.capture_epoch, config.channels),
                    samples: samples.into_boxed_slice(),
                }),
            });
        }
        let mut consumer_page = Vec::new();
        consumer_page
            .try_reserve_exact(layout.consumer_state_length)
            .map_err(|_| AbiError::AllocationFailed)?;
        consumer_page.resize_with(layout.consumer_state_length, || AtomicU8::new(0));
        write_bytes(&consumer_page, 0, &CONSUMER_MAGIC, Ordering::Relaxed);
        write_bytes(
            &consumer_page,
            CONSUMER_MAJOR_OFFSET,
            &crate::ABI_MAJOR.to_le_bytes(),
            Ordering::Relaxed,
        );
        write_bytes(
            &consumer_page,
            CONSUMER_MINOR_OFFSET,
            &crate::ABI_MINOR.to_le_bytes(),
            Ordering::Relaxed,
        );
        write_u64(
            &consumer_page,
            CONSUMER_GENERATION_OFFSET,
            config.mapping_generation,
            Ordering::Relaxed,
        );
        write_u64(
            &consumer_page,
            CONSUMER_EPOCH_OFFSET,
            config.capture_epoch,
            Ordering::Relaxed,
        );
        write_u64(&consumer_page, CONSUMER_NEXT_OFFSET, 0, Ordering::Relaxed);
        Ok(Self {
            inner: Rc::new(Inner {
                descriptor,
                config,
                layout,
                published_next: AtomicU64::new(0),
                consumer_page: consumer_page.into_boxed_slice(),
                producer_attached: AtomicBool::new(false),
                consumer_attached: AtomicBool::new(false),
                overwritten_blocks: AtomicU64::new(0),
                invalid_consumer_updates: AtomicU64::new(0),
                slots: slots.into_boxed_slice(),
            }),
        })
    }

    pub fn descriptor(&self) -> &[u8] {
        &self.inner.descriptor
    }

    pub fn layout(&self) -> PcmLayout {
        self.inner.layout
    }

    pub fn attach_producer(&self, attach: ProducerAttach) -> Result<Producer, AttachError> {
        validate_attach(
            self.inner.config,
            attach.mapping_generation,
            attach.capture_epoch,
        )?;
        if self.inner.producer_attached.swap(true, Ordering::AcqRel) {
            return Err(AttachError::ProducerAlreadyAttached);
        }
        Ok(Producer {
            inner: Rc::clone(&self.inner),
            next_sequence: 0,
            loss_floor: 0,
            next_stamp: 2,
        })
    }

    pub fn attach_consumer(&self, attach: ConsumerAttach) -> Result<Consumer, AttachError> {
        validate_attach(
            self.inner.config,
            attach.mapping_generation,
            attach.capture_epoch,
        )?;
        if self.inner.consumer_attached.swap(true, Ordering::AcqRel) {
            return Err(AttachError::ConsumerAlreadyAttached);
        }
        Ok(Consumer {
            inner: Rc::clone(&self.inner),
            next_sequence: 0,
        })
    }

    pub fn overwritten_blocks(&self) -> u64 {
        self.inner.overwritten_blocks.load(Ordering::Relaxed)
    }

    pub fn invalid_consumer_updates(&self) -> u64 {
        self.inner.invalid_consumer_updates.load(Ordering::Relaxed)
    }
}

impl Producer {
    pub fn publish(
        &mut self,
        mut metadata: PcmBlockMetadata,
        samples: &[f32],
    ) -> Result<PublishOutcome, PublishError> {
        validate_block(self.inner.config, metadata, samples)?;
        let sequence = self.next_sequence;
        metadata.sequence = sequence;

        let consumer_cursor = read_consumer_cursor(&self.inner);
        let peer_fault = if !matches!(
            consumer_cursor,
            Ok(consumed) if is_within_closed(consumed, self.loss_floor, sequence)
        ) {
            self.inner
                .invalid_consumer_updates
                .fetch_add(1, Ordering::Relaxed);
            Some(
                consumer_cursor
                    .err()
                    .unwrap_or(PeerFault::InvalidConsumedSequence),
            )
        } else {
            let consumed = consumer_cursor.expect("validated cursor");
            if is_after(consumed, self.loss_floor) {
                self.loss_floor = consumed;
            }
            None
        };

        let capacity = u64::from(self.inner.config.capacity);
        let retained = sequence.wrapping_sub(self.loss_floor);
        let overwritten = if retained >= capacity {
            let new_floor = sequence.wrapping_sub(capacity).wrapping_add(1);
            let range = SequenceRange {
                start: self.loss_floor,
                end_exclusive: new_floor,
            };
            self.loss_floor = new_floor;
            self.inner
                .overwritten_blocks
                .fetch_add(range.len(), Ordering::Relaxed);
            Some(range)
        } else {
            None
        };

        let slot_index = (sequence % capacity) as usize;
        let slot = &self.inner.slots[slot_index];
        let writing_stamp = self.next_stamp.wrapping_sub(1) | 1;
        slot.stamp.store(writing_stamp, Ordering::Release);
        // This model is deliberately !Send and !Sync. Producer and consumer calls therefore
        // cannot overlap across threads; the UnsafeCell represents bytes owned by the producer.
        let slot_data = unsafe { &mut *slot.data.get() };
        slot_data.metadata = metadata;
        slot_data.samples[..samples.len()].copy_from_slice(samples);
        slot.stamp.store(self.next_stamp & !1, Ordering::Release);
        self.next_stamp = self.next_stamp.wrapping_add(2);
        self.next_sequence = sequence.wrapping_add(1);
        self.inner
            .published_next
            .store(self.next_sequence, Ordering::Release);

        Ok(PublishOutcome {
            sequence,
            slot_index,
            overwritten,
            peer_fault,
        })
    }
}

impl Consumer {
    pub fn read_into(&mut self, output: &mut [f32]) -> Result<ReadOutcome, ReadError> {
        let published = self.inner.published_next.load(Ordering::Acquire);
        let available = published.wrapping_sub(self.next_sequence);
        if available == 0 {
            return Ok(ReadOutcome::Empty);
        }
        if available >= SERIAL_HALF_RANGE {
            return Ok(ReadOutcome::RemapRequired(
                PeerFault::InvalidPublishedSequence,
            ));
        }
        let capacity = u64::from(self.inner.config.capacity);
        if available > capacity {
            let earliest = published.wrapping_sub(capacity);
            let gap = SequenceRange {
                start: self.next_sequence,
                end_exclusive: earliest,
            };
            self.next_sequence = earliest;
            write_u64(
                &self.inner.consumer_page,
                CONSUMER_NEXT_OFFSET,
                earliest,
                Ordering::Release,
            );
            return Ok(ReadOutcome::Gap(gap));
        }

        let slot_index = (self.next_sequence % capacity) as usize;
        let slot = &self.inner.slots[slot_index];
        let stamp_before = slot.stamp.load(Ordering::Acquire);
        if stamp_before & 1 != 0 {
            return Ok(ReadOutcome::Retry);
        }
        // See Producer::publish: the Rc/UnsafeCell combination keeps this deterministic model
        // on one thread, while the two stamp reads encode the ABI's retry rule.
        let slot_data = unsafe { &*slot.data.get() };
        if slot_data.metadata.sequence != self.next_sequence {
            return Ok(ReadOutcome::Retry);
        }
        let sample_count = usize::from(slot_data.metadata.frame_count)
            * usize::from(slot_data.metadata.channel_count);
        if output.len() < sample_count {
            return Err(ReadError::OutputTooSmall);
        }
        output[..sample_count].copy_from_slice(&slot_data.samples[..sample_count]);
        let metadata = slot_data.metadata;
        let stamp_after = slot.stamp.load(Ordering::Acquire);
        if stamp_before != stamp_after || stamp_after & 1 != 0 {
            return Ok(ReadOutcome::Retry);
        }

        self.next_sequence = self.next_sequence.wrapping_add(1);
        write_u64(
            &self.inner.consumer_page,
            CONSUMER_NEXT_OFFSET,
            self.next_sequence,
            Ordering::Release,
        );
        Ok(ReadOutcome::Block(metadata))
    }

    pub fn next_sequence(&self) -> u64 {
        self.next_sequence
    }
}

fn validate_attach(config: PcmAbiConfig, generation: u64, epoch: u64) -> Result<(), AttachError> {
    if generation != config.mapping_generation {
        return Err(AttachError::GenerationMismatch);
    }
    if epoch != config.capture_epoch {
        return Err(AttachError::EpochMismatch);
    }
    Ok(())
}

fn validate_block(
    config: PcmAbiConfig,
    metadata: PcmBlockMetadata,
    samples: &[f32],
) -> Result<(), PublishError> {
    if metadata.capture_epoch != config.capture_epoch {
        return Err(PublishError::EpochMismatch);
    }
    if metadata.channel_count != config.channels {
        return Err(PublishError::ChannelMismatch);
    }
    if metadata.frame_count == 0 || metadata.frame_count > config.frames_per_slot {
        return Err(PublishError::InvalidFrameCount);
    }
    let expected = usize::from(metadata.frame_count) * usize::from(metadata.channel_count);
    if samples.len() != expected {
        return Err(PublishError::SampleCountMismatch);
    }
    if metadata
        .first_frame_index
        .checked_add(u64::from(metadata.frame_count))
        .is_none()
    {
        return Err(PublishError::FrameIndexOverflow);
    }
    Ok(())
}

fn empty_metadata(epoch: u64, channels: u16) -> PcmBlockMetadata {
    PcmBlockMetadata {
        sequence: 0,
        capture_epoch: epoch,
        first_frame_index: 0,
        frame_count: 0,
        channel_count: channels,
        monotonic_capture_ns: None,
        timing_uncertainty_ns: None,
        discontinuity_flags: 0,
        cumulative_source_xruns: 0,
    }
}

fn is_after(candidate: u64, reference: u64) -> bool {
    let distance = candidate.wrapping_sub(reference);
    distance != 0 && distance < SERIAL_HALF_RANGE
}

fn is_within_closed(candidate: u64, start: u64, end: u64) -> bool {
    candidate.wrapping_sub(start) <= end.wrapping_sub(start)
}

fn read_consumer_cursor(inner: &Inner) -> Result<u64, PeerFault> {
    if !bytes_equal(&inner.consumer_page, 0, &CONSUMER_MAGIC)
        || read_u16(&inner.consumer_page, CONSUMER_MAJOR_OFFSET) != crate::ABI_MAJOR
        || read_u16(&inner.consumer_page, CONSUMER_MINOR_OFFSET) > crate::ABI_MINOR
        || read_u64(&inner.consumer_page, CONSUMER_GENERATION_OFFSET)
            != inner.config.mapping_generation
        || read_u64(&inner.consumer_page, CONSUMER_EPOCH_OFFSET) != inner.config.capture_epoch
    {
        return Err(PeerFault::InvalidConsumerControlPage);
    }
    Ok(read_u64(&inner.consumer_page, CONSUMER_NEXT_OFFSET))
}

fn bytes_equal(page: &[AtomicU8], offset: usize, expected: &[u8]) -> bool {
    page[offset..offset + expected.len()]
        .iter()
        .zip(expected)
        .all(|(actual, expected)| actual.load(Ordering::Acquire) == *expected)
}

fn read_u16(page: &[AtomicU8], offset: usize) -> u16 {
    let bytes = [
        page[offset].load(Ordering::Acquire),
        page[offset + 1].load(Ordering::Acquire),
    ];
    u16::from_le_bytes(bytes)
}

fn read_u64(page: &[AtomicU8], offset: usize) -> u64 {
    let mut bytes = [0; 8];
    for (destination, source) in bytes.iter_mut().zip(&page[offset..offset + 8]) {
        *destination = source.load(Ordering::Acquire);
    }
    u64::from_le_bytes(bytes)
}

fn write_u64(page: &[AtomicU8], offset: usize, value: u64, ordering: Ordering) {
    write_bytes(page, offset, &value.to_le_bytes(), ordering);
}

fn write_bytes(page: &[AtomicU8], offset: usize, bytes: &[u8], ordering: Ordering) {
    for (destination, value) in page[offset..offset + bytes.len()].iter().zip(bytes) {
        destination.store(*value, ordering);
    }
}

#[cfg(test)]
mod tests {
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;

    use super::*;
    use crate::SampleFormat;

    struct TrackingAllocator;

    thread_local! {
        static TRACK: Cell<bool> = const { Cell::new(false) };
        static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
    }

    unsafe impl GlobalAlloc for TrackingAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            TRACK.with(|track| {
                if track.get() {
                    ALLOCATIONS.with(|count| count.set(count.get() + 1));
                }
            });
            unsafe { System.alloc(layout) }
        }

        unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
            unsafe { System.dealloc(pointer, layout) }
        }
    }

    #[global_allocator]
    static ALLOCATOR: TrackingAllocator = TrackingAllocator;

    fn config(capacity: u32) -> PcmAbiConfig {
        PcmAbiConfig {
            node_boot_id: *b"node-boot-id-001",
            mapping_generation: 11,
            capture_epoch: 19,
            sample_format: SampleFormat::F32,
            channels: 2,
            frames_per_slot: 4,
            capacity,
            page_size: 4096,
        }
    }

    fn metadata(first_frame_index: u64) -> PcmBlockMetadata {
        PcmBlockMetadata {
            sequence: u64::MAX,
            capture_epoch: 19,
            first_frame_index,
            frame_count: 4,
            channel_count: 2,
            monotonic_capture_ns: Some(123),
            timing_uncertainty_ns: Some(50),
            discontinuity_flags: 0,
            cumulative_source_xruns: 0,
        }
    }

    fn producer_attach() -> ProducerAttach {
        ProducerAttach {
            mapping_generation: 11,
            capture_epoch: 19,
        }
    }

    fn consumer_attach() -> ConsumerAttach {
        ConsumerAttach {
            mapping_generation: 11,
            capture_epoch: 19,
        }
    }

    #[test]
    fn rejects_stale_generation_and_epoch_before_claiming_role() {
        let ring = SharedPcmRing::new(config(2)).unwrap();
        assert!(matches!(
            ring.attach_producer(ProducerAttach {
                mapping_generation: 10,
                capture_epoch: 19
            }),
            Err(AttachError::GenerationMismatch)
        ));
        assert!(matches!(
            ring.attach_consumer(ConsumerAttach {
                mapping_generation: 11,
                capture_epoch: 18
            }),
            Err(AttachError::EpochMismatch)
        ));
        ring.attach_producer(producer_attach()).unwrap();
        ring.attach_consumer(consumer_attach()).unwrap();
    }

    #[test]
    fn copies_blocks_and_reports_overwrite_oldest_gaps() {
        let ring = SharedPcmRing::new(config(2)).unwrap();
        let mut producer = ring.attach_producer(producer_attach()).unwrap();
        let mut consumer = ring.attach_consumer(consumer_attach()).unwrap();
        let samples = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];

        assert_eq!(
            producer.publish(metadata(0), &samples).unwrap().overwritten,
            None
        );
        assert_eq!(
            producer.publish(metadata(4), &samples).unwrap().overwritten,
            None
        );
        assert_eq!(
            producer.publish(metadata(8), &samples).unwrap().overwritten,
            Some(SequenceRange {
                start: 0,
                end_exclusive: 1
            })
        );
        assert_eq!(ring.overwritten_blocks(), 1);
        let mut output = [0.0; 8];
        assert_eq!(
            consumer.read_into(&mut output),
            Ok(ReadOutcome::Gap(SequenceRange {
                start: 0,
                end_exclusive: 1
            }))
        );
        assert_eq!(
            consumer.read_into(&mut output),
            Ok(ReadOutcome::Block(PcmBlockMetadata {
                sequence: 1,
                ..metadata(4)
            }))
        );
        assert_eq!(output, samples);
    }

    #[test]
    fn hostile_consumer_values_never_control_slot_addressing() {
        for byte in 0..4096 {
            let ring = SharedPcmRing::new(config(2)).unwrap();
            let mut producer = ring.attach_producer(producer_attach()).unwrap();
            ring.inner.consumer_page[byte].fetch_xor(0xff, Ordering::Release);
            let outcome = producer.publish(metadata(0), &[0.0; 8]).unwrap();
            assert_eq!(outcome.slot_index, 0);
        }
    }

    #[test]
    fn consumer_control_corruption_is_classified_without_changing_loss_bounds() {
        for offset in [
            0,
            CONSUMER_MAJOR_OFFSET,
            CONSUMER_GENERATION_OFFSET,
            CONSUMER_EPOCH_OFFSET,
        ] {
            let ring = SharedPcmRing::new(config(2)).unwrap();
            let mut producer = ring.attach_producer(producer_attach()).unwrap();
            ring.inner.consumer_page[offset].fetch_xor(0xff, Ordering::Release);
            let outcome = producer.publish(metadata(0), &[0.0; 8]).unwrap();
            assert_eq!(outcome.slot_index, 0);
            assert_eq!(
                outcome.peer_fault,
                Some(PeerFault::InvalidConsumerControlPage)
            );
            assert_eq!(ring.invalid_consumer_updates(), 1);
        }

        for cursor in [1, SERIAL_HALF_RANGE, u64::MAX] {
            let ring = SharedPcmRing::new(config(2)).unwrap();
            let mut producer = ring.attach_producer(producer_attach()).unwrap();
            write_u64(
                &ring.inner.consumer_page,
                CONSUMER_NEXT_OFFSET,
                cursor,
                Ordering::Release,
            );
            let outcome = producer.publish(metadata(0), &[0.0; 8]).unwrap();
            assert_eq!(outcome.slot_index, 0);
            assert_eq!(outcome.peer_fault, Some(PeerFault::InvalidConsumedSequence));
            assert_eq!(ring.invalid_consumer_updates(), 1);
        }

        let ring = SharedPcmRing::new(config(2)).unwrap();
        let mut producer = ring.attach_producer(producer_attach()).unwrap();
        ring.inner.consumer_page[128].store(0xff, Ordering::Release);
        assert_eq!(
            producer.publish(metadata(0), &[0.0; 8]).unwrap().peer_fault,
            None
        );
        producer.publish(metadata(4), &[0.0; 8]).unwrap();
        assert_eq!(
            producer
                .publish(metadata(8), &[0.0; 8])
                .unwrap()
                .overwritten,
            Some(SequenceRange {
                start: 0,
                end_exclusive: 1,
            })
        );
    }

    #[test]
    fn remap_isolates_dead_peer_state() {
        let old = SharedPcmRing::new(config(2)).unwrap();
        old.attach_consumer(consumer_attach()).unwrap();
        write_u64(
            &old.inner.consumer_page,
            CONSUMER_NEXT_OFFSET,
            u64::MAX,
            Ordering::Release,
        );

        let mut next_config = config(2);
        next_config.mapping_generation += 1;
        let replacement = SharedPcmRing::new(next_config).unwrap();
        let mut producer = replacement
            .attach_producer(ProducerAttach {
                mapping_generation: 12,
                capture_epoch: 19,
            })
            .unwrap();
        assert_eq!(
            producer.publish(metadata(0), &[0.0; 8]).unwrap().peer_fault,
            None
        );
    }

    #[test]
    fn sequence_math_and_loss_ranges_wrap() {
        assert!(is_after(0, u64::MAX));
        assert!(!is_after(u64::MAX, 0));
        let range = SequenceRange {
            start: u64::MAX,
            end_exclusive: 1,
        };
        assert_eq!(range.len(), 2);

        let ring = SharedPcmRing::new(config(2)).unwrap();
        let mut producer = ring.attach_producer(producer_attach()).unwrap();
        let mut consumer = ring.attach_consumer(consumer_attach()).unwrap();
        producer.next_sequence = u64::MAX;
        producer.loss_floor = u64::MAX;
        consumer.next_sequence = u64::MAX;
        write_u64(
            &ring.inner.consumer_page,
            CONSUMER_NEXT_OFFSET,
            u64::MAX,
            Ordering::Release,
        );
        assert_eq!(
            producer.publish(metadata(0), &[0.0; 8]).unwrap().sequence,
            u64::MAX
        );
        let mut output = [0.0; 8];
        assert!(matches!(
            consumer.read_into(&mut output),
            Ok(ReadOutcome::Block(PcmBlockMetadata {
                sequence: u64::MAX,
                ..
            }))
        ));
        assert_eq!(
            producer.publish(metadata(4), &[0.0; 8]).unwrap().sequence,
            0
        );
        assert!(matches!(
            consumer.read_into(&mut output),
            Ok(ReadOutcome::Block(PcmBlockMetadata { sequence: 0, .. }))
        ));

        let stalled = SharedPcmRing::new(config(2)).unwrap();
        let mut producer = stalled.attach_producer(producer_attach()).unwrap();
        producer.next_sequence = u64::MAX;
        producer.loss_floor = u64::MAX;
        write_u64(
            &stalled.inner.consumer_page,
            CONSUMER_NEXT_OFFSET,
            u64::MAX,
            Ordering::Release,
        );
        producer.publish(metadata(0), &[0.0; 8]).unwrap();
        producer.publish(metadata(4), &[0.0; 8]).unwrap();
        assert_eq!(
            producer
                .publish(metadata(8), &[0.0; 8])
                .unwrap()
                .overwritten,
            Some(SequenceRange {
                start: u64::MAX,
                end_exclusive: 0,
            })
        );
    }

    #[test]
    fn consumer_detects_wrapped_gap_and_half_range_ambiguity() {
        let ring = SharedPcmRing::new(config(2)).unwrap();
        let mut producer = ring.attach_producer(producer_attach()).unwrap();
        let mut consumer = ring.attach_consumer(consumer_attach()).unwrap();
        producer.next_sequence = u64::MAX;
        producer.loss_floor = u64::MAX;
        consumer.next_sequence = u64::MAX - 1;
        write_u64(
            &ring.inner.consumer_page,
            CONSUMER_NEXT_OFFSET,
            u64::MAX - 1,
            Ordering::Release,
        );
        producer.publish(metadata(0), &[0.0; 8]).unwrap();
        producer.publish(metadata(4), &[0.0; 8]).unwrap();
        producer.publish(metadata(8), &[0.0; 8]).unwrap();
        let mut output = [0.0; 8];
        assert_eq!(
            consumer.read_into(&mut output),
            Ok(ReadOutcome::Gap(SequenceRange {
                start: u64::MAX - 1,
                end_exclusive: 0,
            }))
        );
        assert!(matches!(
            consumer.read_into(&mut output),
            Ok(ReadOutcome::Block(PcmBlockMetadata { sequence: 0, .. }))
        ));

        let ambiguous = SharedPcmRing::new(config(2)).unwrap();
        let mut consumer = ambiguous.attach_consumer(consumer_attach()).unwrap();
        ambiguous
            .inner
            .published_next
            .store(SERIAL_HALF_RANGE, Ordering::Release);
        assert_eq!(
            consumer.read_into(&mut output),
            Ok(ReadOutcome::RemapRequired(
                PeerFault::InvalidPublishedSequence
            ))
        );
    }

    #[test]
    fn publish_rejects_frame_index_overflow() {
        let ring = SharedPcmRing::new(config(2)).unwrap();
        let mut producer = ring.attach_producer(producer_attach()).unwrap();
        assert_eq!(
            producer.publish(metadata(u64::MAX - 3), &[0.0; 8]),
            Err(PublishError::FrameIndexOverflow)
        );
    }

    #[test]
    fn publish_hot_path_allocates_nothing() {
        let ring = SharedPcmRing::new(config(4)).unwrap();
        let mut producer = ring.attach_producer(producer_attach()).unwrap();
        let samples = [0.0; 8];
        ALLOCATIONS.with(|count| count.set(0));
        TRACK.with(|track| track.set(true));
        for frame in 0..1_000 {
            producer.publish(metadata(frame * 4), &samples).unwrap();
        }
        TRACK.with(|track| track.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
    }
}
