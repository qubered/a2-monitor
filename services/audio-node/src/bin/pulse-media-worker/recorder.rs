//! Optional recording of every captured input as 48 kbps mono Opus (see `a2_audio_node::recording`).
//!
//! Capture blocks arrive on the worker's event loop, never on the device callback. Each block is
//! copied once and handed to a few encoder threads over bounded queues. A full queue drops the
//! block and counts it: recording must never delay live media. A dropped or discontinuous block
//! ends the segment, so the gap is visible in the files rather than papered over.
//!
//! The config lives in `recording.json` beside the audio, so recording resumes after a node
//! restart without the backend. Turning recording off deletes what was recorded.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, SyncSender, TrySendError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use a2_audio_node::recording::{
    MAX_PACKET_BYTES, MAX_RETENTION_MINUTES, PACKET_SAMPLES, SAMPLE_RATE_HZ, SegmentHeader,
    SegmentWriter, channel_directory, purge, sweep,
};
use opus::{Application, Bitrate, Channels, Encoder};
use serde_json::{Value, json};

use crate::capture::CaptureBlock;

const BITRATE_BPS: i32 = 48_000;
const COMPLEXITY: i32 = 5;
/// About 2.5 s of 10 ms blocks per encoder thread before blocks are dropped.
const QUEUE_BLOCKS: usize = 256;
const CHANNELS_PER_SHARD: usize = 16;
const MAX_SHARDS: usize = 4;
const SWEEP_EVERY: Duration = Duration::from_secs(10);
const WRITE_RETRY: Duration = Duration::from_secs(5);
const CONFIG_FILE: &str = "recording.json";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecordingConfig {
    pub enabled: bool,
    pub retention_minutes: u32,
}

impl Default for RecordingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            retention_minutes: MAX_RETENTION_MINUTES,
        }
    }
}

