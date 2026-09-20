//! Single-threaded, preallocated capture-to-replay ingress model.
//!
//! One instance is bound to one capture epoch; an epoch change requires a fresh instance. A drop
//! stays pending until the downstream worker explicitly commits it after accepting the handoff.

use std::error::Error;
use std::fmt::{self, Display, Formatter};

use crate::{
    CaptureEpochId, CaptureSessionId, DiscontinuityFlags, FrameRange, MAX_MODEL_CAPACITY_BLOCKS,
    MAX_MODEL_CHANNELS, MAX_MODEL_FRAMES_PER_BLOCK, MAX_MODEL_STORAGE_BYTES, NodeBootId,
    ReplayBlockMetadata, SequenceRange,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReplayIngressConfig {
    pub node_boot_id: NodeBootId,
    pub capture_session_id: CaptureSessionId,
    pub capture_epoch: CaptureEpochId,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub frames_per_block: u16,
    pub capacity_blocks: u32,
    pub max_drop_ranges: u32,
    pub initial_capture_sequence: u64,
    pub initial_ingress_sequence: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReplayIngressError {
    ZeroIdentity,
    ZeroShape,
    ZeroCapacity,
    SequenceExhausted,
    SizeOverflow,
    AllocationFailed,
}

impl Display for ReplayIngressError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "invalid replay ingress: {self:?}")
    }
}

impl Error for ReplayIngressError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EnqueueError {
    IdentityMismatch,
    ShapeMismatch,
    InvalidFrameCount,
    SampleCountMismatch,
    FrameIntervalOverflow,
    UnexpectedCaptureSequence { expected: u64, actual: u64 },
    SequenceExhausted,
    FrameOrderRegression,
    CaptureEpochRequired,
    DropLedgerFull,
    IngressFenced,
}

impl Display for EnqueueError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "cannot enqueue replay ingress block: {self:?}")
    }
}

