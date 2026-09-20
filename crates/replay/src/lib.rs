//! Preallocated deterministic model of the rolling replay PCM ring.
//!
//! The model covers bounded retention, seeking, reader isolation, and discontinuities. It is
//! single-threaded and performs no filesystem I/O, crash recovery, compression, checksumming, or
//! concurrent cross-process handoff.

use std::cell::RefCell;
use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::rc::Rc;

pub use a2_audio_host_api::{CaptureEpochId, DiscontinuityFlags};

pub const MAX_MODEL_CHANNELS: u16 = 128;
pub const MAX_MODEL_FRAMES_PER_BLOCK: u16 = 4_096;
pub const MAX_MODEL_CAPACITY_BLOCKS: u32 = 65_536;
pub const MAX_MODEL_READERS: u16 = 64;
pub const MAX_MODEL_STORAGE_BYTES: usize = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct NodeBootId(pub [u8; 16]);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct CaptureSessionId(pub u64);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReplayRingConfig {
    pub generation: u64,
    pub node_boot_id: NodeBootId,
    pub capture_session_id: CaptureSessionId,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub frames_per_block: u16,
    pub capacity_blocks: u32,
    pub max_readers: u16,
    pub initial_sequence: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReplayError {
    ZeroGeneration,
    ZeroNodeBootId,
    ZeroCaptureSession,
    ZeroSampleRate,
    ZeroChannels,
    ZeroFramesPerBlock,
    ZeroCapacity,
    ZeroReaders,
    ResourceLimitExceeded,
    SizeOverflow,
    AllocationFailed,
    WriterAlreadyAttached,
    GenerationMismatch,
    InvalidReaderPolicy,
    ReaderLimitReached,
}

impl Display for ReplayError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "invalid replay ring operation: {self:?}")
    }
}

impl Error for ReplayError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReplayBlockMetadata {
    pub sequence: u64,
    pub node_boot_id: NodeBootId,
    pub capture_session_id: CaptureSessionId,
    pub capture_epoch: CaptureEpochId,
    pub first_frame_index: u64,
    pub frame_count: u16,
    pub channel_count: u16,
    pub sample_rate_hz: u32,
    pub monotonic_capture_ns: Option<u64>,
    pub discontinuity: DiscontinuityFlags,
    pub cumulative_source_xruns: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppendError {
    ZeroCaptureEpoch,
    IdentityMismatch,
    ShapeMismatch,
    InvalidFrameCount,
    SampleCountMismatch,
    FrameIntervalOverflow,
    CaptureEpochRequired,
    CaptureEpochRegression,
    FrameOrderRegression,
    SequenceExhausted,
}

impl Display for AppendError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "cannot append replay block: {self:?}")
    }
}

impl Error for AppendError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SequenceRange {
    pub start: u64,
    pub end_exclusive: u64,
}

impl SequenceRange {
    pub fn len(self) -> u64 {
        self.end_exclusive - self.start
    }

