//! Preallocated, in-process concurrent SPSC model.
//!
//! Samples and metadata use atomic storage so concurrent overwrite/read is data-race free. This is
//! not the serialized ABI, an OS mapping, or evidence of cross-process atomic compatibility.

use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, AtomicU64, Ordering};

use crate::{AbiError, PcmAbiConfig, PcmBlockMetadata, PcmLayout, SequenceRange};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConcurrentAttachError {
    GenerationMismatch,
    EpochMismatch,
}

impl Display for ConcurrentAttachError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "cannot attach concurrent PCM endpoints: {self:?}"
        )
    }
}

impl Error for ConcurrentAttachError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConcurrentPublishError {
    EpochMismatch,
    ChannelMismatch,
    InvalidFrameCount,
    SampleCountMismatch,
    FrameIndexOverflow,
    SourceSequenceNotIncreasing,
    SequenceExhausted,
}

impl Display for ConcurrentPublishError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "cannot publish concurrent PCM block: {self:?}")
    }
}

impl Error for ConcurrentPublishError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FrameRange {
    pub start: u64,
    pub end_exclusive: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ConcurrentBlockRange {
    pub capture_epoch: u64,
    pub source_sequence: u64,
    pub frames: FrameRange,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ConcurrentOverwrittenBlock {
    pub publication_sequence: u64,
    pub source: ConcurrentBlockRange,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConcurrentPublishOutcome {
    Published {
        publication_sequence: u64,
        overwritten: Option<ConcurrentOverwrittenBlock>,
    },
    DroppedIncoming {
        source: ConcurrentBlockRange,
        dropped_newest_blocks: u64,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ConcurrentPublishedBlock {
    pub publication_sequence: u64,
    pub source: PcmBlockMetadata,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConcurrentReadOutcome {
    Empty,
    Block(ConcurrentPublishedBlock),
    Gap(SequenceRange),
    Retry,
}

pub struct ConcurrentPcmRing {
    inner: Arc<Inner>,
}

pub struct ConcurrentProducer {
    inner: Arc<Inner>,
    next_sequence: u64,
    last_source_sequence: Option<u64>,
}

pub struct ConcurrentConsumer {
    inner: Arc<Inner>,
    next_sequence: u64,
}

struct Inner {
    config: PcmAbiConfig,
    published_next: AtomicU64,
    consumed_next: AtomicU64,
    producer_overwrite: AtomicU64,
    consumer_claimed: AtomicU64,
    dropped_newest_blocks: AtomicU64,
    slots: Box<[AtomicSlot]>,
}

struct AtomicSlot {
    writing: AtomicBool,
    valid: AtomicBool,
    sequence: AtomicU64,
    source_sequence: AtomicU64,
    capture_epoch: AtomicU64,
    first_frame_index: AtomicU64,
    frame_count: AtomicU16,
    channel_count: AtomicU16,
    monotonic_present: AtomicBool,
    monotonic_capture_ns: AtomicU64,
    uncertainty_present: AtomicBool,
    timing_uncertainty_ns: AtomicU32,
    discontinuity_flags: AtomicU32,
    cumulative_source_xruns: AtomicU64,
    samples: Box<[AtomicU32]>,
}

impl ConcurrentPcmRing {
    pub fn new(config: PcmAbiConfig) -> Result<Self, AbiError> {
        PcmLayout::checked(config)?;
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
            samples.resize_with(sample_capacity, || AtomicU32::new(0));
            slots.push(AtomicSlot {
                writing: AtomicBool::new(false),
                valid: AtomicBool::new(false),
                sequence: AtomicU64::new(0),
                source_sequence: AtomicU64::new(0),
                capture_epoch: AtomicU64::new(config.capture_epoch),
                first_frame_index: AtomicU64::new(0),
                frame_count: AtomicU16::new(0),
                channel_count: AtomicU16::new(config.channels),
                monotonic_present: AtomicBool::new(false),
                monotonic_capture_ns: AtomicU64::new(0),
                uncertainty_present: AtomicBool::new(false),
                timing_uncertainty_ns: AtomicU32::new(0),
                discontinuity_flags: AtomicU32::new(0),
                cumulative_source_xruns: AtomicU64::new(0),
                samples: samples.into_boxed_slice(),
            });
        }
        Ok(Self {
            inner: Arc::new(Inner {
                config,
                published_next: AtomicU64::new(0),
                consumed_next: AtomicU64::new(0),
                producer_overwrite: AtomicU64::new(u64::MAX),
                consumer_claimed: AtomicU64::new(u64::MAX),
                dropped_newest_blocks: AtomicU64::new(0),
                slots: slots.into_boxed_slice(),
            }),
        })
    }

    pub fn split(
        self,
        mapping_generation: u64,
        capture_epoch: u64,
    ) -> Result<(ConcurrentProducer, ConcurrentConsumer), ConcurrentAttachError> {
        if mapping_generation != self.inner.config.mapping_generation {
            return Err(ConcurrentAttachError::GenerationMismatch);
        }
        if capture_epoch != self.inner.config.capture_epoch {
            return Err(ConcurrentAttachError::EpochMismatch);
        }
        Ok((
            ConcurrentProducer {
                inner: Arc::clone(&self.inner),
                next_sequence: 0,
                last_source_sequence: None,
            },
            ConcurrentConsumer {
                inner: self.inner,
                next_sequence: 0,
            },
        ))
    }
}

impl ConcurrentProducer {
    #[must_use]
    pub fn dropped_newest_blocks(&self) -> u64 {
        self.inner.dropped_newest_blocks.load(Ordering::Relaxed)
    }

    /// Attempts one source block exactly once.
    ///
    /// `DroppedIncoming` is terminal for that source block. Source sequences must increase without
    /// reuse across both published and dropped inputs; publication sequences remain separate and
    /// contiguous so source gaps stay visible.
    pub fn publish(
        &mut self,
        metadata: PcmBlockMetadata,
        samples: &[f32],
    ) -> Result<ConcurrentPublishOutcome, ConcurrentPublishError> {
        validate_block(self.inner.config, metadata, samples)?;
        if self
            .last_source_sequence
            .is_some_and(|previous| metadata.sequence <= previous)
        {
            return Err(ConcurrentPublishError::SourceSequenceNotIncreasing);
        }
        if self.next_sequence == u64::MAX {
            return Err(ConcurrentPublishError::SequenceExhausted);
        }
        let sequence = self.next_sequence;
        let capacity = u64::from(self.inner.config.capacity);
        let slot = &self.inner.slots[(sequence % capacity) as usize];
        let victim = slot
            .valid
            .load(Ordering::Acquire)
            .then(|| slot.sequence.load(Ordering::Acquire));
        let overwrite_claim = victim.map(|victim| {
            self.inner
                .producer_overwrite
                .store(victim, Ordering::SeqCst);
            ProducerOverwriteClaim {
                state: &self.inner.producer_overwrite,
            }
        });
        if victim.is_some_and(|victim| self.inner.consumer_claimed.load(Ordering::SeqCst) == victim)
        {
            drop(overwrite_claim);
            let dropped_newest_blocks = self
                .inner
                .dropped_newest_blocks
                .load(Ordering::Relaxed)
                .saturating_add(1);
            self.inner
                .dropped_newest_blocks
                .store(dropped_newest_blocks, Ordering::Relaxed);
            self.last_source_sequence = Some(metadata.sequence);
            return Ok(ConcurrentPublishOutcome::DroppedIncoming {
                source: block_range(metadata),
                dropped_newest_blocks,
            });
        }

        // The intent/claim handshake has made the victim stable. Re-read consumer progress only
        // after that arbitration so a block completed before our intent is never also reported as
        // lost.
        let consumed = self.inner.consumed_next.load(Ordering::Acquire);
        let overwritten = victim
            .filter(|victim_sequence| *victim_sequence >= consumed)
            .map(|publication_sequence| ConcurrentOverwrittenBlock {
                publication_sequence,
                source: block_range(load_metadata(slot)),
            });
        slot.writing.store(true, Ordering::SeqCst);
        slot.valid.store(false, Ordering::Relaxed);
        slot.capture_epoch
            .store(metadata.capture_epoch, Ordering::Relaxed);
        slot.first_frame_index
            .store(metadata.first_frame_index, Ordering::Relaxed);
        slot.frame_count
            .store(metadata.frame_count, Ordering::Relaxed);
        slot.channel_count
            .store(metadata.channel_count, Ordering::Relaxed);
        store_optional_u64(
            &slot.monotonic_present,
            &slot.monotonic_capture_ns,
            metadata.monotonic_capture_ns,
        );
        store_optional_u32(
            &slot.uncertainty_present,
            &slot.timing_uncertainty_ns,
            metadata.timing_uncertainty_ns,
        );
        slot.discontinuity_flags
            .store(metadata.discontinuity_flags, Ordering::Relaxed);
        slot.cumulative_source_xruns
            .store(metadata.cumulative_source_xruns, Ordering::Relaxed);
        slot.source_sequence
            .store(metadata.sequence, Ordering::Relaxed);
        for (destination, sample) in slot.samples.iter().zip(samples) {
            destination.store(sample.to_bits(), Ordering::Relaxed);
        }
        for destination in &slot.samples[samples.len()..] {
            destination.store(0, Ordering::Relaxed);
        }
        slot.sequence.store(sequence, Ordering::Relaxed);
        slot.valid.store(true, Ordering::Release);
        slot.writing.store(false, Ordering::SeqCst);
        drop(overwrite_claim);

        self.next_sequence = sequence + 1;
        self.last_source_sequence = Some(metadata.sequence);
        self.inner
            .published_next
            .store(self.next_sequence, Ordering::Release);
        Ok(ConcurrentPublishOutcome::Published {
            publication_sequence: sequence,
            overwritten,
        })
    }
}

impl ConcurrentConsumer {
    pub fn read_into(
        &mut self,
        output: &mut [f32],
    ) -> Result<ConcurrentReadOutcome, crate::ReadError> {
        let published = self.inner.published_next.load(Ordering::Acquire);
        if self.next_sequence == published {
            return Ok(ConcurrentReadOutcome::Empty);
        }
        let capacity = u64::from(self.inner.config.capacity);
        let available = published - self.next_sequence;
        if available > capacity {
            let earliest = published - capacity;
            let gap = SequenceRange {
                start: self.next_sequence,
                end_exclusive: earliest,
            };
            self.next_sequence = earliest;
            self.inner.consumed_next.store(earliest, Ordering::Release);
            return Ok(ConcurrentReadOutcome::Gap(gap));
        }

        let slot = &self.inner.slots[(self.next_sequence % capacity) as usize];
        self.inner
            .consumer_claimed
            .store(self.next_sequence, Ordering::SeqCst);
        let consumer_claim = ConsumerClaim {
            state: &self.inner.consumer_claimed,
        };
        if self.inner.producer_overwrite.load(Ordering::SeqCst) == self.next_sequence {
            return Ok(ConcurrentReadOutcome::Retry);
        }
        if slot.writing.load(Ordering::SeqCst) || !slot.valid.load(Ordering::Acquire) {
            return Ok(ConcurrentReadOutcome::Retry);
        }
        let sequence_before = slot.sequence.load(Ordering::Acquire);
        if sequence_before != self.next_sequence {
            return Ok(ConcurrentReadOutcome::Retry);
        }
        let metadata = load_metadata(slot);
        let sample_count = usize::from(metadata.frame_count) * usize::from(metadata.channel_count);
        if output.len() < sample_count {
            return Err(crate::ReadError::OutputTooSmall);
        }
        for (destination, sample) in output.iter_mut().zip(&slot.samples[..sample_count]) {
            *destination = f32::from_bits(sample.load(Ordering::Relaxed));
        }
        if slot.writing.load(Ordering::SeqCst)
            || !slot.valid.load(Ordering::Acquire)
            || slot.sequence.load(Ordering::Acquire) != sequence_before
        {
            return Ok(ConcurrentReadOutcome::Retry);
        }
        self.next_sequence += 1;
        self.inner
            .consumed_next
            .store(self.next_sequence, Ordering::Release);
        drop(consumer_claim);
        Ok(ConcurrentReadOutcome::Block(ConcurrentPublishedBlock {
            publication_sequence: sequence_before,
            source: metadata,
        }))
    }
}

struct ProducerOverwriteClaim<'a> {
    state: &'a AtomicU64,
}

impl Drop for ProducerOverwriteClaim<'_> {
    fn drop(&mut self) {
        self.state.store(u64::MAX, Ordering::SeqCst);
    }
}

struct ConsumerClaim<'a> {
    state: &'a AtomicU64,
}

impl Drop for ConsumerClaim<'_> {
    fn drop(&mut self) {
        self.state.store(u64::MAX, Ordering::SeqCst);
    }
}

fn validate_block(
    config: PcmAbiConfig,
    metadata: PcmBlockMetadata,
    samples: &[f32],
) -> Result<(), ConcurrentPublishError> {
    if metadata.capture_epoch != config.capture_epoch {
        return Err(ConcurrentPublishError::EpochMismatch);
    }
    if metadata.channel_count != config.channels {
        return Err(ConcurrentPublishError::ChannelMismatch);
    }
    if metadata.frame_count == 0 || metadata.frame_count > config.frames_per_slot {
        return Err(ConcurrentPublishError::InvalidFrameCount);
    }
    let expected = usize::from(metadata.frame_count) * usize::from(metadata.channel_count);
    if samples.len() != expected {
        return Err(ConcurrentPublishError::SampleCountMismatch);
    }
    if metadata
        .first_frame_index
        .checked_add(u64::from(metadata.frame_count))
        .is_none()
    {
        return Err(ConcurrentPublishError::FrameIndexOverflow);
    }
    Ok(())
}

fn store_optional_u64(present: &AtomicBool, storage: &AtomicU64, value: Option<u64>) {
    if let Some(value) = value {
        storage.store(value, Ordering::Relaxed);
        present.store(true, Ordering::Relaxed);
    } else {
        present.store(false, Ordering::Relaxed);
    }
}

fn store_optional_u32(present: &AtomicBool, storage: &AtomicU32, value: Option<u32>) {
    if let Some(value) = value {
        storage.store(value, Ordering::Relaxed);
        present.store(true, Ordering::Relaxed);
    } else {
        present.store(false, Ordering::Relaxed);
    }
}

fn load_metadata(slot: &AtomicSlot) -> PcmBlockMetadata {
    PcmBlockMetadata {
        sequence: slot.source_sequence.load(Ordering::Relaxed),
        capture_epoch: slot.capture_epoch.load(Ordering::Relaxed),
        first_frame_index: slot.first_frame_index.load(Ordering::Relaxed),
        frame_count: slot.frame_count.load(Ordering::Relaxed),
        channel_count: slot.channel_count.load(Ordering::Relaxed),
        monotonic_capture_ns: slot
            .monotonic_present
            .load(Ordering::Relaxed)
            .then(|| slot.monotonic_capture_ns.load(Ordering::Relaxed)),
        timing_uncertainty_ns: slot
            .uncertainty_present
            .load(Ordering::Relaxed)
            .then(|| slot.timing_uncertainty_ns.load(Ordering::Relaxed)),
        discontinuity_flags: slot.discontinuity_flags.load(Ordering::Relaxed),
        cumulative_source_xruns: slot.cumulative_source_xruns.load(Ordering::Relaxed),
    }
}

fn block_range(metadata: PcmBlockMetadata) -> ConcurrentBlockRange {
    ConcurrentBlockRange {
        capture_epoch: metadata.capture_epoch,
        source_sequence: metadata.sequence,
        frames: FrameRange {
            start: metadata.first_frame_index,
            end_exclusive: metadata.first_frame_index + u64::from(metadata.frame_count),
        },
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    use super::*;
    use crate::SampleFormat;
    use crate::ring::tests::{ALLOCATIONS, TRACK};

    fn config(capacity: u32) -> PcmAbiConfig {
        PcmAbiConfig {
            node_boot_id: *b"node-boot-id-001",
            mapping_generation: 5,
            capture_epoch: 9,
            sample_format: SampleFormat::F32,
            channels: 2,
            frames_per_slot: 4,
            capacity,
            page_size: 4096,
        }
    }

    fn assert_send_sync<T: Send + Sync>() {}

    #[test]
    fn concurrent_endpoints_are_send_and_share_atomic_storage() {
        assert_send_sync::<ConcurrentPcmRing>();
        assert_send_sync::<ConcurrentProducer>();
        assert_send_sync::<ConcurrentConsumer>();
    }

    fn metadata(sequence: u64, frames: u16) -> PcmBlockMetadata {
        PcmBlockMetadata {
            sequence,
            capture_epoch: 9,
            first_frame_index: sequence * 4,
            frame_count: frames,
            channel_count: 2,
            monotonic_capture_ns: Some(sequence * 1_000),
            timing_uncertainty_ns: Some(25),
            discontinuity_flags: (sequence % 4) as u32,
            cumulative_source_xruns: sequence / 100,
        }
    }

    fn pattern(sequence: u64, samples: &mut [f32]) {
        for (index, sample) in samples.iter_mut().enumerate() {
            *sample = (sequence * 16 + index as u64) as f32;
        }
    }

    fn assert_pattern(sequence: u64, samples: &[f32]) {
        for (index, sample) in samples.iter().enumerate() {
            assert_eq!(*sample, (sequence * 16 + index as u64) as f32);
        }
    }

    #[test]
    fn concurrent_overwrite_never_returns_a_torn_pattern() {
        const BLOCKS: u64 = 20_000;
        let ring = ConcurrentPcmRing::new(config(16)).unwrap();
        let (mut producer, mut consumer) = ring.split(5, 9).unwrap();
        let finished = Arc::new(AtomicBool::new(false));
        let producer_finished = Arc::clone(&finished);
        let producer_thread = std::thread::spawn(move || {
            let mut samples = [0.0; 8];
            let mut dropped = 0_u64;
            for sequence in 0..BLOCKS {
                pattern(sequence, &mut samples);
                if matches!(
                    producer.publish(metadata(sequence, 4), &samples).unwrap(),
                    ConcurrentPublishOutcome::DroppedIncoming { .. }
                ) {
                    dropped += 1;
                }
            }
            producer_finished.store(true, Ordering::Release);
            dropped
        });

        let mut output = [0.0; 8];
        let mut observed = 0_u64;
        let mut lost = 0_u64;
        loop {
            let producer_is_finished = finished.load(Ordering::Acquire);
            match consumer.read_into(&mut output).unwrap() {
                ConcurrentReadOutcome::Block(metadata) => {
                    assert_pattern(metadata.source.sequence, &output);
                    assert_eq!(
                        metadata.source.first_frame_index,
                        metadata.source.sequence * 4
                    );
                    observed += 1;
                }
                ConcurrentReadOutcome::Gap(range) => lost += range.len(),
                ConcurrentReadOutcome::Empty => {
                    if producer_is_finished {
                        break;
                    }
                    std::thread::yield_now();
                }
                ConcurrentReadOutcome::Retry => std::thread::yield_now(),
            }
        }
        let dropped = producer_thread.join().unwrap();
        assert!(observed > 0);
        assert_eq!(observed + lost + dropped, BLOCKS);
    }

    #[test]
    fn forced_overwrite_reports_exact_gap_then_retained_patterns() {
        let ring = ConcurrentPcmRing::new(config(2)).unwrap();
        let (mut producer, mut consumer) = ring.split(5, 9).unwrap();
        let mut samples = [0.0; 8];
        for sequence in 0..5 {
            pattern(sequence, &mut samples);
            producer.publish(metadata(sequence, 4), &samples).unwrap();
        }
        let mut output = [0.0; 8];
        assert_eq!(
            consumer.read_into(&mut output),
            Ok(ConcurrentReadOutcome::Gap(SequenceRange {
                start: 0,
                end_exclusive: 3,
            }))
        );
        for sequence in 3..5 {
            assert_eq!(
                consumer.read_into(&mut output),
                Ok(ConcurrentReadOutcome::Block(ConcurrentPublishedBlock {
                    publication_sequence: sequence,
                    source: metadata(sequence, 4),
                }))
            );
            assert_pattern(sequence, &output);
        }
        assert_eq!(
            consumer.read_into(&mut output),
            Ok(ConcurrentReadOutcome::Empty)
        );
    }

    #[test]
    fn generation_and_epoch_are_fenced_before_endpoints_exist() {
        assert!(matches!(
            ConcurrentPcmRing::new(config(2)).unwrap().split(4, 9),
            Err(ConcurrentAttachError::GenerationMismatch)
        ));
        assert!(matches!(
            ConcurrentPcmRing::new(config(2)).unwrap().split(5, 8),
            Err(ConcurrentAttachError::EpochMismatch)
        ));

        let old = ConcurrentPcmRing::new(config(2)).unwrap();
        let (_old_producer, mut old_consumer) = old.split(5, 9).unwrap();
        let mut replacement = config(2);
        replacement.mapping_generation = 6;
        let (mut new_producer, _new_consumer) = ConcurrentPcmRing::new(replacement)
            .unwrap()
            .split(6, 9)
            .unwrap();
        assert!(new_producer.publish(metadata(0, 4), &[0.0; 8]).is_ok());
        assert_eq!(
            old_consumer.read_into(&mut [0.0; 8]),
            Ok(ConcurrentReadOutcome::Empty)
        );
    }

    #[test]
    fn short_overwrite_clears_tail_and_does_not_expose_it() {
        let ring = ConcurrentPcmRing::new(config(1)).unwrap();
        let (mut producer, mut consumer) = ring.split(5, 9).unwrap();
        producer.publish(metadata(0, 4), &[9.0; 8]).unwrap();
        producer.publish(metadata(1, 2), &[2.0; 4]).unwrap();
        let slot = &producer.inner.slots[0];
        assert!(
            slot.samples[4..]
                .iter()
                .all(|sample| sample.load(Ordering::Relaxed) == 0)
        );
        let mut output = [-1.0; 8];
        assert!(matches!(
            consumer.read_into(&mut output),
            Ok(ConcurrentReadOutcome::Gap(_))
        ));
        assert!(matches!(
            consumer.read_into(&mut output),
            Ok(ConcurrentReadOutcome::Block(_))
        ));
        assert_eq!(&output[..4], &[2.0; 4]);
        assert_eq!(&output[4..], &[-1.0; 4]);
    }

    #[test]
    fn claimed_victim_is_one_call_drop_then_later_overwrite_preserves_source_ranges() {
        let ring = ConcurrentPcmRing::new(config(1)).unwrap();
        let (mut producer, mut consumer) = ring.split(5, 9).unwrap();
        let mut first = metadata(40, 4);
        first.first_frame_index = 1_000;
        producer.publish(first, &[1.0; 8]).unwrap();

        producer.inner.consumer_claimed.store(0, Ordering::SeqCst);
        let mut dropped = metadata(44, 2);
        dropped.first_frame_index = 2_000;
        assert_eq!(
            producer.publish(dropped, &[2.0; 4]),
            Ok(ConcurrentPublishOutcome::DroppedIncoming {
                source: ConcurrentBlockRange {
                    capture_epoch: 9,
                    source_sequence: 44,
                    frames: FrameRange {
                        start: 2_000,
                        end_exclusive: 2_002,
                    },
                },
                dropped_newest_blocks: 1,
            })
        );
        assert_eq!(producer.next_sequence, 1);
        assert_eq!(producer.dropped_newest_blocks(), 1);
        assert_eq!(
            producer.publish(dropped, &[2.0; 4]),
            Err(ConcurrentPublishError::SourceSequenceNotIncreasing)
        );
        assert_eq!(producer.dropped_newest_blocks(), 1);
        producer
            .inner
            .consumer_claimed
            .store(u64::MAX, Ordering::SeqCst);

        let mut replacement = metadata(48, 4);
        replacement.first_frame_index = 3_000;
        assert_eq!(
            producer.publish(replacement, &[3.0; 8]),
            Ok(ConcurrentPublishOutcome::Published {
                publication_sequence: 1,
                overwritten: Some(ConcurrentOverwrittenBlock {
                    publication_sequence: 0,
                    source: ConcurrentBlockRange {
                        capture_epoch: 9,
                        source_sequence: 40,
                        frames: FrameRange {
                            start: 1_000,
                            end_exclusive: 1_004,
                        },
                    },
                }),
            })
        );

        let mut output = [0.0; 8];
        assert_eq!(
            consumer.read_into(&mut output),
            Ok(ConcurrentReadOutcome::Gap(SequenceRange {
                start: 0,
                end_exclusive: 1,
            }))
        );
        assert_eq!(
            consumer.read_into(&mut output),
            Ok(ConcurrentReadOutcome::Block(ConcurrentPublishedBlock {
                publication_sequence: 1,
                source: replacement,
            }))
        );
        assert_eq!(output, [3.0; 8]);
    }

    #[test]
    fn completed_consumer_progress_is_not_reported_as_overwrite_loss() {
        let ring = ConcurrentPcmRing::new(config(1)).unwrap();
        let (mut producer, _consumer) = ring.split(5, 9).unwrap();
        producer.publish(metadata(10, 4), &[1.0; 8]).unwrap();

        // Models a consumer that completed immediately before producer arbitration.
        producer.inner.consumed_next.store(1, Ordering::Release);
        assert_eq!(
            producer.publish(metadata(11, 4), &[2.0; 8]),
            Ok(ConcurrentPublishOutcome::Published {
                publication_sequence: 1,
                overwritten: None,
            })
        );
    }

    #[test]
    fn publication_sequence_exhaustion_fails_before_mutation() {
        let ring = ConcurrentPcmRing::new(config(1)).unwrap();
        let (mut producer, _consumer) = ring.split(5, 9).unwrap();
        producer.next_sequence = u64::MAX - 1;
        assert_eq!(
            producer.publish(metadata(20, 4), &[1.0; 8]),
            Ok(ConcurrentPublishOutcome::Published {
                publication_sequence: u64::MAX - 1,
                overwritten: None,
            })
        );
        let slot_sequence = producer.inner.slots[0].sequence.load(Ordering::Acquire);
        assert_eq!(
            producer.publish(metadata(21, 4), &[2.0; 8]),
            Err(ConcurrentPublishError::SequenceExhausted)
        );
        assert_eq!(producer.next_sequence, u64::MAX);
        assert_eq!(
            producer.inner.published_next.load(Ordering::Acquire),
            u64::MAX
        );
        assert_eq!(
            producer.inner.slots[0].sequence.load(Ordering::Acquire),
            slot_sequence
        );
    }

    #[test]
    fn publish_and_read_allocate_nothing_after_construction() {
        let ring = ConcurrentPcmRing::new(config(4)).unwrap();
        let (mut producer, mut consumer) = ring.split(5, 9).unwrap();
        let samples = [1.0; 8];
        let mut output = [0.0; 8];
        ALLOCATIONS.with(|count| count.set(0));
        TRACK.with(|track| track.set(true));
        for sequence in 0..1_000 {
            producer.publish(metadata(sequence, 4), &samples).unwrap();
            loop {
                match consumer.read_into(&mut output).unwrap() {
                    ConcurrentReadOutcome::Block(_) => break,
                    ConcurrentReadOutcome::Retry => {}
                    other => panic!("unexpected read outcome: {other:?}"),
                }
            }
        }
        TRACK.with(|track| track.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
    }

    #[test]
    fn overwrite_drop_and_output_error_allocate_nothing_and_release_claim() {
        let ring = ConcurrentPcmRing::new(config(1)).unwrap();
        let (mut producer, mut consumer) = ring.split(5, 9).unwrap();
        ALLOCATIONS.with(|count| count.set(0));
        TRACK.with(|track| track.set(true));

        let first = producer.publish(metadata(10, 4), &[1.0; 8]).unwrap();
        let overwrite = producer.publish(metadata(11, 4), &[2.0; 8]).unwrap();
        producer.inner.consumer_claimed.store(1, Ordering::SeqCst);
        let drop = producer.publish(metadata(12, 4), &[3.0; 8]).unwrap();
        producer
            .inner
            .consumer_claimed
            .store(u64::MAX, Ordering::SeqCst);
        let gap = consumer.read_into(&mut []).unwrap();
        let too_small = consumer.read_into(&mut []);

        TRACK.with(|track| track.set(false));
        assert!(matches!(
            first,
            ConcurrentPublishOutcome::Published {
                overwritten: None,
                ..
            }
        ));
        assert!(matches!(
            overwrite,
            ConcurrentPublishOutcome::Published {
                overwritten: Some(_),
                ..
            }
        ));
        assert!(matches!(
            drop,
            ConcurrentPublishOutcome::DroppedIncoming { .. }
        ));
        assert!(matches!(gap, ConcurrentReadOutcome::Gap(_)));
        assert_eq!(too_small, Err(crate::ReadError::OutputTooSmall));
        assert_eq!(
            producer.inner.consumer_claimed.load(Ordering::SeqCst),
            u64::MAX
        );
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
    }
}
