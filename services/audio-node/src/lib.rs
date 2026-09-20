//! Deterministic synthetic audio host used before physical host qualification.

use a2_audio_host_api::{
    AudioHost, CallbackControl, CaptureBlock, CaptureBlockMetadata, CaptureCallback,
    CaptureEpochId, CaptureTiming, DeviceId, DeviceInfo, DiscontinuityFlags, HostError,
    HostErrorKind, HostId, InputStream, SampleFormat, StreamConfig, SupportedStreamConfig,
};

pub const SYNTHETIC_HOST_ID: HostId = HostId(*b"a2-synth-host-v0");
pub const SYNTHETIC_DEVICE_ID: DeviceId = DeviceId(*b"a2-synth-dev--v0");

#[derive(Clone, Copy, Debug)]
pub struct SyntheticAudioHost {
    capture_epoch: CaptureEpochId,
}

impl SyntheticAudioHost {
    #[must_use]
    pub const fn new(capture_epoch: CaptureEpochId) -> Self {
        Self { capture_epoch }
    }

    pub fn open_deterministic_input(
        &self,
        requested: StreamConfig,
        callback: Box<dyn CaptureCallback>,
    ) -> Result<SyntheticInputStream, HostError> {
        validate_config(requested)?;
        let sample_count = usize::from(requested.channels)
            .checked_mul(usize::from(requested.frames_per_block))
            .ok_or_else(|| {
                HostError::new(
                    HostErrorKind::UnsupportedConfiguration,
                    "synthetic block size overflows usize",
                )
            })?;
        Ok(SyntheticInputStream {
            config: requested,
            capture_epoch: self.capture_epoch,
            callback,
            samples: vec![0.0; sample_count].into_boxed_slice(),
            next_frame_index: 0,
            next_sequence: 0,
            running: false,
        })
    }
}

impl AudioHost for SyntheticAudioHost {
    fn id(&self) -> HostId {
        SYNTHETIC_HOST_ID
    }

    fn devices(&self) -> Result<Vec<DeviceInfo>, HostError> {
        Ok(vec![DeviceInfo {
            id: SYNTHETIC_DEVICE_ID,
            name: "Deterministic synthetic input".to_owned(),
            input_configs: vec![SupportedStreamConfig {
                sample_rate_hz: 48_000,
                channels: 64,
                frames_per_block: 480,
                sample_format: SampleFormat::F32,
            }],
        }])
    }

    fn open_input(
        &self,
        requested: StreamConfig,
        callback: Box<dyn CaptureCallback>,
    ) -> Result<Box<dyn InputStream>, HostError> {
        Ok(Box::new(
            self.open_deterministic_input(requested, callback)?,
        ))
    }
}

pub struct SyntheticInputStream {
    config: StreamConfig,
    capture_epoch: CaptureEpochId,
    callback: Box<dyn CaptureCallback>,
    samples: Box<[f32]>,
    next_frame_index: u64,
    next_sequence: u64,
    running: bool,
}

impl SyntheticInputStream {
    /// Synchronously produces at most `block_count` deterministic blocks.
    ///
    /// Storage is allocated when the stream opens. This method and the callback
    /// path allocate no memory, acquire no locks and perform no I/O.
    pub fn render_blocks(&mut self, block_count: usize) -> Result<usize, HostError> {
        if !self.running {
            return Err(HostError::new(
                HostErrorKind::NotRunning,
                "synthetic input is not running",
            ));
        }
        let mut rendered = 0;
        for _ in 0..block_count {
            fill_deterministic(
                &mut self.samples,
                self.next_frame_index,
                self.config.channels,
            );
            let metadata = CaptureBlockMetadata {
                capture_epoch: self.capture_epoch,
                first_frame_index: self.next_frame_index,
                frame_count: self.config.frames_per_block,
                channel_count: self.config.channels,
                sequence: self.next_sequence,
                timing: CaptureTiming {
                    monotonic_capture_ns: Some(frames_to_ns(
                        self.next_frame_index,
                        self.config.sample_rate_hz,
                    )),
                    uncertainty_ns: Some(0),
                },
                discontinuity: DiscontinuityFlags::NONE,
                cumulative_source_xruns: 0,
            };
            let control = self.callback.process(CaptureBlock {
                metadata,
                interleaved_samples: &self.samples,
            });
            rendered += 1;
            self.next_frame_index += u64::from(self.config.frames_per_block);
            self.next_sequence += 1;
            if control == CallbackControl::Stop {
                self.running = false;
                break;
            }
        }
        Ok(rendered)
    }
}

