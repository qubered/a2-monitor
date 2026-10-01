//! Deterministic synthetic audio host used before physical host qualification.

pub mod capture_stats;
pub mod monitor_output;
pub mod recording;
pub mod replay_reader;
pub mod test_signal;
pub mod worker_control;
pub mod worker_control_session;

use a2_audio_host_api::{
    AudioHost, CallbackControl, CaptureBlock, CaptureBlockMetadata, CaptureCallback,
    CaptureCallbackFactory, CaptureEpochId, CaptureTiming, DeviceId, DeviceInfo,
    DiscontinuityFlags, HostError, HostErrorKind, HostId, InputStream, SampleFormat, StreamConfig,
    SupportedStreamConfig,
};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

pub const SYNTHETIC_HOST_ID: HostId = HostId(*b"a2-synth-host-v0");
pub const SYNTHETIC_DEVICE_ID: DeviceId = DeviceId(*b"a2-synth-dev--v0");
pub const SYNTHETIC_INPUT_CONFIG: SupportedStreamConfig = SupportedStreamConfig {
    sample_rate_hz: 48_000,
    channels: 64,
    frames_per_block: 480,
    sample_format: SampleFormat::F32,
};

#[derive(Debug)]
struct SyntheticHostState {
    stream_claimed: AtomicBool,
    next_epoch: AtomicU64,
}

struct OpenClaim {
    state: Arc<SyntheticHostState>,
    transferred: bool,
}

impl OpenClaim {
    fn new(state: &Arc<SyntheticHostState>) -> Self {
        Self {
            state: Arc::clone(state),
            transferred: false,
        }
    }

    fn transfer(mut self) {
        self.transferred = true;
    }
}

impl Drop for OpenClaim {
    fn drop(&mut self) {
        if !self.transferred {
            self.state.stream_claimed.store(false, Ordering::Release);
        }
    }
}

#[derive(Clone, Debug)]
pub struct SyntheticAudioHost {
    state: Arc<SyntheticHostState>,
}

impl SyntheticAudioHost {
    #[must_use]
    pub fn new() -> Self {
        Self {
            state: Arc::new(SyntheticHostState {
                stream_claimed: AtomicBool::new(false),
                next_epoch: AtomicU64::new(1),
            }),
        }
    }

    pub fn open_deterministic_input(
        &self,
        requested: StreamConfig,
        callback_factory: Box<dyn CaptureCallbackFactory>,
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
        let samples = vec![0.0; sample_count].into_boxed_slice();
        self.state
            .stream_claimed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| {
                HostError::new(
                    HostErrorKind::DeviceBusy,
                    "synthetic host already has an open input",
                )
            })?;
        let claim = OpenClaim::new(&self.state);
        let resolved_config = requested;
        let callback = callback_factory.create(resolved_config)?;
        let epoch = match self.state.next_epoch.fetch_update(
            Ordering::AcqRel,
            Ordering::Acquire,
            |current| current.checked_add(1),
        ) {
            Ok(epoch) => CaptureEpochId(epoch),
            Err(_) => {
                return Err(HostError::new(
                    HostErrorKind::EpochExhausted,
                    "synthetic capture epoch space is exhausted",
                ));
            }
        };
        let stream = SyntheticInputStream {
            requested_config: requested,
            resolved_config,
            capture_epoch: epoch,
            callback,
            samples,
            next_frame_index: 0,
            next_sequence: 0,
            running: false,
            owns_stream: true,
            host_state: Arc::clone(&self.state),
        };
        claim.transfer();
        Ok(stream)
    }
}

impl Default for SyntheticAudioHost {
    fn default() -> Self {
        Self::new()
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
            input_configs: vec![SYNTHETIC_INPUT_CONFIG],
        }])
    }

    fn open_input(
        &self,
        requested: StreamConfig,
        callback_factory: Box<dyn CaptureCallbackFactory>,
    ) -> Result<Box<dyn InputStream>, HostError> {
        Ok(Box::new(
            self.open_deterministic_input(requested, callback_factory)?,
        ))
    }
}

