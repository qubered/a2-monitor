use a2_audio_host_api::{CaptureBlock, CaptureBlockMetadata};
use std::cell::UnsafeCell;
use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RingConfig {
    pub capacity_blocks: usize,
    pub channels: u16,
    pub frames_per_block: u16,
}

impl RingConfig {
    fn samples_per_block(self) -> Option<usize> {
        usize::from(self.channels).checked_mul(usize::from(self.frames_per_block))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RingConfigError {
    ZeroCapacity,
    ZeroChannels,
    ZeroFramesPerBlock,
    SizeOverflow,
}

impl Display for RingConfigError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "invalid PCM ring configuration: {self:?}")
    }
}

impl Error for RingConfigError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PushError {
    Full,
    ShapeMismatch,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PopError {
    OutputTooSmall { required: usize },
}

impl Display for PopError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "PCM ring pop failed: {self:?}")
    }
}

impl Error for PopError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RingMetrics {
    pub pushed_blocks: u64,
    pub popped_blocks: u64,
    pub dropped_newest_blocks: u64,
}

struct Slot {
    metadata: CaptureBlockMetadata,
    samples: Box<[f32]>,
}

/// A fixed-capacity, single-producer/single-consumer in-process PCM ring.
///
/// All storage is allocated by `new`. `try_push` and `try_pop_into` perform no
/// allocation, take no locks, and never wait. A full ring drops the newest
/// block and increments a diagnostic counter; the shared-memory overwrite ABI
/// is intentionally deferred to its separately claimed IPC work.
pub struct SpscPcmRing {
    config: RingConfig,
    slots: Box<[UnsafeCell<Slot>]>,
    read_position: AtomicUsize,
    write_position: AtomicUsize,
    endpoints_claimed: AtomicBool,
    pushed_blocks: AtomicU64,
    popped_blocks: AtomicU64,
    dropped_newest_blocks: AtomicU64,
}

// Safety: after `split`, only Producer writes at write_position and only
// Consumer reads at read_position. Release/acquire publication prevents a slot
// from being read before its write completes. A full slot is never overwritten.
unsafe impl Sync for SpscPcmRing {}

impl SpscPcmRing {
    pub fn new(config: RingConfig) -> Result<Arc<Self>, RingConfigError> {
        if config.capacity_blocks == 0 {
            return Err(RingConfigError::ZeroCapacity);
        }
        if config.channels == 0 {
            return Err(RingConfigError::ZeroChannels);
        }
        if config.frames_per_block == 0 {
            return Err(RingConfigError::ZeroFramesPerBlock);
        }
        let samples_per_block = config
            .samples_per_block()
            .ok_or(RingConfigError::SizeOverflow)?;
        // One sentinel slot distinguishes full from empty while preserving the
        // configured number of usable blocks.
        let slot_count = config
            .capacity_blocks
            .checked_add(1)
            .ok_or(RingConfigError::SizeOverflow)?;
        let mut slots = Vec::new();
        slots
            .try_reserve_exact(slot_count)
            .map_err(|_| RingConfigError::SizeOverflow)?;
        for _ in 0..slot_count {
            slots.push(UnsafeCell::new(Slot {
                metadata: empty_metadata(),
                samples: vec![0.0; samples_per_block].into_boxed_slice(),
            }));
        }

        Ok(Arc::new(Self {
            config,
            slots: slots.into_boxed_slice(),
            read_position: AtomicUsize::new(0),
            write_position: AtomicUsize::new(0),
            endpoints_claimed: AtomicBool::new(false),
            pushed_blocks: AtomicU64::new(0),
            popped_blocks: AtomicU64::new(0),
            dropped_newest_blocks: AtomicU64::new(0),
        }))
    }

    pub fn split(self: &Arc<Self>) -> Option<(Producer, Consumer)> {
        self.endpoints_claimed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()?;
        Some((
            Producer {
                ring: Arc::clone(self),
            },
            Consumer {
                ring: Arc::clone(self),
            },
        ))
    }

    #[must_use]
    pub fn config(&self) -> RingConfig {
        self.config
    }

    #[must_use]
    pub fn metrics(&self) -> RingMetrics {
        RingMetrics {
            pushed_blocks: self.pushed_blocks.load(Ordering::Relaxed),
            popped_blocks: self.popped_blocks.load(Ordering::Relaxed),
            dropped_newest_blocks: self.dropped_newest_blocks.load(Ordering::Relaxed),
        }
    }
}

pub struct Producer {
    ring: Arc<SpscPcmRing>,
}