impl Error for EnqueueError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DroppedCaptureRange {
    pub node_boot_id: NodeBootId,
    pub capture_session_id: CaptureSessionId,
    pub capture_epoch: CaptureEpochId,
    pub ingress_sequences: SequenceRange,
    pub capture_sequences: SequenceRange,
    pub frames: FrameRange,
    pub source_gap_before: Option<FrameRange>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FencedReplayInput {
    pub metadata: ReplayBlockMetadata,
    pub source_gap_before: Option<FrameRange>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EnqueueOutcome {
    pub ingress_sequence: u64,
    pub capture_sequence: u64,
    pub dropped_oldest: Option<DroppedCaptureRange>,
    pub source_gap: Option<FrameRange>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DrainOutcome {
    Dropped(DroppedCaptureRange),
    Block {
        ingress_sequence: u64,
        metadata: ReplayBlockMetadata,
        source_gap_before: Option<FrameRange>,
    },
    IngressFenced {
        rejected: FencedReplayInput,
    },
    Empty,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IngressCommit {
    Dropped { range: DroppedCaptureRange },
    Block { ingress_sequence: u64 },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitError {
    Stale,
}

pub struct ReplayIngress {
    config: ReplayIngressConfig,
    slots: Box<[IngressSlot]>,
    head: usize,
    count: usize,
    drop_ranges: Box<[DroppedCaptureRange]>,
    drop_head: usize,
    drop_count: usize,
    expected_capture_sequence: u64,
    next_ingress_sequence: u64,
    last_frame_end: Option<u64>,
    fenced_rejection: Option<FencedReplayInput>,
}

struct IngressSlot {
    ingress_sequence: u64,
    metadata: ReplayBlockMetadata,
    source_gap_before: Option<FrameRange>,
    samples: Box<[f32]>,
}

impl ReplayIngress {
    pub fn new(config: ReplayIngressConfig) -> Result<Self, ReplayIngressError> {
        validate_config(config)?;
        let sample_capacity = usize::from(config.channels)
            .checked_mul(usize::from(config.frames_per_block))
            .ok_or(ReplayIngressError::SizeOverflow)?;
        let capacity = usize::try_from(config.capacity_blocks)
            .map_err(|_| ReplayIngressError::SizeOverflow)?;
        let drop_capacity = usize::try_from(config.max_drop_ranges)
            .map_err(|_| ReplayIngressError::SizeOverflow)?;
        let mut slots = Vec::new();
        slots
            .try_reserve_exact(capacity)
            .map_err(|_| ReplayIngressError::AllocationFailed)?;
        for _ in 0..capacity {
            let mut samples = Vec::new();
            samples
                .try_reserve_exact(sample_capacity)
                .map_err(|_| ReplayIngressError::AllocationFailed)?;
            samples.resize(sample_capacity, 0.0);
            slots.push(IngressSlot {
                ingress_sequence: config.initial_ingress_sequence,
                metadata: empty_metadata(config),
                source_gap_before: None,
                samples: samples.into_boxed_slice(),
            });
        }
        let mut drops = Vec::new();
        drops
            .try_reserve_exact(drop_capacity)
            .map_err(|_| ReplayIngressError::AllocationFailed)?;
        drops.resize(drop_capacity, empty_drop(config));
        Ok(Self {
            config,
            slots: slots.into_boxed_slice(),
            head: 0,
            count: 0,
            drop_ranges: drops.into_boxed_slice(),
            drop_head: 0,
            drop_count: 0,
            expected_capture_sequence: config.initial_capture_sequence,
            next_ingress_sequence: config.initial_ingress_sequence,
            last_frame_end: None,
            fenced_rejection: None,
        })
    }

    pub fn enqueue(
        &mut self,
        metadata: ReplayBlockMetadata,
        samples: &[f32],
    ) -> Result<EnqueueOutcome, EnqueueError> {
        if self.fenced_rejection.is_some() {
            return Err(EnqueueError::IngressFenced);
        }
        self.validate_enqueue(metadata, samples)?;
        let frame_end = metadata
            .first_frame_index
            .checked_add(u64::from(metadata.frame_count))
            .expect("validated interval");
        let source_gap = match self.last_frame_end {
            Some(previous) if metadata.first_frame_index < previous => {
                return Err(EnqueueError::FrameOrderRegression);
            }
            Some(previous) if metadata.first_frame_index > previous => Some(FrameRange {
                start: previous,
                end_exclusive: metadata.first_frame_index,
            }),
            _ => None,
        };

        // Validate ledger capacity before changing queue state or overwriting the oldest slot.
        let dropped = if self.count == self.slots.len() {
            let candidate = range_for(&self.slots[self.head]);
            if !self.can_record_drop(candidate) {
                self.fenced_rejection = Some(FencedReplayInput {
                    metadata,
                    source_gap_before: source_gap,
                });
                return Err(EnqueueError::DropLedgerFull);
            }
            self.record_drop(candidate);
            self.head = (self.head + 1) % self.slots.len();
            self.count -= 1;
            Some(candidate)
        } else {
            None
        };

        let ingress_sequence = self.next_ingress_sequence;
        let index = (self.head + self.count) % self.slots.len();
        let slot = &mut self.slots[index];
        slot.ingress_sequence = ingress_sequence;
        slot.metadata = metadata;
        slot.source_gap_before = source_gap;
        slot.samples[..samples.len()].copy_from_slice(samples);
        slot.samples[samples.len()..].fill(0.0);
        self.count += 1;
        self.expected_capture_sequence += 1;
        self.next_ingress_sequence += 1;
        self.last_frame_end = Some(frame_end);
        Ok(EnqueueOutcome {
            ingress_sequence,
            capture_sequence: metadata.sequence,
            dropped_oldest: dropped,
            source_gap,
        })
    }

    /// Peeks without consuming so a failed replay append can retry the same ingress item.
    pub fn peek_into(&self, output: &mut [f32]) -> Result<DrainOutcome, crate::ReadError> {
        if self.drop_count != 0 {
            return Ok(DrainOutcome::Dropped(self.drop_ranges[self.drop_head]));
        }
        if self.count == 0 {
            if let Some(rejected) = self.fenced_rejection {
                return Ok(DrainOutcome::IngressFenced { rejected });
            }
            return Ok(DrainOutcome::Empty);
        }
        let slot = &self.slots[self.head];
        let sample_count =
            usize::from(slot.metadata.frame_count) * usize::from(slot.metadata.channel_count);
        if output.len() < sample_count {
            return Err(crate::ReadError::OutputTooSmall);
        }
        output[..sample_count].copy_from_slice(&slot.samples[..sample_count]);
        Ok(DrainOutcome::Block {
            ingress_sequence: slot.ingress_sequence,
            metadata: slot.metadata,
            source_gap_before: slot.source_gap_before,
        })
    }

    pub fn commit(&mut self, expected: IngressCommit) -> Result<(), CommitError> {
        if self.drop_count != 0 {
            let current = self.drop_ranges[self.drop_head];
            if expected != (IngressCommit::Dropped { range: current }) {
                return Err(CommitError::Stale);
            }
            self.drop_head = (self.drop_head + 1) % self.drop_ranges.len();
            self.drop_count -= 1;
            return Ok(());
        }
        if self.count == 0 {
            return Err(CommitError::Stale);
        }
        let current = self.slots[self.head].ingress_sequence;
        if expected
            != (IngressCommit::Block {
                ingress_sequence: current,
            })
        {
            return Err(CommitError::Stale);
        }
        self.head = (self.head + 1) % self.slots.len();
        self.count -= 1;
        Ok(())
    }

    pub fn queued_blocks(&self) -> u32 {
        self.count as u32
    }

    pub fn pending_drop_ranges(&self) -> u32 {
        self.drop_count as u32
    }

    pub fn fenced_rejection(&self) -> Option<FencedReplayInput> {
        self.fenced_rejection
    }

    fn validate_enqueue(
        &self,
        metadata: ReplayBlockMetadata,
        samples: &[f32],
    ) -> Result<(), EnqueueError> {
        if metadata.node_boot_id != self.config.node_boot_id
            || metadata.capture_session_id != self.config.capture_session_id
            || metadata.capture_epoch != self.config.capture_epoch
        {
            return Err(EnqueueError::IdentityMismatch);
        }
        if metadata.sample_rate_hz != self.config.sample_rate_hz
            || metadata.channel_count != self.config.channels
        {
            return Err(EnqueueError::ShapeMismatch);
        }
        if metadata.frame_count == 0 || metadata.frame_count > self.config.frames_per_block {
            return Err(EnqueueError::InvalidFrameCount);
        }
        let expected = usize::from(metadata.frame_count) * usize::from(metadata.channel_count);
        if samples.len() != expected {
            return Err(EnqueueError::SampleCountMismatch);
        }
        if metadata
            .first_frame_index
            .checked_add(u64::from(metadata.frame_count))
            .is_none()
        {
            return Err(EnqueueError::FrameIntervalOverflow);
        }
        if metadata.sequence != self.expected_capture_sequence {
            return Err(EnqueueError::UnexpectedCaptureSequence {
                expected: self.expected_capture_sequence,
                actual: metadata.sequence,
            });
        }
        if metadata.sequence == u64::MAX || self.next_ingress_sequence == u64::MAX {
            return Err(EnqueueError::SequenceExhausted);
        }
        if self.last_frame_end.is_some()
            && (metadata
                .discontinuity
                .contains(DiscontinuityFlags::CLOCK_RESET)
                || metadata
                    .discontinuity
                    .contains(DiscontinuityFlags::DEVICE_INVALIDATED))
        {
            return Err(EnqueueError::CaptureEpochRequired);
        }
        Ok(())
    }

    fn can_record_drop(&self, dropped: DroppedCaptureRange) -> bool {
        if self.drop_count == 0 {
            return true;
        }
        let tail = (self.drop_head + self.drop_count - 1) % self.drop_ranges.len();
        can_coalesce(self.drop_ranges[tail], dropped) || self.drop_count < self.drop_ranges.len()
    }

    fn record_drop(&mut self, dropped: DroppedCaptureRange) {
        if self.drop_count != 0 {
            let tail = (self.drop_head + self.drop_count - 1) % self.drop_ranges.len();
            if can_coalesce(self.drop_ranges[tail], dropped) {
                self.drop_ranges[tail].ingress_sequences.end_exclusive =
                    dropped.ingress_sequences.end_exclusive;
                self.drop_ranges[tail].capture_sequences.end_exclusive =
                    dropped.capture_sequences.end_exclusive;
                self.drop_ranges[tail].frames.end_exclusive = dropped.frames.end_exclusive;
                return;
            }
        }
        let index = (self.drop_head + self.drop_count) % self.drop_ranges.len();
        self.drop_ranges[index] = dropped;
        self.drop_count += 1;
    }
}

fn validate_config(config: ReplayIngressConfig) -> Result<(), ReplayIngressError> {
    if config.node_boot_id.0 == [0; 16]
        || config.capture_session_id.0 == 0
        || config.capture_epoch.0 == 0
    {
        return Err(ReplayIngressError::ZeroIdentity);
    }
    if config.sample_rate_hz == 0 || config.channels == 0 || config.frames_per_block == 0 {
        return Err(ReplayIngressError::ZeroShape);
    }
    if config.capacity_blocks == 0 || config.max_drop_ranges == 0 {
        return Err(ReplayIngressError::ZeroCapacity);
    }
    if config.channels > MAX_MODEL_CHANNELS
        || config.frames_per_block > MAX_MODEL_FRAMES_PER_BLOCK
        || config.capacity_blocks > MAX_MODEL_CAPACITY_BLOCKS
        || config.max_drop_ranges > MAX_MODEL_CAPACITY_BLOCKS
    {
        return Err(ReplayIngressError::SizeOverflow);
    }
    let capacity = config.capacity_blocks as usize;
    let drop_capacity = config.max_drop_ranges as usize;
    let pcm_bytes = usize::from(config.channels)
        .checked_mul(usize::from(config.frames_per_block))
        .and_then(|value| value.checked_mul(capacity))
        .and_then(|value| value.checked_mul(size_of::<f32>()))
        .ok_or(ReplayIngressError::SizeOverflow)?;
    let storage_bytes = size_of::<IngressSlot>()
        .checked_mul(capacity)
        .and_then(|bytes| bytes.checked_add(pcm_bytes))
        .and_then(|bytes| {
            size_of::<DroppedCaptureRange>()
                .checked_mul(drop_capacity)
                .and_then(|drop_bytes| bytes.checked_add(drop_bytes))
        })
        .ok_or(ReplayIngressError::SizeOverflow)?;
    if storage_bytes > MAX_MODEL_STORAGE_BYTES {
        return Err(ReplayIngressError::SizeOverflow);
    }
    if config.initial_capture_sequence == u64::MAX || config.initial_ingress_sequence == u64::MAX {
        return Err(ReplayIngressError::SequenceExhausted);
    }
    Ok(())
}

fn range_for(slot: &IngressSlot) -> DroppedCaptureRange {
    DroppedCaptureRange {
        node_boot_id: slot.metadata.node_boot_id,
        capture_session_id: slot.metadata.capture_session_id,
        capture_epoch: slot.metadata.capture_epoch,
        ingress_sequences: SequenceRange {
            start: slot.ingress_sequence,
            end_exclusive: slot.ingress_sequence + 1,
        },
        capture_sequences: SequenceRange {
            start: slot.metadata.sequence,
            end_exclusive: slot.metadata.sequence + 1,
        },
        frames: FrameRange {
            start: slot.metadata.first_frame_index,
            end_exclusive: slot.metadata.first_frame_index + u64::from(slot.metadata.frame_count),
        },
        source_gap_before: slot.source_gap_before,
    }
}

fn can_coalesce(left: DroppedCaptureRange, right: DroppedCaptureRange) -> bool {
    left.node_boot_id == right.node_boot_id
        && left.capture_session_id == right.capture_session_id
        && left.capture_epoch == right.capture_epoch
        && left.ingress_sequences.end_exclusive == right.ingress_sequences.start
        && left.capture_sequences.end_exclusive == right.capture_sequences.start
        && left.frames.end_exclusive == right.frames.start
}

fn empty_metadata(config: ReplayIngressConfig) -> ReplayBlockMetadata {
    ReplayBlockMetadata {
        sequence: config.initial_capture_sequence,
        node_boot_id: config.node_boot_id,
        capture_session_id: config.capture_session_id,
        capture_epoch: config.capture_epoch,
        first_frame_index: 0,
        frame_count: 0,
        channel_count: config.channels,
        sample_rate_hz: config.sample_rate_hz,
        monotonic_capture_ns: None,
        discontinuity: DiscontinuityFlags::NONE,
        cumulative_source_xruns: 0,
    }
}

fn empty_drop(config: ReplayIngressConfig) -> DroppedCaptureRange {
    DroppedCaptureRange {
        node_boot_id: config.node_boot_id,
        capture_session_id: config.capture_session_id,
        capture_epoch: config.capture_epoch,
        ingress_sequences: SequenceRange {
            start: config.initial_ingress_sequence,
            end_exclusive: config.initial_ingress_sequence,
        },
        capture_sequences: SequenceRange {
            start: config.initial_capture_sequence,
            end_exclusive: config.initial_capture_sequence,
        },
        frames: FrameRange {
            start: 0,
            end_exclusive: 0,
        },
        source_gap_before: None,
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;
    use crate::tests::{ALLOCATIONS, TRACK};

    const BOOT: NodeBootId = NodeBootId(*b"node-boot-id-001");
    const SESSION: CaptureSessionId = CaptureSessionId(9);
    const EPOCH: CaptureEpochId = CaptureEpochId(12);

    fn config(capacity: u32) -> ReplayIngressConfig {
        ReplayIngressConfig {
            node_boot_id: BOOT,
            capture_session_id: SESSION,
            capture_epoch: EPOCH,
            sample_rate_hz: 48_000,
            channels: 2,
            frames_per_block: 4,
            capacity_blocks: capacity,
            max_drop_ranges: 2,
            initial_capture_sequence: 100,
            initial_ingress_sequence: 700,
        }
    }

    fn metadata(sequence: u64, frame: u64, frames: u16) -> ReplayBlockMetadata {
        ReplayBlockMetadata {
            sequence,
            node_boot_id: BOOT,
            capture_session_id: SESSION,
            capture_epoch: EPOCH,
            first_frame_index: frame,
            frame_count: frames,
            channel_count: 2,
            sample_rate_hz: 48_000,
            monotonic_capture_ns: Some(frame.saturating_mul(1_000)),
            discontinuity: DiscontinuityFlags::SOURCE_XRUN,
            cumulative_source_xruns: 4,
        }
    }

    #[test]
    fn full_queue_drops_oldest_and_coalesces_exact_ranges_before_audio() {
        let mut ingress = ReplayIngress::new(config(2)).unwrap();
        for (sequence, frame) in [(100, 0), (101, 4), (102, 8), (103, 12)] {
            ingress
                .enqueue(metadata(sequence, frame, 4), &[sequence as f32; 8])
                .unwrap();
        }
        let expected = DroppedCaptureRange {
            node_boot_id: BOOT,
            capture_session_id: SESSION,
            capture_epoch: EPOCH,
            ingress_sequences: SequenceRange {
                start: 700,
                end_exclusive: 702,
            },
            capture_sequences: SequenceRange {
                start: 100,
                end_exclusive: 102,
            },
            frames: FrameRange {
                start: 0,
                end_exclusive: 8,
            },
            source_gap_before: None,
        };
        assert_eq!(
            ingress.peek_into(&mut [0.0; 8]),
            Ok(DrainOutcome::Dropped(expected))
        );
        ingress
            .commit(IngressCommit::Dropped { range: expected })
            .unwrap();
        assert_eq!(
            ingress.peek_into(&mut [0.0; 8]),
            Ok(DrainOutcome::Block {
                ingress_sequence: 702,
                metadata: metadata(102, 8, 4),
                source_gap_before: None,
            })
        );
    }

    #[test]
    fn peek_commit_retries_same_block_and_preserves_metadata() {
        let mut ingress = ReplayIngress::new(config(2)).unwrap();
        let metadata = metadata(100, 0, 4);
        ingress.enqueue(metadata, &[3.0; 8]).unwrap();
        let mut output = [0.0; 8];
        let first = ingress.peek_into(&mut output).unwrap();
        assert_eq!(
            first,
            DrainOutcome::Block {
                ingress_sequence: 700,
                metadata,
                source_gap_before: None,
            }
        );
        assert_eq!(output, [3.0; 8]);
        // A downstream append failure performs no commit, so the exact item remains retryable.
        assert_eq!(ingress.peek_into(&mut output).unwrap(), first);
        assert_eq!(
            ingress.commit(IngressCommit::Block {
                ingress_sequence: 999
            }),
            Err(CommitError::Stale)
        );
        assert_eq!(ingress.peek_into(&mut output).unwrap(), first);
        ingress
            .commit(IngressCommit::Block {
                ingress_sequence: 700,
            })
            .unwrap();
        assert_eq!(ingress.peek_into(&mut output), Ok(DrainOutcome::Empty));
    }

    #[test]
    fn source_gap_is_distinct_from_queue_eviction() {
        let mut ingress = ReplayIngress::new(config(3)).unwrap();
        assert_eq!(
            ingress
                .enqueue(metadata(100, 0, 4), &[0.0; 8])
                .unwrap()
                .source_gap,
            None
        );
        let second = ingress.enqueue(metadata(101, 8, 4), &[0.0; 8]).unwrap();
        assert_eq!(
            second.source_gap,
            Some(FrameRange {
                start: 4,
                end_exclusive: 8,
            })
        );
        assert_eq!(second.dropped_oldest, None);
        assert_eq!(ingress.pending_drop_ranges(), 0);
        ingress
            .commit(IngressCommit::Block {
                ingress_sequence: 700,
            })
            .unwrap();
        assert_eq!(
            ingress.peek_into(&mut [0.0; 8]),
            Ok(DrainOutcome::Block {
                ingress_sequence: 701,
                metadata: metadata(101, 8, 4),
                source_gap_before: Some(FrameRange {
                    start: 4,
                    end_exclusive: 8,
                }),
            })
        );
    }

    #[test]
    fn grown_loss_range_invalidates_an_older_peek_token() {
        let mut ingress = ReplayIngress::new(config(1)).unwrap();
        ingress.enqueue(metadata(100, 0, 4), &[1.0; 8]).unwrap();
        ingress.enqueue(metadata(101, 4, 4), &[2.0; 8]).unwrap();
        let first = match ingress.peek_into(&mut [0.0; 8]).unwrap() {
            DrainOutcome::Dropped(range) => range,
            other => panic!("expected loss range, got {other:?}"),
        };
        ingress.enqueue(metadata(102, 8, 4), &[3.0; 8]).unwrap();
        assert_eq!(
            ingress.commit(IngressCommit::Dropped { range: first }),
            Err(CommitError::Stale)
        );
        let grown = match ingress.peek_into(&mut [0.0; 8]).unwrap() {
            DrainOutcome::Dropped(range) => range,
            other => panic!("expected grown loss range, got {other:?}"),
        };
        assert_eq!(grown.ingress_sequences.end_exclusive, 702);
        ingress
            .commit(IngressCommit::Dropped { range: grown })
            .unwrap();
    }

    #[test]
    fn noncoalescible_drop_ledger_saturation_fences_replay_without_hiding_input() {
        let mut cfg = config(1);
        cfg.max_drop_ranges = 1;
        let mut ingress = ReplayIngress::new(cfg).unwrap();
        ingress.enqueue(metadata(100, 0, 4), &[1.0; 8]).unwrap();
        let first_drop = ingress
            .enqueue(metadata(101, 8, 4), &[2.0; 8])
            .unwrap()
            .dropped_oldest
            .unwrap();
        let rejected_metadata = metadata(102, 16, 4);
        let rejected = FencedReplayInput {
            metadata: rejected_metadata,
            source_gap_before: Some(FrameRange {
                start: 12,
                end_exclusive: 16,
            }),
        };
        assert_eq!(
            ingress.enqueue(rejected_metadata, &[3.0; 8]),
            Err(EnqueueError::DropLedgerFull)
        );
        assert_eq!(ingress.fenced_rejection(), Some(rejected));
        assert_eq!(
            ingress.enqueue(rejected_metadata, &[3.0; 8]),
            Err(EnqueueError::IngressFenced)
        );
        assert_eq!(ingress.queued_blocks(), 1);
        assert_eq!(ingress.pending_drop_ranges(), 1);
        ingress
            .commit(IngressCommit::Dropped { range: first_drop })
            .unwrap();
        assert_eq!(
            ingress.peek_into(&mut [0.0; 8]),
            Ok(DrainOutcome::Block {
                ingress_sequence: 701,
                metadata: metadata(101, 8, 4),
                source_gap_before: Some(FrameRange {
                    start: 4,
                    end_exclusive: 8,
                }),
            })
        );
        ingress
            .commit(IngressCommit::Block {
                ingress_sequence: 701,
            })
            .unwrap();
        assert_eq!(
            ingress.peek_into(&mut [0.0; 8]),
            Ok(DrainOutcome::IngressFenced { rejected })
        );
    }

    #[test]
    fn evicted_block_keeps_its_source_gap_marker() {
        let mut ingress = ReplayIngress::new(config(1)).unwrap();
        ingress.enqueue(metadata(100, 0, 4), &[1.0; 8]).unwrap();
        ingress
            .commit(IngressCommit::Block {
                ingress_sequence: 700,
            })
            .unwrap();
        ingress.enqueue(metadata(101, 8, 4), &[2.0; 8]).unwrap();
        let dropped = ingress
            .enqueue(metadata(102, 12, 4), &[3.0; 8])
            .unwrap()
            .dropped_oldest
            .unwrap();
        assert_eq!(
            dropped.source_gap_before,
            Some(FrameRange {
                start: 4,
                end_exclusive: 8,
            })
        );
        assert_eq!(
            ingress.peek_into(&mut [0.0; 8]),
            Ok(DrainOutcome::Dropped(dropped))
        );
    }

    #[test]
    fn validates_before_eviction_and_rejects_sequence_exhaustion() {
        let mut ingress = ReplayIngress::new(config(1)).unwrap();
        ingress.enqueue(metadata(100, 0, 4), &[1.0; 8]).unwrap();
        let mut wrong = metadata(101, 4, 4);
        wrong.capture_epoch = CaptureEpochId(13);
        assert_eq!(
            ingress.enqueue(wrong, &[2.0; 8]),
            Err(EnqueueError::IdentityMismatch)
        );
        assert_eq!(ingress.pending_drop_ranges(), 0);
        assert_eq!(
            ingress.peek_into(&mut [0.0; 8]),
            Ok(DrainOutcome::Block {
                ingress_sequence: 700,
                metadata: metadata(100, 0, 4),
                source_gap_before: None,
            })
        );

        let mut reset = metadata(101, 4, 4);
        reset.discontinuity = DiscontinuityFlags::CLOCK_RESET;
        assert_eq!(
            ingress.enqueue(reset, &[2.0; 8]),
            Err(EnqueueError::CaptureEpochRequired)
        );
        let mut invalidated = metadata(101, 4, 4);
        invalidated.discontinuity = DiscontinuityFlags::DEVICE_INVALIDATED;
        assert_eq!(
            ingress.enqueue(invalidated, &[2.0; 8]),
            Err(EnqueueError::CaptureEpochRequired)
        );
        let mut fresh = ReplayIngress::new(config(1)).unwrap();
        let mut first_after_reset = metadata(100, 0, 4);
        first_after_reset.discontinuity = DiscontinuityFlags::CLOCK_RESET;
        assert!(fresh.enqueue(first_after_reset, &[2.0; 8]).is_ok());

        let mut exhausted = config(1);
        exhausted.initial_capture_sequence = u64::MAX - 1;
        let mut ingress = ReplayIngress::new(exhausted).unwrap();
        ingress
            .enqueue(metadata(u64::MAX - 1, 0, 4), &[0.0; 8])
            .unwrap();
        let mut final_metadata = metadata(u64::MAX, 4, 4);
        final_metadata.sequence = u64::MAX;
        assert_eq!(
            ingress.enqueue(final_metadata, &[0.0; 8]),
            Err(EnqueueError::SequenceExhausted)
        );

        let mut ingress_exhausted = config(1);
        ingress_exhausted.initial_ingress_sequence = u64::MAX - 1;
        let mut ingress = ReplayIngress::new(ingress_exhausted).unwrap();
        assert_eq!(
            ingress
                .enqueue(metadata(100, 0, 4), &[0.0; 8])
                .unwrap()
                .ingress_sequence,
            u64::MAX - 1
        );
        assert_eq!(
            ingress.enqueue(metadata(101, 4, 4), &[0.0; 8]),
            Err(EnqueueError::SequenceExhausted)
        );
    }

    #[test]
    fn short_block_clears_stale_tail_and_never_exposes_it() {
        let mut ingress = ReplayIngress::new(config(1)).unwrap();
        ingress.enqueue(metadata(100, 0, 4), &[9.0; 8]).unwrap();
        let dropped = ingress
            .enqueue(metadata(101, 4, 2), &[2.0; 4])
            .unwrap()
            .dropped_oldest
            .unwrap();
        assert!(
            ingress.slots[0].samples[4..]
                .iter()
                .all(|sample| *sample == 0.0)
        );
        ingress
            .commit(IngressCommit::Dropped { range: dropped })
            .unwrap();
        let mut output = [-1.0; 8];
        assert!(matches!(
            ingress.peek_into(&mut output),
            Ok(DrainOutcome::Block { .. })
        ));
        assert_eq!(&output[..4], &[2.0; 4]);
        assert_eq!(&output[4..], &[-1.0; 4]);
    }

    #[test]
    fn enqueue_peek_and_commit_allocate_nothing_after_initialization() {
        let mut ingress = ReplayIngress::new(config(2)).unwrap();
        let mut output = [0.0; 8];
        ALLOCATIONS.with(|count| count.set(0));
        TRACK.with(|track| track.set(true));
        ingress.enqueue(metadata(100, 0, 4), &[1.0; 8]).unwrap();
        assert!(matches!(
            ingress.peek_into(&mut output),
            Ok(DrainOutcome::Block { .. })
        ));
        ingress
            .commit(IngressCommit::Block {
                ingress_sequence: 700,
            })
            .unwrap();
        TRACK.with(|track| track.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
    }
}