    pub fn is_empty(self) -> bool {
        self.start == self.end_exclusive
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AppendOutcome {
    pub sequence: u64,
    pub overwritten: Option<SequenceRange>,
    pub source_gap: Option<FrameRange>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FrameRange {
    pub start: u64,
    pub end_exclusive: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RetainedEndpoint {
    pub sequence: u64,
    pub capture_epoch: CaptureEpochId,
    pub first_frame_index: u64,
    pub end_frame_exclusive: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RetainedWindow {
    pub generation: u64,
    pub sequences: SequenceRange,
    pub block_count: u32,
    pub stored_frames: u64,
    pub earliest: Option<RetainedEndpoint>,
    pub latest: Option<RetainedEndpoint>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReaderPolicy {
    pub cancel_after_lag_blocks: Option<u32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CapturePosition {
    pub epoch: CaptureEpochId,
    pub frame_index: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SeekOutcome {
    Positioned {
        sequence: u64,
        offset_frames: u16,
    },
    Gap {
        requested: CapturePosition,
        earliest_available: CapturePosition,
    },
    Empty,
    EpochUnavailable,
    NotYetAvailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadOutcome {
    Block(ReplayBlockMetadata),
    EvictionGap(SequenceRange),
    SourceGap {
        epoch: CaptureEpochId,
        missing_frames: FrameRange,
    },
    EpochBoundary {
        previous: CaptureEpochId,
        next: CaptureEpochId,
    },
    Empty,
    Cancelled {
        lag_blocks: u64,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadError {
    OutputTooSmall,
    GenerationMismatch,
}

impl Display for ReadError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "cannot read replay block: {self:?}")
    }
}

impl Error for ReadError {}

pub struct ReplayRing {
    inner: Rc<RefCell<Inner>>,
}

pub struct ReplayWriter {
    inner: Rc<RefCell<Inner>>,
}

pub struct ReplayReader {
    inner: Rc<RefCell<Inner>>,
    generation: u64,
    next_sequence: u64,
    last_epoch: Option<CaptureEpochId>,
    expected_next_frame: Option<(CaptureEpochId, u64)>,
    first_block_offset_frames: u16,
    policy: ReaderPolicy,
    cancelled_lag_blocks: Option<u64>,
}

struct Inner {
    config: ReplayRingConfig,
    writer_attached: bool,
    active_readers: u16,
    next_sequence: u64,
    retained_blocks: u32,
    stored_frames: u64,
    last_capture: Option<(CaptureEpochId, u64)>,
    slots: Box<[Slot]>,
}

struct Slot {
    metadata: ReplayBlockMetadata,
    samples: Box<[f32]>,
}

impl ReplayRing {
    pub fn new(config: ReplayRingConfig) -> Result<Self, ReplayError> {
        validate_config(config)?;
        let sample_count = usize::from(config.channels)
            .checked_mul(usize::from(config.frames_per_block))
            .ok_or(ReplayError::SizeOverflow)?;
        let capacity =
            usize::try_from(config.capacity_blocks).map_err(|_| ReplayError::SizeOverflow)?;
        let mut slots = Vec::new();
        slots
            .try_reserve_exact(capacity)
            .map_err(|_| ReplayError::AllocationFailed)?;
        for _ in 0..capacity {
            let mut samples = Vec::new();
            samples
                .try_reserve_exact(sample_count)
                .map_err(|_| ReplayError::AllocationFailed)?;
            samples.resize(sample_count, 0.0);
            slots.push(Slot {
                metadata: empty_metadata(config),
                samples: samples.into_boxed_slice(),
            });
        }
        Ok(Self {
            inner: Rc::new(RefCell::new(Inner {
                config,
                writer_attached: false,
                active_readers: 0,
                next_sequence: config.initial_sequence,
                retained_blocks: 0,
                stored_frames: 0,
                last_capture: None,
                slots: slots.into_boxed_slice(),
            })),
        })
    }

    /// Attaches the sole writer for this ring generation.
    ///
    /// Writer loss fences the ring permanently; recovery creates a new ring with a fresh
    /// generation instead of reusing possibly ambiguous writer state.
    pub fn attach_writer(&self, generation: u64) -> Result<ReplayWriter, ReplayError> {
        let mut inner = self.inner.borrow_mut();
        validate_generation(inner.config.generation, generation)?;
        if inner.writer_attached {
            return Err(ReplayError::WriterAlreadyAttached);
        }
        inner.writer_attached = true;
        drop(inner);
        Ok(ReplayWriter {
            inner: Rc::clone(&self.inner),
        })
    }

    pub fn attach_reader(
        &self,
        generation: u64,
        policy: ReaderPolicy,
    ) -> Result<ReplayReader, ReplayError> {
        let mut inner = self.inner.borrow_mut();
        validate_generation(inner.config.generation, generation)?;
        if policy.cancel_after_lag_blocks == Some(0) {
            return Err(ReplayError::InvalidReaderPolicy);
        }
        if inner.active_readers == inner.config.max_readers {
            return Err(ReplayError::ReaderLimitReached);
        }
        let next_sequence = oldest_sequence(&inner);
        inner.active_readers += 1;
        drop(inner);
        Ok(ReplayReader {
            inner: Rc::clone(&self.inner),
            generation,
            next_sequence,
            last_epoch: None,
            expected_next_frame: None,
            first_block_offset_frames: 0,
            policy,
            cancelled_lag_blocks: None,
        })
    }

    pub fn retained_window(&self) -> RetainedWindow {
        let inner = self.inner.borrow();
        let earliest = (inner.retained_blocks != 0)
            .then(|| retained_endpoint(slot_for(&inner, oldest_sequence(&inner))));
        let latest = (inner.retained_blocks != 0)
            .then(|| retained_endpoint(slot_for(&inner, inner.next_sequence - 1)));
        RetainedWindow {
            generation: inner.config.generation,
            sequences: SequenceRange {
                start: oldest_sequence(&inner),
                end_exclusive: inner.next_sequence,
            },
            block_count: inner.retained_blocks,
            stored_frames: inner.stored_frames,
            earliest,
            latest,
        }
    }
}

impl ReplayWriter {
    pub fn append(
        &mut self,
        mut metadata: ReplayBlockMetadata,
        samples: &[f32],
    ) -> Result<AppendOutcome, AppendError> {
        let mut inner = self.inner.borrow_mut();
        validate_append(inner.config, metadata, samples)?;
        if inner.next_sequence == u64::MAX {
            return Err(AppendError::SequenceExhausted);
        }
        let end_frame = metadata
            .first_frame_index
            .checked_add(u64::from(metadata.frame_count))
            .expect("validated frame interval");
        let source_gap = if let Some((epoch, previous_end)) = inner.last_capture {
            if metadata.capture_epoch.0 < epoch.0 {
                return Err(AppendError::CaptureEpochRegression);
            }
            if epoch == metadata.capture_epoch {
                if metadata
                    .discontinuity
                    .contains(DiscontinuityFlags::CLOCK_RESET)
                    || metadata
                        .discontinuity
                        .contains(DiscontinuityFlags::DEVICE_INVALIDATED)
                {
                    return Err(AppendError::CaptureEpochRequired);
                }
                if metadata.first_frame_index < previous_end {
                    return Err(AppendError::FrameOrderRegression);
                }
                (metadata.first_frame_index > previous_end).then_some(FrameRange {
                    start: previous_end,
                    end_exclusive: metadata.first_frame_index,
                })
            } else {
                None
            }
        } else {
            None
        };

        let sequence = inner.next_sequence;
        let capacity = u64::from(inner.config.capacity_blocks);
        let slot_index = (sequence % capacity) as usize;
        let overwritten = if inner.retained_blocks == inner.config.capacity_blocks {
            let oldest = sequence - capacity;
            let evicted_frames = u64::from(inner.slots[slot_index].metadata.frame_count);
            inner.stored_frames -= evicted_frames;
            Some(SequenceRange {
                start: oldest,
                end_exclusive: oldest + 1,
            })
        } else {
            inner.retained_blocks += 1;
            None
        };
        metadata.sequence = sequence;
        let slot = &mut inner.slots[slot_index];
        slot.metadata = metadata;
        slot.samples[..samples.len()].copy_from_slice(samples);
        slot.samples[samples.len()..].fill(0.0);
        inner.stored_frames += u64::from(metadata.frame_count);
        inner.next_sequence = sequence + 1;
        inner.last_capture = Some((metadata.capture_epoch, end_frame));
        Ok(AppendOutcome {
            sequence,
            overwritten,
            source_gap,
        })
    }
}

impl ReplayReader {
    pub fn seek(&mut self, target: CapturePosition) -> Result<SeekOutcome, ReadError> {
        self.check_generation()?;
        let inner = self.inner.borrow();
        if inner.retained_blocks == 0 {
            return Ok(SeekOutcome::Empty);
        }
        let oldest = oldest_sequence(&inner);
        let mut saw_epoch = false;
        for offset in 0..u64::from(inner.retained_blocks) {
            let sequence = oldest + offset;
            let slot = slot_for(&inner, sequence);
            if slot.metadata.capture_epoch != target.epoch {
                continue;
            }
            saw_epoch = true;
            if target.frame_index < slot.metadata.first_frame_index {
                let earliest_available = CapturePosition {
                    epoch: target.epoch,
                    frame_index: slot.metadata.first_frame_index,
                };
                drop(inner);
                self.position(sequence, 0);
                return Ok(SeekOutcome::Gap {
                    requested: target,
                    earliest_available,
                });
            }
            let end = block_end(slot.metadata);
            if target.frame_index < end {
                let offset_frames = (target.frame_index - slot.metadata.first_frame_index) as u16;
                drop(inner);
                self.position(sequence, offset_frames);
                return Ok(SeekOutcome::Positioned {
                    sequence,
                    offset_frames,
                });
            }
        }
        Ok(if saw_epoch {
            SeekOutcome::NotYetAvailable
        } else {
            SeekOutcome::EpochUnavailable
        })
    }

    pub fn seek_newest(&mut self) -> Result<SeekOutcome, ReadError> {
        self.check_generation()?;
        let inner = self.inner.borrow();
        if inner.retained_blocks == 0 {
            let next_sequence = inner.next_sequence;
            drop(inner);
            self.cancelled_lag_blocks = None;
            self.position(next_sequence, 0);
            return Ok(SeekOutcome::Empty);
        }
        let sequence = inner.next_sequence - 1;
        drop(inner);
        self.cancelled_lag_blocks = None;
        self.position(sequence, 0);
        Ok(SeekOutcome::Positioned {
            sequence,
            offset_frames: 0,
        })
    }

    pub fn read_into(&mut self, output: &mut [f32]) -> Result<ReadOutcome, ReadError> {
        self.check_generation()?;
        if let Some(lag_blocks) = self.cancelled_lag_blocks {
            return Ok(ReadOutcome::Cancelled { lag_blocks });
        }
        let inner = self.inner.borrow();
        let available = inner.next_sequence - self.next_sequence;
        if available == 0 {
            return Ok(ReadOutcome::Empty);
        }
        if let Some(limit) = self.policy.cancel_after_lag_blocks
            && available > u64::from(limit)
        {
            self.cancelled_lag_blocks = Some(available);
            return Ok(ReadOutcome::Cancelled {
                lag_blocks: available,
            });
        }
        let retained = u64::from(inner.retained_blocks);
        if available > retained {
            let oldest = oldest_sequence(&inner);
            let gap = SequenceRange {
                start: self.next_sequence,
                end_exclusive: oldest,
            };
            drop(inner);
            self.position(oldest, 0);
            return Ok(ReadOutcome::EvictionGap(gap));
        }

        let slot = slot_for(&inner, self.next_sequence);
        if let Some(previous) = self.last_epoch
            && previous != slot.metadata.capture_epoch
        {
            self.last_epoch = Some(slot.metadata.capture_epoch);
            self.expected_next_frame = None;
            return Ok(ReadOutcome::EpochBoundary {
                previous,
                next: slot.metadata.capture_epoch,
            });
        }
        if let Some((epoch, expected)) = self.expected_next_frame
            && epoch == slot.metadata.capture_epoch
            && expected < slot.metadata.first_frame_index
        {
            self.expected_next_frame = Some((epoch, slot.metadata.first_frame_index));
            return Ok(ReadOutcome::SourceGap {
                epoch,
                missing_frames: FrameRange {
                    start: expected,
                    end_exclusive: slot.metadata.first_frame_index,
                },
            });
        }
        let offset_frames = self.first_block_offset_frames;
        let returned_frames = slot.metadata.frame_count - offset_frames;
        let sample_offset = usize::from(offset_frames) * usize::from(slot.metadata.channel_count);
        let sample_count = usize::from(returned_frames) * usize::from(slot.metadata.channel_count);
        if output.len() < sample_count {
            return Err(ReadError::OutputTooSmall);
        }
        output[..sample_count]
            .copy_from_slice(&slot.samples[sample_offset..sample_offset + sample_count]);
        let mut metadata = slot.metadata;
        metadata.first_frame_index += u64::from(offset_frames);
        metadata.frame_count = returned_frames;
        self.last_epoch = Some(metadata.capture_epoch);
        self.expected_next_frame = Some((metadata.capture_epoch, block_end(metadata)));
        self.first_block_offset_frames = 0;
        self.next_sequence += 1;
        Ok(ReadOutcome::Block(metadata))
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled_lag_blocks.is_some()
    }

    fn check_generation(&self) -> Result<(), ReadError> {
        if self.inner.borrow().config.generation != self.generation {
            return Err(ReadError::GenerationMismatch);
        }
        Ok(())
    }

    fn position(&mut self, sequence: u64, offset_frames: u16) {
        self.next_sequence = sequence;
        self.last_epoch = None;
        self.expected_next_frame = None;
        self.first_block_offset_frames = offset_frames;
    }
}

impl Drop for ReplayReader {
    fn drop(&mut self) {
        self.inner.borrow_mut().active_readers -= 1;
    }
}

fn validate_config(config: ReplayRingConfig) -> Result<(), ReplayError> {
    if config.generation == 0 {
        return Err(ReplayError::ZeroGeneration);
    }
    if config.node_boot_id.0 == [0; 16] {
        return Err(ReplayError::ZeroNodeBootId);
    }
    if config.capture_session_id.0 == 0 {
        return Err(ReplayError::ZeroCaptureSession);
    }
    if config.sample_rate_hz == 0 {
        return Err(ReplayError::ZeroSampleRate);
    }
    if config.channels == 0 {
        return Err(ReplayError::ZeroChannels);
    }
    if config.frames_per_block == 0 {
        return Err(ReplayError::ZeroFramesPerBlock);
    }
    if config.capacity_blocks == 0 {
        return Err(ReplayError::ZeroCapacity);
    }
    if config.max_readers == 0 {
        return Err(ReplayError::ZeroReaders);
    }
    if config.channels > MAX_MODEL_CHANNELS
        || config.frames_per_block > MAX_MODEL_FRAMES_PER_BLOCK
        || config.capacity_blocks > MAX_MODEL_CAPACITY_BLOCKS
        || config.max_readers > MAX_MODEL_READERS
    {
        return Err(ReplayError::ResourceLimitExceeded);
    }
    let samples_per_block = usize::from(config.channels)
        .checked_mul(usize::from(config.frames_per_block))
        .ok_or(ReplayError::SizeOverflow)?;
    let capacity =
        usize::try_from(config.capacity_blocks).map_err(|_| ReplayError::SizeOverflow)?;
    let pcm_bytes = samples_per_block
        .checked_mul(std::mem::size_of::<f32>())
        .and_then(|bytes| bytes.checked_mul(capacity))
        .ok_or(ReplayError::SizeOverflow)?;
    let slot_bytes = std::mem::size_of::<Slot>()
        .checked_mul(capacity)
        .ok_or(ReplayError::SizeOverflow)?;
    if pcm_bytes
        .checked_add(slot_bytes)
        .ok_or(ReplayError::SizeOverflow)?
        > MAX_MODEL_STORAGE_BYTES
    {
        return Err(ReplayError::ResourceLimitExceeded);
    }
    if config.initial_sequence == u64::MAX {
        return Err(ReplayError::SizeOverflow);
    }
    Ok(())
}

fn validate_generation(expected: u64, actual: u64) -> Result<(), ReplayError> {
    if expected != actual {
        return Err(ReplayError::GenerationMismatch);
    }
    Ok(())
}

fn validate_append(
    config: ReplayRingConfig,
    metadata: ReplayBlockMetadata,
    samples: &[f32],
) -> Result<(), AppendError> {
    if metadata.capture_epoch.0 == 0 {
        return Err(AppendError::ZeroCaptureEpoch);
    }
    if metadata.node_boot_id != config.node_boot_id
        || metadata.capture_session_id != config.capture_session_id
    {
        return Err(AppendError::IdentityMismatch);
    }
    if metadata.channel_count != config.channels || metadata.sample_rate_hz != config.sample_rate_hz
    {
        return Err(AppendError::ShapeMismatch);
    }
    if metadata.frame_count == 0 || metadata.frame_count > config.frames_per_block {
        return Err(AppendError::InvalidFrameCount);
    }
    let expected = usize::from(metadata.channel_count) * usize::from(metadata.frame_count);
    if samples.len() != expected {
        return Err(AppendError::SampleCountMismatch);
    }
    if metadata
        .first_frame_index
        .checked_add(u64::from(metadata.frame_count))
        .is_none()
    {
        return Err(AppendError::FrameIntervalOverflow);
    }
    Ok(())
}

fn oldest_sequence(inner: &Inner) -> u64 {
    inner.next_sequence - u64::from(inner.retained_blocks)
}

fn slot_for(inner: &Inner, sequence: u64) -> &Slot {
    let index = (sequence % u64::from(inner.config.capacity_blocks)) as usize;
    &inner.slots[index]
}

fn block_end(metadata: ReplayBlockMetadata) -> u64 {
    metadata.first_frame_index + u64::from(metadata.frame_count)
}

fn retained_endpoint(slot: &Slot) -> RetainedEndpoint {
    RetainedEndpoint {
        sequence: slot.metadata.sequence,
        capture_epoch: slot.metadata.capture_epoch,
        first_frame_index: slot.metadata.first_frame_index,
        end_frame_exclusive: block_end(slot.metadata),
    }
}

fn empty_metadata(config: ReplayRingConfig) -> ReplayBlockMetadata {
    ReplayBlockMetadata {
        sequence: config.initial_sequence,
        node_boot_id: config.node_boot_id,
        capture_session_id: config.capture_session_id,
        capture_epoch: CaptureEpochId(0),
        first_frame_index: 0,
        frame_count: 0,
        channel_count: config.channels,
        sample_rate_hz: config.sample_rate_hz,
        monotonic_capture_ns: None,
        discontinuity: DiscontinuityFlags::NONE,
        cumulative_source_xruns: 0,
    }
}

#[cfg(test)]
mod tests {
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;

    use super::*;

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

    const BOOT: NodeBootId = NodeBootId(*b"node-boot-id-001");
    const SESSION: CaptureSessionId = CaptureSessionId(5);
    const EPOCH_A: CaptureEpochId = CaptureEpochId(7);
    const EPOCH_B: CaptureEpochId = CaptureEpochId(8);

    fn config(capacity_blocks: u32) -> ReplayRingConfig {
        ReplayRingConfig {
            generation: 3,
            node_boot_id: BOOT,
            capture_session_id: SESSION,
            sample_rate_hz: 48_000,
            channels: 2,
            frames_per_block: 4,
            capacity_blocks,
            max_readers: 2,
            initial_sequence: 0,
        }
    }

    fn metadata(epoch: CaptureEpochId, frame: u64, frames: u16) -> ReplayBlockMetadata {
        ReplayBlockMetadata {
            sequence: u64::MAX,
            node_boot_id: BOOT,
            capture_session_id: SESSION,
            capture_epoch: epoch,
            first_frame_index: frame,
            frame_count: frames,
            channel_count: 2,
            sample_rate_hz: 48_000,
            monotonic_capture_ns: Some(frame.saturating_mul(1_000)),
            discontinuity: DiscontinuityFlags::NONE,
            cumulative_source_xruns: 0,
        }
    }

    fn samples(frames: u16, value: f32) -> Vec<f32> {
        vec![value; usize::from(frames) * 2]
    }

    fn no_cancel() -> ReaderPolicy {
        ReaderPolicy {
            cancel_after_lag_blocks: None,
        }
    }

    #[test]
    fn overwrite_oldest_has_exact_retained_endpoints_and_does_not_pin_writer() {
        let ring = ReplayRing::new(config(2)).unwrap();
        let mut writer = ring.attach_writer(3).unwrap();
        let mut slow = ring.attach_reader(3, no_cancel()).unwrap();
        assert_eq!(
            writer
                .append(metadata(EPOCH_A, 0, 4), &samples(4, 1.0))
                .unwrap()
                .overwritten,
            None
        );
        assert_eq!(
            writer
                .append(metadata(EPOCH_A, 4, 4), &samples(4, 2.0))
                .unwrap()
                .overwritten,
            None
        );
        assert_eq!(
            writer
                .append(metadata(EPOCH_A, 8, 4), &samples(4, 3.0))
                .unwrap()
                .overwritten,
            Some(SequenceRange {
                start: 0,
                end_exclusive: 1
            })
        );
        assert_eq!(
            ring.retained_window(),
            RetainedWindow {
                generation: 3,
                sequences: SequenceRange {
                    start: 1,
                    end_exclusive: 3
                },
                block_count: 2,
                stored_frames: 8,
                earliest: Some(RetainedEndpoint {
                    sequence: 1,
                    capture_epoch: EPOCH_A,
                    first_frame_index: 4,
                    end_frame_exclusive: 8,
                }),
                latest: Some(RetainedEndpoint {
                    sequence: 2,
                    capture_epoch: EPOCH_A,
                    first_frame_index: 8,
                    end_frame_exclusive: 12,
                }),
            }
        );
        assert_eq!(
            slow.read_into(&mut [0.0; 8]),
            Ok(ReadOutcome::EvictionGap(SequenceRange {
                start: 0,
                end_exclusive: 1
            }))
        );
    }

    #[test]
    fn independent_readers_do_not_move_each_others_cursor() {
        let ring = ReplayRing::new(config(3)).unwrap();
        let mut writer = ring.attach_writer(3).unwrap();
        writer
            .append(metadata(EPOCH_A, 0, 4), &samples(4, 1.0))
            .unwrap();
        let mut first = ring.attach_reader(3, no_cancel()).unwrap();
        let mut second = ring.attach_reader(3, no_cancel()).unwrap();
        let mut output = [0.0; 8];
        assert!(matches!(
            first.read_into(&mut output),
            Ok(ReadOutcome::Block(_))
        ));
        assert!(matches!(
            second.read_into(&mut output),
            Ok(ReadOutcome::Block(_))
        ));
        assert_eq!(first.read_into(&mut output), Ok(ReadOutcome::Empty));
        assert_eq!(second.read_into(&mut output), Ok(ReadOutcome::Empty));
    }

    #[test]
    fn reports_source_gap_separately_and_never_hides_epoch_change() {
        let ring = ReplayRing::new(config(4)).unwrap();
        let mut writer = ring.attach_writer(3).unwrap();
        writer
            .append(metadata(EPOCH_A, 0, 4), &samples(4, 1.0))
            .unwrap();
        let gap = writer
            .append(metadata(EPOCH_A, 8, 4), &samples(4, 2.0))
            .unwrap();
        assert_eq!(
            gap.source_gap,
            Some(FrameRange {
                start: 4,
                end_exclusive: 8
            })
        );
        let mut changed = metadata(EPOCH_B, 0, 4);
        changed.discontinuity = DiscontinuityFlags::DEVICE_INVALIDATED;
        writer.append(changed, &samples(4, 3.0)).unwrap();

        let mut reader = ring.attach_reader(3, no_cancel()).unwrap();
        let mut output = [0.0; 8];
        assert!(matches!(
            reader.read_into(&mut output),
            Ok(ReadOutcome::Block(_))
        ));
        assert_eq!(
            reader.read_into(&mut output),
            Ok(ReadOutcome::SourceGap {
                epoch: EPOCH_A,
                missing_frames: FrameRange {
                    start: 4,
                    end_exclusive: 8
                },
            })
        );
        assert!(matches!(
            reader.read_into(&mut output),
            Ok(ReadOutcome::Block(_))
        ));
        assert_eq!(
            reader.read_into(&mut output),
            Ok(ReadOutcome::EpochBoundary {
                previous: EPOCH_A,
                next: EPOCH_B
            })
        );
        assert_eq!(
            reader.read_into(&mut output),
            Ok(ReadOutcome::Block(ReplayBlockMetadata {
                sequence: 2,
                ..changed
            }))
        );
    }

    #[test]
    fn seek_reports_retention_gap_and_positions_inside_block() {
        let ring = ReplayRing::new(config(2)).unwrap();
        let mut writer = ring.attach_writer(3).unwrap();
        for frame in [0, 4, 8] {
            writer
                .append(metadata(EPOCH_A, frame, 4), &samples(4, 1.0))
                .unwrap();
        }
        let mut reader = ring.attach_reader(3, no_cancel()).unwrap();
        assert_eq!(
            reader.seek(CapturePosition {
                epoch: EPOCH_A,
                frame_index: 1
            }),
            Ok(SeekOutcome::Gap {
                requested: CapturePosition {
                    epoch: EPOCH_A,
                    frame_index: 1
                },
                earliest_available: CapturePosition {
                    epoch: EPOCH_A,
                    frame_index: 4
                },
            })
        );
        assert_eq!(
            reader.seek(CapturePosition {
                epoch: EPOCH_A,
                frame_index: 10
            }),
            Ok(SeekOutcome::Positioned {
                sequence: 2,
                offset_frames: 2
            })
        );
        let mut output = [-1.0; 8];
        assert_eq!(
            reader.read_into(&mut output),
            Ok(ReadOutcome::Block(ReplayBlockMetadata {
                first_frame_index: 10,
                frame_count: 2,
                sequence: 2,
                ..metadata(EPOCH_A, 8, 4)
            }))
        );
        assert_eq!(&output[..4], &[1.0; 4]);
        assert_eq!(&output[4..], &[-1.0; 4]);
    }

    #[test]
    fn slow_reader_is_cancelled_and_can_explicitly_seek_newest() {
        let ring = ReplayRing::new(config(4)).unwrap();
        let mut writer = ring.attach_writer(3).unwrap();
        let mut reader = ring
            .attach_reader(
                3,
                ReaderPolicy {
                    cancel_after_lag_blocks: Some(2),
                },
            )
            .unwrap();
        for frame in [0, 4, 8] {
            writer
                .append(metadata(EPOCH_A, frame, 4), &samples(4, 1.0))
                .unwrap();
        }
        assert_eq!(
            reader.read_into(&mut [0.0; 8]),
            Ok(ReadOutcome::Cancelled { lag_blocks: 3 })
        );
        assert!(reader.is_cancelled());
        assert_eq!(
            reader.read_into(&mut [0.0; 8]),
            Ok(ReadOutcome::Cancelled { lag_blocks: 3 })
        );
        assert_eq!(
            reader.seek_newest(),
            Ok(SeekOutcome::Positioned {
                sequence: 2,
                offset_frames: 0
            })
        );
        assert!(matches!(
            reader.read_into(&mut [0.0; 8]),
            Ok(ReadOutcome::Block(_))
        ));
    }

    #[test]
    fn generation_fence_and_reader_admission_are_bounded() {
        let ring = ReplayRing::new(config(1)).unwrap();
        assert!(matches!(
            ring.attach_reader(2, no_cancel()),
            Err(ReplayError::GenerationMismatch)
        ));
        let first = ring.attach_reader(3, no_cancel()).unwrap();
        let second = ring.attach_reader(3, no_cancel()).unwrap();
        assert!(matches!(
            ring.attach_reader(3, no_cancel()),
            Err(ReplayError::ReaderLimitReached)
        ));
        drop(first);
        ring.attach_reader(3, no_cancel()).unwrap();
        drop(second);
    }

    #[test]
    fn short_block_clears_stale_tail_and_output_bounds_are_checked() {
        let ring = ReplayRing::new(config(1)).unwrap();
        let mut writer = ring.attach_writer(3).unwrap();
        writer
            .append(metadata(EPOCH_A, 0, 4), &samples(4, 9.0))
            .unwrap();
        writer
            .append(metadata(EPOCH_A, 4, 2), &samples(2, 2.0))
            .unwrap();
        assert!(
            ring.inner.borrow().slots[0].samples[4..]
                .iter()
                .all(|sample| *sample == 0.0)
        );
        let mut reader = ring.attach_reader(3, no_cancel()).unwrap();
        assert_eq!(
            reader.read_into(&mut [0.0; 3]),
            Err(ReadError::OutputTooSmall)
        );
        let mut output = [-1.0; 8];
        assert!(matches!(
            reader.read_into(&mut output),
            Ok(ReadOutcome::Block(_))
        ));
        assert_eq!(&output[..4], &[2.0; 4]);
        assert_eq!(&output[4..], &[-1.0; 4]);
    }

    #[test]
    fn rejects_identity_shape_order_frame_and_sequence_boundaries() {
        let ring = ReplayRing::new(config(2)).unwrap();
        let mut writer = ring.attach_writer(3).unwrap();
        let mut wrong = metadata(EPOCH_A, 0, 4);
        wrong.capture_session_id = CaptureSessionId(6);
        assert_eq!(
            writer.append(wrong, &samples(4, 1.0)),
            Err(AppendError::IdentityMismatch)
        );
        assert_eq!(
            writer.append(metadata(EPOCH_A, u64::MAX - 2, 4), &samples(4, 1.0)),
            Err(AppendError::FrameIntervalOverflow)
        );
        writer
            .append(metadata(EPOCH_A, u64::MAX - 1, 1), &samples(1, 1.0))
            .unwrap();
        assert_eq!(
            writer.append(metadata(EPOCH_A, u64::MAX, 1), &samples(1, 1.0)),
            Err(AppendError::FrameIntervalOverflow)
        );
        let ring = ReplayRing::new(config(2)).unwrap();
        let mut writer = ring.attach_writer(3).unwrap();
        writer
            .append(metadata(EPOCH_A, 4, 4), &samples(4, 1.0))
            .unwrap();
        assert_eq!(
            writer.append(metadata(EPOCH_A, 3, 4), &samples(4, 1.0)),
            Err(AppendError::FrameOrderRegression)
        );
        let mut clock_reset = metadata(EPOCH_A, 8, 4);
        clock_reset.discontinuity = DiscontinuityFlags::CLOCK_RESET;
        assert_eq!(
            writer.append(clock_reset, &samples(4, 1.0)),
            Err(AppendError::CaptureEpochRequired)
        );
        writer
            .append(metadata(EPOCH_B, 0, 4), &samples(4, 1.0))
            .unwrap();
        assert_eq!(
            writer.append(metadata(EPOCH_A, 8, 4), &samples(4, 1.0)),
            Err(AppendError::CaptureEpochRegression)
        );

        let mut near_end = config(1);
        near_end.initial_sequence = u64::MAX - 1;
        let end_ring = ReplayRing::new(near_end).unwrap();
        let mut end_writer = end_ring.attach_writer(3).unwrap();
        assert_eq!(
            end_writer
                .append(metadata(EPOCH_A, 0, 4), &samples(4, 1.0))
                .unwrap()
                .sequence,
            u64::MAX - 1
        );
        assert_eq!(
            end_writer.append(metadata(EPOCH_A, 4, 4), &samples(4, 1.0)),
            Err(AppendError::SequenceExhausted)
        );
    }

    #[test]
    fn rejects_dimensions_and_total_storage_above_model_limits() {
        let mut oversized = config(1);
        oversized.channels = MAX_MODEL_CHANNELS + 1;
        assert!(matches!(
            ReplayRing::new(oversized),
            Err(ReplayError::ResourceLimitExceeded)
        ));

        oversized = config(1);
        oversized.frames_per_block = MAX_MODEL_FRAMES_PER_BLOCK + 1;
        assert!(matches!(
            ReplayRing::new(oversized),
            Err(ReplayError::ResourceLimitExceeded)
        ));

        oversized = config(MAX_MODEL_CAPACITY_BLOCKS + 1);
        assert!(matches!(
            ReplayRing::new(oversized),
            Err(ReplayError::ResourceLimitExceeded)
        ));

        oversized = config(1);
        oversized.max_readers = MAX_MODEL_READERS + 1;
        assert!(matches!(
            ReplayRing::new(oversized),
            Err(ReplayError::ResourceLimitExceeded)
        ));

        oversized = config(2_048);
        oversized.channels = MAX_MODEL_CHANNELS;
        oversized.frames_per_block = 480;
        assert!(matches!(
            ReplayRing::new(oversized),
            Err(ReplayError::ResourceLimitExceeded)
        ));
    }

    #[test]
    fn writer_loss_fences_the_generation_and_mixed_blocks_report_exact_storage() {
        let ring = ReplayRing::new(config(2)).unwrap();
        let mut writer = ring.attach_writer(3).unwrap();
        writer
            .append(metadata(EPOCH_A, 0, 1), &samples(1, 1.0))
            .unwrap();
        writer
            .append(metadata(EPOCH_A, 1, 3), &samples(3, 1.0))
            .unwrap();
        assert_eq!(ring.retained_window().stored_frames, 4);
        writer
            .append(metadata(EPOCH_A, 4, 2), &samples(2, 1.0))
            .unwrap();
        assert_eq!(ring.retained_window().stored_frames, 5);
        drop(writer);
        assert!(matches!(
            ring.attach_writer(3),
            Err(ReplayError::WriterAlreadyAttached)
        ));
    }

    #[test]
    fn append_and_read_paths_allocate_nothing_after_construction() {
        let ring = ReplayRing::new(config(4)).unwrap();
        let mut writer = ring.attach_writer(3).unwrap();
        let mut reader = ring.attach_reader(3, no_cancel()).unwrap();
        let input = [1.0; 8];
        let mut output = [0.0; 8];
        ALLOCATIONS.with(|count| count.set(0));
        TRACK.with(|track| track.set(true));
        for index in 0..4 {
            writer
                .append(metadata(EPOCH_A, index * 4, 4), &input)
                .unwrap();
            assert!(matches!(
                reader.read_into(&mut output),
                Ok(ReadOutcome::Block(_))
            ));
        }
        TRACK.with(|track| track.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
    }
}