impl InputStream for SyntheticInputStream {
    fn start(&mut self) -> Result<(), HostError> {
        if self.running {
            return Err(HostError::new(
                HostErrorKind::AlreadyRunning,
                "synthetic input is already running",
            ));
        }
        self.running = true;
        Ok(())
    }

    fn stop(&mut self) -> Result<(), HostError> {
        if !self.running {
            return Err(HostError::new(
                HostErrorKind::NotRunning,
                "synthetic input is not running",
            ));
        }
        self.running = false;
        Ok(())
    }

    fn capture_epoch(&self) -> CaptureEpochId {
        self.capture_epoch
    }
}

fn validate_config(config: StreamConfig) -> Result<(), HostError> {
    if config.device_id != SYNTHETIC_DEVICE_ID {
        return Err(HostError::new(
            HostErrorKind::DeviceNotFound,
            "synthetic device ID was not found",
        ));
    }
    if config.sample_rate_hz != 48_000
        || config.channels == 0
        || config.channels > 64
        || config.frames_per_block == 0
        || config.frames_per_block > 480
        || config.sample_format != SampleFormat::F32
    {
        return Err(HostError::new(
            HostErrorKind::UnsupportedConfiguration,
            "synthetic input configuration is unsupported",
        ));
    }
    Ok(())
}

fn fill_deterministic(samples: &mut [f32], first_frame: u64, channels: u16) {
    let channel_count = usize::from(channels);
    for (sample_index, sample) in samples.iter_mut().enumerate() {
        let frame = first_frame + (sample_index / channel_count) as u64;
        let channel = (sample_index % channel_count) as u64;
        let integer_sample = ((frame.wrapping_mul(17) + channel.wrapping_mul(31)) % 2_047) as i32;
        *sample = (integer_sample - 1_023) as f32 / 1_024.0;
    }
}