impl Producer {
    pub fn try_push(&mut self, block: CaptureBlock<'_>) -> Result<(), PushError> {
        let config = self.ring.config;
        let required_samples = usize::from(block.metadata.frame_count)
            .checked_mul(usize::from(block.metadata.channel_count));
        if block.metadata.channel_count != config.channels
            || block.metadata.frame_count > config.frames_per_block
            || required_samples != Some(block.interleaved_samples.len())
        {
            return Err(PushError::ShapeMismatch);
        }

        let write = self.ring.write_position.load(Ordering::Relaxed);
        let next = increment(write, config.capacity_blocks);
        if next == self.ring.read_position.load(Ordering::Acquire) {
            self.ring
                .dropped_newest_blocks
                .fetch_add(1, Ordering::Relaxed);
            return Err(PushError::Full);
        }

        // Safety: this producer exclusively owns the unpublished write slot.
        let slot = unsafe { &mut *self.ring.slots[write].get() };
        slot.metadata = block.metadata;
        slot.samples[..block.interleaved_samples.len()].copy_from_slice(block.interleaved_samples);
        self.ring.write_position.store(next, Ordering::Release);
        self.ring.pushed_blocks.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}

pub struct Consumer {
    ring: Arc<SpscPcmRing>,
}

impl Consumer {
    pub fn try_pop_into(
        &mut self,
        output: &mut [f32],
    ) -> Result<Option<CaptureBlockMetadata>, PopError> {
        let read = self.ring.read_position.load(Ordering::Relaxed);
        if read == self.ring.write_position.load(Ordering::Acquire) {
            return Ok(None);
        }

        // Safety: acquire observed publication, and the producer never writes
        // a full slot until this consumer advances read_position.
        let slot = unsafe { &*self.ring.slots[read].get() };
        let sample_count =
            usize::from(slot.metadata.frame_count) * usize::from(slot.metadata.channel_count);
        if output.len() < sample_count {
            return Err(PopError::OutputTooSmall {
                required: sample_count,
            });
        }
        output[..sample_count].copy_from_slice(&slot.samples[..sample_count]);
        self.ring.read_position.store(
            increment(read, self.ring.config.capacity_blocks),
            Ordering::Release,
        );
        self.ring.popped_blocks.fetch_add(1, Ordering::Relaxed);
        Ok(Some(slot.metadata))
    }
}

const fn increment(position: usize, capacity: usize) -> usize {
    if position == capacity {
        0
    } else {
        position + 1
    }
}

const fn empty_metadata() -> CaptureBlockMetadata {
    use a2_audio_host_api::{CaptureEpochId, CaptureTiming, DiscontinuityFlags};
    CaptureBlockMetadata {
        capture_epoch: CaptureEpochId(0),
        first_frame_index: 0,
        frame_count: 0,
        channel_count: 0,
        sequence: 0,
        timing: CaptureTiming {
            monotonic_capture_ns: None,
            uncertainty_ns: None,
        },
        discontinuity: DiscontinuityFlags::NONE,
        cumulative_source_xruns: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use a2_audio_host_api::{CaptureEpochId, CaptureTiming, DiscontinuityFlags};

    fn block<'a>(sequence: u64, samples: &'a [f32]) -> CaptureBlock<'a> {
        CaptureBlock {
            metadata: CaptureBlockMetadata {
                capture_epoch: CaptureEpochId(7),
                first_frame_index: sequence * 2,
                frame_count: 2,
                channel_count: 2,
                sequence,
                timing: CaptureTiming {
                    monotonic_capture_ns: Some(sequence * 1_000),
                    uncertainty_ns: Some(0),
                },
                discontinuity: DiscontinuityFlags::NONE,
                cumulative_source_xruns: 0,
            },
            interleaved_samples: samples,
        }
    }

    #[test]
    fn preserves_pcm_and_metadata_order() {
        let ring = SpscPcmRing::new(RingConfig {
            capacity_blocks: 2,
            channels: 2,
            frames_per_block: 2,
        })
        .unwrap();
        let (mut producer, mut consumer) = ring.split().unwrap();
        producer.try_push(block(3, &[1.0, 2.0, 3.0, 4.0])).unwrap();

        let mut output = [0.0; 4];
        let metadata = consumer.try_pop_into(&mut output).unwrap().unwrap();
        assert_eq!(metadata.sequence, 3);
        assert_eq!(output, [1.0, 2.0, 3.0, 4.0]);
        assert_eq!(consumer.try_pop_into(&mut output), Ok(None));
    }

    #[test]
    fn full_ring_drops_newest_without_overwriting_published_pcm() {
        let ring = SpscPcmRing::new(RingConfig {
            capacity_blocks: 1,
            channels: 2,
            frames_per_block: 2,
        })
        .unwrap();
        let (mut producer, mut consumer) = ring.split().unwrap();
        producer.try_push(block(1, &[1.0; 4])).unwrap();
        assert_eq!(producer.try_push(block(2, &[2.0; 4])), Err(PushError::Full));

        let mut output = [0.0; 4];
        let metadata = consumer.try_pop_into(&mut output).unwrap().unwrap();
        assert_eq!(metadata.sequence, 1);
        assert_eq!(output, [1.0; 4]);
        assert_eq!(ring.metrics().dropped_newest_blocks, 1);
    }

    #[test]
    fn rejects_invalid_shapes_without_publishing() {
        let ring = SpscPcmRing::new(RingConfig {
            capacity_blocks: 1,
            channels: 2,
            frames_per_block: 2,
        })
        .unwrap();
        let (mut producer, mut consumer) = ring.split().unwrap();
        assert_eq!(
            producer.try_push(block(1, &[1.0; 3])),
            Err(PushError::ShapeMismatch)
        );
        assert_eq!(consumer.try_pop_into(&mut [0.0; 4]), Ok(None));
    }

    #[test]
    fn endpoints_can_only_be_claimed_once() {
        let ring = SpscPcmRing::new(RingConfig {
            capacity_blocks: 1,
            channels: 1,
            frames_per_block: 1,
        })
        .unwrap();
        assert!(ring.split().is_some());
        assert!(ring.split().is_none());
    }
}