impl RecordingConfig {
    pub fn valid(self) -> bool {
        (1..=MAX_RETENTION_MINUTES).contains(&self.retention_minutes)
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct RecorderReport {
    pub available: bool,
    pub config: RecordingConfig,
    /// Encoder threads are running.
    pub active: bool,
    pub dropped_blocks: u64,
    pub write_errors: u64,
}

#[derive(Default)]
struct Stats {
    dropped_blocks: AtomicU64,
    write_errors: AtomicU64,
    retention_minutes: AtomicU32,
}

struct SharedBlock {
    first_frame: u64,
    utc_ms: u64,
    channel_count: usize,
    samples: Vec<f32>,
}

struct Shard {
    queue: SyncSender<Arc<SharedBlock>>,
    thread: JoinHandle<()>,
}

pub struct Recorder {
    root: Option<PathBuf>,
    config: RecordingConfig,
    channel_count: Option<usize>,
    stats: Arc<Stats>,
    shards: Vec<Shard>,
}

impl Recorder {
    /// `root` is `None` when the node was started without `--recording-dir`.
    pub fn new(root: Option<PathBuf>) -> Self {
        let config = root.as_deref().and_then(load_config).unwrap_or_default();
        let stats = Arc::new(Stats::default());
        stats
            .retention_minutes
            .store(config.retention_minutes, Ordering::Relaxed);
        Self {
            root,
            config,
            channel_count: None,
            stats,
            shards: Vec::new(),
        }
    }

    pub fn report(&self) -> RecorderReport {
        RecorderReport {
            available: self.root.is_some(),
            config: self.config,
            active: !self.shards.is_empty(),
            dropped_blocks: self.stats.dropped_blocks.load(Ordering::Relaxed),
            write_errors: self.stats.write_errors.load(Ordering::Relaxed),
        }
    }

    pub fn capture_ready(&mut self, channel_count: usize) {
        self.stop();
        self.channel_count = Some(channel_count);
        self.reconcile();
    }

    /// Applies a validated config. Returns false when there is nowhere to record.
    pub fn apply(&mut self, config: RecordingConfig) -> bool {
        let Some(root) = self.root.clone() else {
            return false;
        };
        let turned_off = self.config.enabled && !config.enabled;
        self.config = config;
        self.stats
            .retention_minutes
            .store(config.retention_minutes, Ordering::Relaxed);
        if turned_off {
            self.stop();
            let _ = purge(&root);
        }
        if save_config(&root, config).is_err() {
            self.stats.write_errors.fetch_add(1, Ordering::Relaxed);
        }
        self.reconcile();
        true
    }

    pub fn write_block(&mut self, block: &CaptureBlock, utc_ms: u64) {
        if self.shards.is_empty() {
            return;
        }
        let shared = Arc::new(SharedBlock {
            first_frame: block.first_frame,
            utc_ms,
            channel_count: block.channel_count,
            samples: block.samples.clone(),
        });
        for shard in &self.shards {
            match shard.queue.try_send(Arc::clone(&shared)) {
                Ok(()) => {}
                Err(TrySendError::Full(_)) => {
                    self.stats.dropped_blocks.fetch_add(1, Ordering::Relaxed);
                }
                Err(TrySendError::Disconnected(_)) => {
                    self.stats.write_errors.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
    }

    pub fn shutdown(&mut self) {
        self.stop();
    }

    fn reconcile(&mut self) {
        if !self.config.enabled || !self.shards.is_empty() {
            return;
        }
        let (Some(root), Some(channels)) = (self.root.clone(), self.channel_count) else {
            return;
        };
        let shard_count = channels.div_ceil(CHANNELS_PER_SHARD).clamp(1, MAX_SHARDS);
        let per_shard = channels.div_ceil(shard_count);
        for index in 0..shard_count {
            let start = index * per_shard;
            let end = ((index + 1) * per_shard).min(channels);
            if start >= end {
                break;
            }
            let (queue, receiver) = mpsc::sync_channel(QUEUE_BLOCKS);
            let (root, stats) = (root.clone(), Arc::clone(&self.stats));
            let spawned = thread::Builder::new()
                .name(format!("recorder-{index}"))
                .spawn(move || run_shard(&root, start..end, &receiver, &stats));
            match spawned {
                Ok(thread) => self.shards.push(Shard { queue, thread }),
                Err(_) => {
                    self.stats.write_errors.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
    }

    fn stop(&mut self) {
        for shard in self.shards.drain(..) {
            drop(shard.queue);
            let _ = shard.thread.join();
        }
    }
}

fn load_config(root: &Path) -> Option<RecordingConfig> {
    let value: Value = serde_json::from_slice(&fs::read(root.join(CONFIG_FILE)).ok()?).ok()?;
    let config = RecordingConfig {
        enabled: value.get("enabled")?.as_bool()?,
        retention_minutes: u32::try_from(value.get("retentionMinutes")?.as_u64()?).ok()?,
    };
    config.valid().then_some(config)
}

fn save_config(root: &Path, config: RecordingConfig) -> std::io::Result<()> {
    fs::create_dir_all(root)?;
    let temporary = root.join(format!("{CONFIG_FILE}.tmp"));
    let body = json!({ "enabled": config.enabled, "retentionMinutes": config.retention_minutes });
    fs::write(&temporary, serde_json::to_vec(&body)?)?;
    fs::rename(temporary, root.join(CONFIG_FILE))
}

struct ChannelState {
    encoder: Encoder,
    pending: Vec<f32>,
    pending_frame: u64,
    pending_utc_ms: u64,
    expected_frame: Option<u64>,
    writer: Option<SegmentWriter>,
    retry_at: Option<Instant>,
}

fn encoder() -> Result<Encoder, opus::Error> {
    let mut encoder = Encoder::new(SAMPLE_RATE_HZ, Channels::Mono, Application::Audio)?;
    encoder.set_bitrate(Bitrate::Bits(BITRATE_BPS))?;
    encoder.set_complexity(COMPLEXITY)?;
    encoder.set_vbr(true)?;
    Ok(encoder)
}

fn run_shard(
    root: &Path,
    channels: std::ops::Range<usize>,
    blocks: &mpsc::Receiver<Arc<SharedBlock>>,
    stats: &Stats,
) {
    let first = channels.start;
    let mut states: Vec<Option<ChannelState>> = channels
        .clone()
        .map(|_| {
            encoder().ok().map(|encoder| ChannelState {
                encoder,
                pending: Vec::with_capacity(PACKET_SAMPLES),
                pending_frame: 0,
                pending_utc_ms: 0,
                expected_frame: None,
                writer: None,
                retry_at: None,
            })
        })
        .collect();
    let mut packet = [0_u8; MAX_PACKET_BYTES];
    let mut next_sweep = Instant::now() + SWEEP_EVERY;
    while let Ok(block) = blocks.recv() {
        let frames = block.samples.len() / block.channel_count.max(1);
        for channel in channels.clone() {
            let Some(state) = states[channel - first].as_mut() else {
                continue;
            };
            if channel >= block.channel_count {
                continue;
            }
            record_block(root, channel, state, &block, frames, &mut packet, stats);
        }
        if Instant::now() >= next_sweep {
            next_sweep = Instant::now() + SWEEP_EVERY;
            let retention_ms = u64::from(stats.retention_minutes.load(Ordering::Relaxed)) * 60_000;
            let cutoff = block.utc_ms.saturating_sub(retention_ms);
            for channel in channels.clone() {
                sweep(&channel_directory(root, channel), cutoff);
            }
        }
    }
    for state in states.into_iter().flatten() {
        if let Some(writer) = state.writer {
            let _ = writer.finish();
        }
    }
}

fn record_block(
    root: &Path,
    channel: usize,
    state: &mut ChannelState,
    block: &SharedBlock,
    frames: usize,
    packet: &mut [u8],
    stats: &Stats,
) {
    if state.expected_frame != Some(block.first_frame) {
        // First block, or blocks were dropped: end the segment so the gap stays visible.
        state.pending.clear();
        if let Some(writer) = state.writer.take() {
            let _ = writer.finish();
        }
    }
    state.expected_frame = Some(block.first_frame + frames as u64);
    if state.pending.is_empty() {
        state.pending_frame = block.first_frame;
        state.pending_utc_ms = block.utc_ms;
    }
    state
        .pending
        .extend((0..frames).map(|frame| block.samples[frame * block.channel_count + channel]));
    if state.pending.len() < PACKET_SAMPLES {
        return;
    }
    let encoded = state
        .encoder
        .encode_float(&state.pending[..PACKET_SAMPLES], packet);
    let leftover = state.pending.split_off(PACKET_SAMPLES);
    let (frame, utc_ms) = (state.pending_frame, state.pending_utc_ms);
    state.pending = leftover;
    state.pending_frame = frame + PACKET_SAMPLES as u64;
    state.pending_utc_ms = utc_ms + 20;
    let Ok(length) = encoded else {
        stats.write_errors.fetch_add(1, Ordering::Relaxed);
        return;
    };
    if state.writer.is_none() && state.retry_at.is_none_or(|at| Instant::now() >= at) {
        let header = SegmentHeader {
            channel: channel as u32,
            first_frame: frame,
            start_utc_ms: utc_ms,
        };
        match SegmentWriter::create(root, header) {
            Ok(writer) => state.writer = Some(writer),
            Err(_) => {
                stats.write_errors.fetch_add(1, Ordering::Relaxed);
                state.retry_at = Some(Instant::now() + WRITE_RETRY);
            }
        }
    }
    let Some(writer) = state.writer.as_mut() else {
        return;
    };
    if writer.write_packet(&packet[..length]).is_err() {
        stats.write_errors.fetch_add(1, Ordering::Relaxed);
        state.writer = None;
        state.retry_at = Some(Instant::now() + WRITE_RETRY);
    } else if writer.is_full()
        && let Some(writer) = state.writer.take()
    {
        let _ = writer.finish();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use a2_audio_node::recording::{list_segments, read_segment};

    fn scratch(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("pulse-recorder-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        path
    }

    fn block(
        first_frame: u64,
        channels: usize,
        value: impl Fn(usize, usize) -> f32,
    ) -> CaptureBlock {
        let samples = (0..480)
            .flat_map(|frame| (0..channels).map(move |channel| (frame, channel)))
            .map(|(frame, channel)| value(first_frame as usize + frame, channel))
            .collect();
        CaptureBlock {
            first_frame,
            channel_count: channels,
            samples,
        }
    }

    #[test]
    fn records_each_input_and_decodes_back_to_the_tone() {
        let root = scratch("tone");
        let mut recorder = Recorder::new(Some(root.clone()));
        assert!(recorder.apply(RecordingConfig {
            enabled: true,
            retention_minutes: 30
        }));
        recorder.capture_ready(2);
        let tone = |frame: usize, channel: usize| {
            if channel == 0 {
                0.5 * (2.0 * std::f32::consts::PI * 1000.0 * frame as f32 / 48_000.0).sin()
            } else {
                0.0
            }
        };
        for index in 0..100_u64 {
            recorder.write_block(&block(index * 480, 2, tone), 1_700_000_000_000 + index * 10);
        }
        recorder.shutdown();

        let (_, path) = list_segments(&channel_directory(&root, 0)).remove(0);
        let segment = read_segment(&path).unwrap();
        assert_eq!(
            segment.packets.len(),
            50,
            "1 s of audio is fifty 20 ms packets"
        );
        let mut decoder = opus::Decoder::new(48_000, Channels::Mono).unwrap();
        let mut pcm = vec![0.0_f32; 960];
        let mut peak = 0.0_f32;
        for packet in &segment.packets[10..] {
            decoder.decode_float(packet, &mut pcm, false).unwrap();
            peak = peak.max(pcm.iter().fold(0.0, |m, s| m.max(s.abs())));
        }
        assert!(
            (0.4..0.6).contains(&peak),
            "tone survives the codec, peak {peak}"
        );

        let (_, silent) = list_segments(&channel_directory(&root, 1)).remove(0);
        let quiet = read_segment(&silent).unwrap();
        assert!(
            quiet.packets.iter().all(|packet| packet.len() < 40),
            "silence stays tiny"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_dropped_block_starts_a_new_segment() {
        let root = scratch("gap");
        let mut recorder = Recorder::new(Some(root.clone()));
        recorder.apply(RecordingConfig {
            enabled: true,
            retention_minutes: 5,
        });
        recorder.capture_ready(1);
        for index in [0_u64, 1, 2, 3, 10, 11, 12, 13] {
            recorder.write_block(
                &block(index * 480, 1, |_, _| 0.1),
                1_700_000_000_000 + index * 10,
            );
        }
        recorder.shutdown();
        assert_eq!(list_segments(&channel_directory(&root, 0)).len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn config_persists_and_turning_off_deletes_audio() {
        let root = scratch("config");
        let mut recorder = Recorder::new(Some(root.clone()));
        recorder.apply(RecordingConfig {
            enabled: true,
            retention_minutes: 20,
        });
        recorder.capture_ready(1);
        for index in 0..4_u64 {
            recorder.write_block(&block(index * 480, 1, |_, _| 0.1), 1_700_000_000_000);
        }
        let restarted = Recorder::new(Some(root.clone()));
        assert_eq!(
            restarted.report().config,
            RecordingConfig {
                enabled: true,
                retention_minutes: 20
            }
        );
        recorder.apply(RecordingConfig {
            enabled: false,
            retention_minutes: 20,
        });
        assert!(list_segments(&channel_directory(&root, 0)).is_empty());
        assert!(!recorder.report().active);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn without_a_directory_recording_is_unavailable() {
        let mut recorder = Recorder::new(None);
        assert!(!recorder.apply(RecordingConfig {
            enabled: true,
            retention_minutes: 10
        }));
        assert!(!recorder.report().available);
    }

    /// Run with `cargo test --release -- --ignored realtime`: 64 noisy inputs at real-time pace.
    #[test]
    #[ignore = "paced for 10 s of wall time"]
    fn realtime_64_channels_drop_nothing() {
        let root = scratch("realtime");
        let mut recorder = Recorder::new(Some(root.clone()));
        recorder.apply(RecordingConfig {
            enabled: true,
            retention_minutes: 5,
        });
        recorder.capture_ready(64);
        let started = Instant::now();
        for index in 0..1000_u64 {
            let noise = |frame: usize, channel: usize| {
                ((frame * 31 + channel * 17) % 200) as f32 / 1000.0 - 0.1
            };
            recorder.write_block(
                &block(index * 480, 64, noise),
                1_700_000_000_000 + index * 10,
            );
            thread::sleep(
                Duration::from_millis(10)
                    .saturating_sub(
                        started
                            .elapsed()
                            .saturating_sub(Duration::from_millis(index * 10)),
                    )
                    .min(Duration::from_millis(10)),
            );
        }
        let dropped = recorder.report().dropped_blocks;
        recorder.shutdown();
        let bytes: u64 = (0..64)
            .flat_map(|c| list_segments(&channel_directory(&root, c)))
            .map(|(_, path)| fs::metadata(path).unwrap().len())
            .sum();
        eprintln!(
            "dropped {dropped}, wrote {bytes} bytes in 10 s, elapsed {:?}",
            started.elapsed()
        );
        assert_eq!(dropped, 0);
        fs::remove_dir_all(root).unwrap();
    }
}