fn frames_to_ns(frame_index: u64, sample_rate_hz: u32) -> u64 {
    u64::from(1_000_000_000_u32)
        .saturating_mul(frame_index)
        .checked_div(u64::from(sample_rate_hz))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use a2_audio_core::{Producer, PushError, RingConfig, SpscPcmRing};
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct CountingAllocator;

    thread_local! {
        static TRACK_ALLOCATIONS: Cell<bool> = const { Cell::new(false) };
        static ALLOCATION_COUNT: Cell<usize> = const { Cell::new(0) };
    }

    unsafe impl GlobalAlloc for CountingAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            TRACK_ALLOCATIONS.with(|tracking| {
                if tracking.get() {
                    ALLOCATION_COUNT.with(|count| count.set(count.get() + 1));
                }
            });
            // Safety: forwards the allocation request unchanged.
            unsafe { System.alloc(layout) }
        }

        unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
            // Safety: forwards the allocation request unchanged.
            unsafe { System.dealloc(pointer, layout) }
        }
    }

    #[global_allocator]
    static ALLOCATOR: CountingAllocator = CountingAllocator;

    struct RingSink {
        producer: Producer,
        full_blocks: &'static AtomicU64,
    }

    impl CaptureCallback for RingSink {
        fn process(&mut self, block: CaptureBlock<'_>) -> CallbackControl {
            if self.producer.try_push(block) == Err(PushError::Full) {
                self.full_blocks.fetch_add(1, Ordering::Relaxed);
            }
            CallbackControl::Continue
        }
    }

    fn config() -> StreamConfig {
        StreamConfig {
            device_id: SYNTHETIC_DEVICE_ID,
            sample_rate_hz: 48_000,
            channels: 2,
            frames_per_block: 4,
            sample_format: SampleFormat::F32,
        }
    }

    #[test]
    fn deterministic_host_repeats_exact_pcm_and_timing() {
        let first = capture_sequence(3);
        let second = capture_sequence(3);
        assert_eq!(first, second);
        assert_eq!(first[0].0.first_frame_index, 0);
        assert_eq!(first[1].0.first_frame_index, 4);
        assert_eq!(first[2].0.sequence, 2);
    }

    #[test]
    fn callback_and_ring_push_allocate_nothing_after_setup() {
        static FULL_BLOCKS: AtomicU64 = AtomicU64::new(0);
        let ring = SpscPcmRing::new(RingConfig {
            capacity_blocks: 8,
            channels: 2,
            frames_per_block: 4,
        })
        .unwrap();
        let (producer, _consumer) = ring.split().unwrap();
        let mut stream = SyntheticAudioHost::new(CaptureEpochId(11))
            .open_deterministic_input(
                config(),
                Box::new(RingSink {
                    producer,
                    full_blocks: &FULL_BLOCKS,
                }),
            )
            .unwrap();
        stream.start().unwrap();

        // Initialize the thread-locals before entering the measured section.
        TRACK_ALLOCATIONS.with(|tracking| tracking.set(false));
        ALLOCATION_COUNT.with(|count| count.set(0));
        TRACK_ALLOCATIONS.with(|tracking| tracking.set(true));
        let rendered = stream.render_blocks(64).unwrap();
        TRACK_ALLOCATIONS.with(|tracking| tracking.set(false));
        let allocations = ALLOCATION_COUNT.with(Cell::get);

        assert_eq!(rendered, 64);
        assert_eq!(allocations, 0);
        assert_eq!(FULL_BLOCKS.load(Ordering::Relaxed), 56);
    }

    #[test]
    fn full_ring_does_not_stop_or_wait_for_consumer() {
        static FULL_BLOCKS: AtomicU64 = AtomicU64::new(0);
        let ring = SpscPcmRing::new(RingConfig {
            capacity_blocks: 1,
            channels: 2,
            frames_per_block: 4,
        })
        .unwrap();
        let (producer, _consumer) = ring.split().unwrap();
        let mut stream = SyntheticAudioHost::new(CaptureEpochId(4))
            .open_deterministic_input(
                config(),
                Box::new(RingSink {
                    producer,
                    full_blocks: &FULL_BLOCKS,
                }),
            )
            .unwrap();
        stream.start().unwrap();
        assert_eq!(stream.render_blocks(10_000).unwrap(), 10_000);
        assert_eq!(FULL_BLOCKS.load(Ordering::Relaxed), 9_999);
        assert_eq!(ring.metrics().dropped_newest_blocks, 9_999);
    }

    fn capture_sequence(blocks: usize) -> Vec<(CaptureBlockMetadata, Vec<f32>)> {
        use std::sync::{Arc, Mutex};

        type CapturedBlocks = Vec<(CaptureBlockMetadata, Vec<f32>)>;
        struct Collector(Arc<Mutex<CapturedBlocks>>);
        impl CaptureCallback for Collector {
            fn process(&mut self, block: CaptureBlock<'_>) -> CallbackControl {
                self.0
                    .lock()
                    .unwrap()
                    .push((block.metadata, block.interleaved_samples.to_vec()));
                CallbackControl::Continue
            }
        }

        let captured = Arc::new(Mutex::new(Vec::new()));
        let mut stream = SyntheticAudioHost::new(CaptureEpochId(9))
            .open_deterministic_input(config(), Box::new(Collector(Arc::clone(&captured))))
            .unwrap();
        stream.start().unwrap();
        stream.render_blocks(blocks).unwrap();
        drop(stream);
        Arc::try_unwrap(captured).unwrap().into_inner().unwrap()
    }
}