pub struct SyntheticInputStream {
    requested_config: StreamConfig,
    resolved_config: StreamConfig,
    capture_epoch: CaptureEpochId,
    callback: Box<dyn CaptureCallback>,
    samples: Box<[f32]>,
    next_frame_index: u64,
    next_sequence: u64,
    running: bool,
    owns_stream: bool,
    host_state: Arc<SyntheticHostState>,
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
                self.resolved_config.channels,
            );
            let metadata = CaptureBlockMetadata {
                capture_epoch: self.capture_epoch,
                first_frame_index: self.next_frame_index,
                frame_count: self.resolved_config.frames_per_block,
                channel_count: self.resolved_config.channels,
                sequence: self.next_sequence,
                timing: CaptureTiming {
                    monotonic_capture_ns: Some(frames_to_ns(
                        self.next_frame_index,
                        self.resolved_config.sample_rate_hz,
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
            self.next_frame_index += u64::from(self.resolved_config.frames_per_block);
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
        if !self.owns_stream {
            return Err(HostError::new(
                HostErrorKind::NotRunning,
                "synthetic input is closed",
            ));
        }
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

    fn close(&mut self) -> Result<(), HostError> {
        self.running = false;
        self.release_ownership();
        Ok(())
    }

    fn capture_epoch(&self) -> CaptureEpochId {
        self.capture_epoch
    }

    fn requested_config(&self) -> StreamConfig {
        self.requested_config
    }

    fn resolved_config(&self) -> StreamConfig {
        self.resolved_config
    }
}

impl SyntheticInputStream {
    fn release_ownership(&mut self) {
        if self.owns_stream {
            self.host_state
                .stream_claimed
                .store(false, Ordering::Release);
            self.owns_stream = false;
        }
    }
}

impl Drop for SyntheticInputStream {
    fn drop(&mut self) {
        self.release_ownership();
    }
}

fn validate_config(config: StreamConfig) -> Result<(), HostError> {
    if config.device_id != SYNTHETIC_DEVICE_ID {
        return Err(HostError::new(
            HostErrorKind::DeviceNotFound,
            "synthetic device ID was not found",
        ));
    }
    let requested = SupportedStreamConfig {
        sample_rate_hz: config.sample_rate_hz,
        channels: config.channels,
        frames_per_block: config.frames_per_block,
        sample_format: config.sample_format,
    };
    if requested != SYNTHETIC_INPUT_CONFIG {
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
    let rate = u64::from(sample_rate_hz);
    if rate == 0 {
        return 0;
    }
    let whole_seconds = frame_index / rate;
    let remaining_frames = frame_index % rate;
    whole_seconds
        .saturating_mul(1_000_000_000)
        .saturating_add(remaining_frames * 1_000_000_000 / rate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use a2_audio_core::{Producer, PushError, RingConfig, SpscPcmRing};
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;
    use std::sync::Barrier;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::thread;

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

    struct ContinueCallback;

    impl CaptureCallback for ContinueCallback {
        fn process(&mut self, _block: CaptureBlock<'_>) -> CallbackControl {
            CallbackControl::Continue
        }
    }

    struct StopCallback;

    impl CaptureCallback for StopCallback {
        fn process(&mut self, _block: CaptureBlock<'_>) -> CallbackControl {
            CallbackControl::Stop
        }
    }

    fn config() -> StreamConfig {
        StreamConfig {
            device_id: SYNTHETIC_DEVICE_ID,
            sample_rate_hz: 48_000,
            channels: 64,
            frames_per_block: 480,
            sample_format: SampleFormat::F32,
        }
    }

    fn open_error(result: Result<SyntheticInputStream, HostError>) -> HostError {
        match result {
            Ok(_) => panic!("synthetic input unexpectedly opened"),
            Err(error) => error,
        }
    }

    fn callback_factory<C>(callback: C) -> Box<dyn CaptureCallbackFactory>
    where
        C: CaptureCallback,
    {
        Box::new(move |_resolved| Ok(Box::new(callback) as Box<dyn CaptureCallback>))
    }

    #[test]
    fn deterministic_host_repeats_exact_pcm_and_timing() {
        let first = capture_sequence(3);
        let second = capture_sequence(3);
        assert_eq!(first, second);
        assert_eq!(first[0].0.first_frame_index, 0);
        assert_eq!(first[1].0.first_frame_index, 480);
        assert_eq!(first[2].0.sequence, 2);
        for (metadata, samples) in &first {
            assert_eq!(metadata.capture_epoch, CaptureEpochId(1));
            assert_eq!(metadata.frame_count, config().frames_per_block);
            assert_eq!(metadata.channel_count, config().channels);
            assert_eq!(
                samples.len(),
                usize::from(metadata.frame_count) * usize::from(metadata.channel_count)
            );
        }
    }

    #[test]
    fn reopened_stream_uses_a_new_epoch_and_restarts_its_frame_timeline() {
        let host = SyntheticAudioHost::new();
        let first = capture_sequence_from(&host, 2);
        let second = capture_sequence_from(&host, 2);

        assert_eq!(first[0].0.capture_epoch, CaptureEpochId(1));
        assert_eq!(first[1].0.capture_epoch, CaptureEpochId(1));
        assert_eq!(second[0].0.capture_epoch, CaptureEpochId(2));
        assert_eq!(second[1].0.capture_epoch, CaptureEpochId(2));
        assert_eq!(first[0].0.first_frame_index, 0);
        assert_eq!(second[0].0.first_frame_index, 0);
        assert_eq!(first[0].1.len(), second[0].1.len());
    }

    #[test]
    fn advertises_and_opens_only_exact_synthetic_tuples() {
        let host = SyntheticAudioHost::new();
        let devices = host.devices().unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, SYNTHETIC_DEVICE_ID);
        assert_eq!(devices[0].input_configs, [SYNTHETIC_INPUT_CONFIG]);

        let stream = host
            .open_deterministic_input(config(), callback_factory(ContinueCallback))
            .unwrap();
        assert_eq!(stream.requested_config(), config());
        assert_eq!(stream.resolved_config(), config());
        drop(stream);

        for unsupported in [
            StreamConfig {
                device_id: DeviceId(*b"missing-device--"),
                ..config()
            },
            StreamConfig {
                sample_rate_hz: 44_100,
                ..config()
            },
            StreamConfig {
                channels: 63,
                ..config()
            },
            StreamConfig {
                frames_per_block: 479,
                ..config()
            },
        ] {
            let error = open_error(
                host.open_deterministic_input(unsupported, callback_factory(ContinueCallback)),
            );
            let expected = if unsupported.device_id == SYNTHETIC_DEVICE_ID {
                HostErrorKind::UnsupportedConfiguration
            } else {
                HostErrorKind::DeviceNotFound
            };
            assert_eq!(error.kind, expected);
        }
    }

    #[test]
    fn factory_receives_the_resolved_tuple_before_constructing_the_callback() {
        use std::sync::mpsc::sync_channel;

        let host = SyntheticAudioHost::new();
        let (resolved_sender, resolved_receiver) = sync_channel(1);
        let factory = move |resolved: StreamConfig| {
            resolved_sender.send(resolved).unwrap();
            Ok(Box::new(ContinueCallback) as Box<dyn CaptureCallback>)
        };
        let stream = host
            .open_deterministic_input(config(), Box::new(factory))
            .unwrap();

        assert_eq!(resolved_receiver.recv().unwrap(), stream.resolved_config());
        assert_eq!(stream.requested_config(), config());
    }

    #[test]
    fn failed_and_busy_opens_consume_neither_ownership_nor_epoch() {
        let host = SyntheticAudioHost::new();
        let factory_error = open_error(host.open_deterministic_input(
            config(),
            Box::new(|_resolved| -> Result<Box<dyn CaptureCallback>, HostError> {
                Err(HostError::new(
                    HostErrorKind::CallbackSetupFailed,
                    "injected callback setup failure",
                ))
            }),
        ));
        assert_eq!(factory_error.kind, HostErrorKind::CallbackSetupFailed);
        let invalid = StreamConfig {
            sample_rate_hz: 44_100,
            ..config()
        };
        assert_eq!(
            open_error(host.open_deterministic_input(invalid, callback_factory(ContinueCallback)))
                .kind,
            HostErrorKind::UnsupportedConfiguration
        );

        let first = host
            .open_deterministic_input(config(), callback_factory(ContinueCallback))
            .unwrap();
        assert_eq!(first.capture_epoch(), CaptureEpochId(1));
        let busy_factory_called = Arc::new(AtomicBool::new(false));
        let busy_factory_observer = Arc::clone(&busy_factory_called);
        assert_eq!(
            open_error(host.clone().open_deterministic_input(
                config(),
                Box::new(move |_resolved| {
                    busy_factory_observer.store(true, Ordering::Release);
                    Ok(Box::new(ContinueCallback) as Box<dyn CaptureCallback>)
                }),
            ),)
            .kind,
            HostErrorKind::DeviceBusy
        );
        assert!(!busy_factory_called.load(Ordering::Acquire));
        drop(first);

        let second = host
            .open_deterministic_input(config(), callback_factory(ContinueCallback))
            .unwrap();
        assert_eq!(second.capture_epoch(), CaptureEpochId(2));
    }

    #[test]
    fn cloned_hosts_admit_exactly_one_concurrent_open() {
        const CONTENDERS: usize = 8;
        let host = SyntheticAudioHost::new();
        let start = Arc::new(Barrier::new(CONTENDERS));
        let attempted = Arc::new(Barrier::new(CONTENDERS));
        let handles: Vec<_> = (0..CONTENDERS)
            .map(|_| {
                let host = host.clone();
                let start = Arc::clone(&start);
                let attempted = Arc::clone(&attempted);
                thread::spawn(move || {
                    start.wait();
                    let result =
                        host.open_deterministic_input(config(), callback_factory(ContinueCallback));
                    let outcome = match &result {
                        Ok(stream) => Ok(stream.capture_epoch()),
                        Err(error) => Err(error.kind),
                    };
                    attempted.wait();
                    drop(result);
                    outcome
                })
            })
            .collect();
        let outcomes: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            outcomes
                .iter()
                .filter(|result| **result == Err(HostErrorKind::DeviceBusy))
                .count(),
            CONTENDERS - 1
        );

        let reopened = host
            .open_deterministic_input(config(), callback_factory(ContinueCallback))
            .unwrap();
        assert_eq!(reopened.capture_epoch(), CaptureEpochId(2));
    }

    #[test]
    fn stop_and_callback_stop_retain_ownership_until_close_or_drop() {
        let host = SyntheticAudioHost::new();
        let mut stopped = host
            .open_deterministic_input(config(), callback_factory(ContinueCallback))
            .unwrap();
        stopped.start().unwrap();
        stopped.stop().unwrap();
        assert_eq!(
            open_error(
                host.open_deterministic_input(config(), callback_factory(ContinueCallback)),
            )
            .kind,
            HostErrorKind::DeviceBusy
        );
        drop(stopped);

        let mut callback_stopped = host
            .open_deterministic_input(config(), callback_factory(StopCallback))
            .unwrap();
        callback_stopped.start().unwrap();
        assert_eq!(callback_stopped.render_blocks(4).unwrap(), 1);
        assert_eq!(
            open_error(
                host.open_deterministic_input(config(), callback_factory(ContinueCallback)),
            )
            .kind,
            HostErrorKind::DeviceBusy
        );
        drop(callback_stopped);

        let reopened = host
            .open_deterministic_input(config(), callback_factory(ContinueCallback))
            .unwrap();
        assert_eq!(reopened.capture_epoch(), CaptureEpochId(3));
    }

    #[test]
    fn never_started_drop_and_explicit_close_release_ownership() {
        let host = SyntheticAudioHost::new();
        let never_started = host
            .open_deterministic_input(config(), callback_factory(ContinueCallback))
            .unwrap();
        drop(never_started);

        let mut closed = host
            .open_deterministic_input(config(), callback_factory(ContinueCallback))
            .unwrap();
        closed.close().unwrap();
        closed.close().unwrap();
        assert_eq!(closed.start().unwrap_err().kind, HostErrorKind::NotRunning);

        let reopened = host
            .open_deterministic_input(config(), callback_factory(ContinueCallback))
            .unwrap();
        assert_eq!(reopened.capture_epoch(), CaptureEpochId(3));
        drop(closed);
        assert_eq!(
            open_error(
                host.open_deterministic_input(config(), callback_factory(ContinueCallback)),
            )
            .kind,
            HostErrorKind::DeviceBusy
        );
    }

    #[test]
    fn epoch_exhaustion_releases_the_claim_without_wrapping() {
        let host = SyntheticAudioHost::new();
        host.state.next_epoch.store(u64::MAX, Ordering::Release);
        assert_eq!(
            open_error(
                host.open_deterministic_input(config(), callback_factory(ContinueCallback)),
            )
            .kind,
            HostErrorKind::EpochExhausted
        );
        assert!(!host.state.stream_claimed.load(Ordering::Acquire));
        assert_eq!(host.state.next_epoch.load(Ordering::Acquire), u64::MAX);
    }

    #[test]
    fn frame_time_is_exact_and_increasing_across_the_old_overflow_boundary() {
        const NANOS_PER_SECOND: u64 = 1_000_000_000;
        let boundary = u64::MAX / NANOS_PER_SECOND;
        let frames = [boundary - 1, boundary, boundary + 1, boundary + 2];
        let observed = frames.map(|frame| frames_to_ns(frame, 48_000));
        let expected =
            frames.map(|frame| (u128::from(frame) * u128::from(NANOS_PER_SECOND) / 48_000) as u64);

        assert_eq!(observed, expected);
        assert!(observed.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(frames_to_ns(1, 0), 0);
    }

    #[test]
    fn callback_and_ring_push_allocate_nothing_after_setup() {
        static FULL_BLOCKS: AtomicU64 = AtomicU64::new(0);
        let ring = SpscPcmRing::new(RingConfig {
            capacity_blocks: 8,
            channels: config().channels,
            frames_per_block: config().frames_per_block,
        })
        .unwrap();
        let (producer, _consumer) = ring.split().unwrap();
        let mut stream = SyntheticAudioHost::new()
            .open_deterministic_input(
                config(),
                callback_factory(RingSink {
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
            channels: config().channels,
            frames_per_block: config().frames_per_block,
        })
        .unwrap();
        let (producer, _consumer) = ring.split().unwrap();
        let mut stream = SyntheticAudioHost::new()
            .open_deterministic_input(
                config(),
                callback_factory(RingSink {
                    producer,
                    full_blocks: &FULL_BLOCKS,
                }),
            )
            .unwrap();
        stream.start().unwrap();
        assert_eq!(stream.render_blocks(1_024).unwrap(), 1_024);
        assert_eq!(FULL_BLOCKS.load(Ordering::Relaxed), 1_023);
        assert_eq!(ring.metrics().dropped_newest_blocks, 1_023);
    }

    fn capture_sequence(blocks: usize) -> Vec<(CaptureBlockMetadata, Vec<f32>)> {
        capture_sequence_from(&SyntheticAudioHost::new(), blocks)
    }

    fn capture_sequence_from(
        host: &SyntheticAudioHost,
        blocks: usize,
    ) -> Vec<(CaptureBlockMetadata, Vec<f32>)> {
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
        let mut stream = host
            .open_deterministic_input(config(), callback_factory(Collector(Arc::clone(&captured))))
            .unwrap();
        stream.start().unwrap();
        stream.render_blocks(blocks).unwrap();
        drop(stream);
        Arc::try_unwrap(captured).unwrap().into_inner().unwrap()
    }
}
