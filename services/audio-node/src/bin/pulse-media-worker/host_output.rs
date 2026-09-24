//! Shared host monitor output (ADR 0029).
//!
//! One monitor mix per host output session, each controlled by every Live client that
//! joined that session, is rendered from captured blocks and piped as interleaved Float32LE
//! (one sample per mix per frame) to a `pulse-device-output` child. The child opens the
//! host's output device once and plays each mix on its own channels (for example Dante
//! Virtual Soundcard outputs 1 and 2 routed to two comms channels). The child owns the device callback; this module never blocks the
//! event loop on it: blocks go through a bounded queue to a writer thread and are dropped,
//! and counted, when the child falls behind. A failed child is restarted with backoff.

use serde_json::Value;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command as ProcessCommand, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender, TrySendError};
use std::thread;
use std::time::{Duration, Instant};

use crate::Event;
use crate::capture::{CaptureBlock, FRAMES_PER_BLOCK};
use crate::session::mix_block;
use a2_audio_node::monitor_output::parse_output_routes;

/// Highest accepted linear gain: +12 dB.
pub const MAX_MONITOR_GAIN: f32 = 3.981_072;
/// Blocks queued for the writer thread: 80 ms.
const WRITE_QUEUE_BLOCKS: usize = 8;
const RESTART_DELAYS: [Duration; 6] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
    Duration::from_secs(8),
    Duration::from_secs(15),
    Duration::from_secs(30),
];
const STABLE_OUTPUT: Duration = Duration::from_secs(30);
const EVENT_LINE_LIMIT_BYTES: usize = 4 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputArgs {
    pub binary: OsString,
    pub device_name: OsString,
    /// One route per session, e.g. `1;2,3` (see `parse_output_routes`).
    pub routes: OsString,
}

/// Sessions (mixes) named by a routes string; an unparseable string is one session, which
/// the output child then rejects with its reason.
fn route_count(routes: &OsString) -> usize {
    routes
        .to_str()
        .and_then(|routes| parse_output_routes(routes).ok())
        .map_or(1, |routes| routes.len())
}

/// Events from the output child, forwarded through the worker event loop.
#[derive(Debug, PartialEq)]
pub enum OutputEvent {
    Ready {
        generation: u64,
        device_name: String,
        channel_count: usize,
        output_routes: Vec<Vec<u64>>,
    },
    Stats {
        generation: u64,
        underruns: u64,
        skipped_frames: u64,
        overflow_frames: u64,
    },
    Ended {
        generation: u64,
        detail: String,
    },
}

/// The shared monitor mix: one input (or none) at one gain. Gain changes ramp across one
/// block and input changes crossfade across one block, so neither clicks.
pub struct MonitorMix {
    channel: Option<usize>,
    fade_from: Option<usize>,
    releasing: bool,
    gain: f32,
    target_gain: f32,
    mono: Vec<f32>,
}

impl MonitorMix {
    pub fn new() -> Self {
        Self {
            channel: None,
            fade_from: None,
            releasing: false,
            gain: 0.0,
            target_gain: 0.0,
            mono: vec![0.0; FRAMES_PER_BLOCK],
        }
    }

    /// Selects the input and linear gain. `None` fades the current input out.
    pub fn set(&mut self, channel: Option<usize>, gain: f32) {
        match channel {
            Some(next) => {
                match self.channel {
                    Some(current) if current != next => self.fade_from = Some(current),
                    // Starting from silence ramps the gain up instead of crossfading.
                    None => self.gain = 0.0,
                    _ => {}
                }
                self.channel = Some(next);
                self.releasing = false;
                self.target_gain = gain.clamp(0.0, MAX_MONITOR_GAIN);
            }
            None => {
                self.releasing = self.channel.is_some();
                self.target_gain = 0.0;
            }
        }
    }

    /// Renders one 10 ms mono block into `output`.
    pub fn render(&mut self, block: &CaptureBlock, output: &mut [f32]) {
        let Some(channel) = self.channel else {
            output.fill(0.0);
            return;
        };
        mix_block(block, channel, self.fade_from.take(), &mut self.mono);
        let start = self.gain;
        let step = (self.target_gain - start) / FRAMES_PER_BLOCK as f32;
        for (frame, (slot, sample)) in output.iter_mut().zip(&self.mono).enumerate() {
            *slot = sample * (start + step * (frame as f32 + 1.0));
        }
        self.gain = self.target_gain;
        if self.releasing {
            self.channel = None;
            self.releasing = false;
        }
    }
}

fn exact_keys(record: &serde_json::Map<String, Value>, expected: &[&str]) -> bool {
    let mut keys: Vec<&str> = record.keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut expected = expected.to_vec();
    expected.sort_unstable();
    keys == expected
}

fn count(record: &serde_json::Map<String, Value>, key: &str) -> Option<u64> {
    record.get(key).and_then(Value::as_u64)
}

/// Parses one `pulse-device-output` stdout line.
pub fn parse_output_line(line: &str, generation: u64) -> Result<OutputEvent, String> {
    let value: Value =
        serde_json::from_str(line).map_err(|_| "output event is not valid JSON".to_owned())?;
    let record = value
        .as_object()
        .ok_or_else(|| "output event must be a JSON object".to_owned())?;
    match record.get("type").and_then(Value::as_str) {
        Some("ready")
            if exact_keys(
                record,
                &[
                    "type",
                    "deviceName",
                    "sampleRateHz",
                    "channelCount",
                    "outputRoutes",
                ],
            ) =>
        {
            let device_name = record
                .get("deviceName")
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty() && name.len() <= 512)
                .ok_or_else(|| "output ready deviceName is invalid".to_owned())?;
            if count(record, "sampleRateHz") != Some(48_000) {
                return Err("output ready sampleRateHz must be 48000".to_owned());
            }
            let channel_count = count(record, "channelCount")
                .filter(|count| (1..=256).contains(count))
                .ok_or_else(|| "output ready channelCount is invalid".to_owned())?
                as usize;
            let output_routes = record
                .get("outputRoutes")
                .and_then(Value::as_array)
                .filter(|routes| (1..=8).contains(&routes.len()))
                .and_then(|routes| {
                    routes
                        .iter()
                        .map(|route| {
                            route
                                .as_array()
                                .filter(|channels| (1..=8).contains(&channels.len()))?
                                .iter()
                                .map(|channel| {
                                    channel.as_u64().filter(|number| {
                                        (1..=channel_count as u64).contains(number)
                                    })
                                })
                                .collect::<Option<Vec<u64>>>()
                        })
                        .collect::<Option<Vec<Vec<u64>>>>()
                })
                .ok_or_else(|| "output ready outputRoutes is invalid".to_owned())?;
            Ok(OutputEvent::Ready {
                generation,
                device_name: device_name.to_owned(),
                channel_count,
                output_routes,
            })
        }
        Some("failed") if exact_keys(record, &["type", "detail"]) => record
            .get("detail")
            .and_then(Value::as_str)
            .filter(|detail| !detail.is_empty())
            .map(|detail| OutputEvent::Ended {
                generation,
                detail: detail.chars().take(200).collect(),
            })
            .ok_or_else(|| "output failed detail is invalid".to_owned()),
        Some("stats")
            if exact_keys(
                record,
                &["type", "underruns", "skippedFrames", "overflowFrames"],
            ) =>
        {
            match (
                count(record, "underruns"),
                count(record, "skippedFrames"),
                count(record, "overflowFrames"),
            ) {
                (Some(underruns), Some(skipped_frames), Some(overflow_frames)) => {
                    Ok(OutputEvent::Stats {
                        generation,
                        underruns,
                        skipped_frames,
                        overflow_frames,
                    })
                }
                _ => Err("output stats are invalid".to_owned()),
            }
        }
        _ => Err("output event does not match the output protocol".to_owned()),
    }
}

/// Reads the child's stdout on its own thread and forwards parsed events.
fn read_output_events(stdout: impl std::io::Read, generation: u64, events: SyncSender<Event>) {
    let mut reader = BufReader::new(stdout).take(0);
    loop {
        let mut line = Vec::new();
        reader.set_limit(EVENT_LINE_LIMIT_BYTES as u64 + 1);
        let detail = match reader.read_until(b'\n', &mut line) {
            Ok(0) => "output process closed its output".to_owned(),
            Err(error) => format!("output read failed: {error}"),
            Ok(_) if line.last() != Some(&b'\n') => "output event exceeds the size limit".into(),
            Ok(_) => {
                line.pop();
                match std::str::from_utf8(&line)
                    .map_err(|_| "output event is not UTF-8".to_owned())
                    .and_then(|text| parse_output_line(text, generation))
                {
                    Ok(event) => {
                        // A reported failure is the end of this child; its EOF must not
                        // count as a second failure.
                        let ended = matches!(event, OutputEvent::Ended { .. });
                        if events.send(Event::Output(event)).is_err() || ended {
                            return;
                        }
                        continue;
                    }
                    Err(detail) => detail,
                }
            }
        };
        let _ = events.send(Event::Output(OutputEvent::Ended { generation, detail }));
        return;
    }
}

/// Writes queued interleaved blocks to the child's stdin until the queue or the pipe closes.
fn write_feed(mut stdin: ChildStdin, blocks: Receiver<Vec<f32>>, recycle: Sender<Vec<f32>>) {
    let mut bytes = Vec::new();
    while let Ok(block) = blocks.recv() {
        bytes.clear();
        for sample in &block {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        let _ = recycle.send(block);
        if stdin.write_all(&bytes).is_err() {
            return;
        }
    }
}

/// What the worker reports to the gateway after an output event.
#[derive(Debug, PartialEq)]
pub enum OutputReport {
    Ready {
        device_name: String,
        channel_count: usize,
        output_routes: Vec<Vec<u64>>,
    },
    Stats {
        underruns: u64,
        skipped_frames: u64,
        overflow_frames: u64,
        dropped_blocks: u64,
    },
    Failed {
        detail: String,
        retry_in: Duration,
    },
}

struct Running {
    child: Child,
    feed: SyncSender<Vec<f32>>,
    ready_at: Option<Instant>,
}

/// Supervises the output child and renders one shared mix per session into it.
pub struct HostOutput {
    args: OutputArgs,
    events: SyncSender<Event>,
    mixes: Vec<MonitorMix>,
    scratch: Vec<f32>,
    running: Option<Running>,
    generation: u64,
    attempt: usize,
    restart_at: Option<Instant>,
    recycle_tx: Sender<Vec<f32>>,
    recycle_rx: Receiver<Vec<f32>>,
    dropped_blocks: Arc<AtomicU64>,
    last_stats: Option<(u64, u64, u64, u64)>,
}

impl HostOutput {
    pub fn new(args: OutputArgs, events: SyncSender<Event>) -> Self {
        let (recycle_tx, recycle_rx) = mpsc::channel();
        let mixes = (0..route_count(&args.routes))
            .map(|_| MonitorMix::new())
            .collect();
        Self {
            args,
            events,
            mixes,
            scratch: vec![0.0; FRAMES_PER_BLOCK],
            running: None,
            generation: 0,
            attempt: 0,
            restart_at: None,
            recycle_tx,
            recycle_rx,
            dropped_blocks: Arc::new(AtomicU64::new(0)),
            last_stats: None,
        }
    }

    /// Sets one session's mix. A session beyond the current routes is ignored; the
    /// gateway re-sends every session's mix after a routes change.
    pub fn set_monitor(&mut self, mix: usize, channel: Option<usize>, gain: f32) {
        if let Some(target) = self.mixes.get_mut(mix) {
            target.set(channel, gain);
        }
    }

    /// Starts the child. A spawn failure is reported like any other failure.
    pub fn start(&mut self, now: Instant) -> Option<OutputReport> {
        self.restart_at = None;
        self.generation += 1;
        self.last_stats = None;
        self.dropped_blocks.store(0, Ordering::Relaxed);
        let spawned = ProcessCommand::new(&self.args.binary)
            .arg("--device")
            .arg(&self.args.device_name)
            .arg("--routes")
            .arg(&self.args.routes)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                return Some(
                    self.schedule_restart(format!("output process could not start: {error}"), now),
                );
            }
        };
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            let _ = child.kill();
            let _ = child.wait();
            return Some(self.schedule_restart("output process has no pipes".into(), now));
        };
        let (feed_tx, feed_rx) = mpsc::sync_channel(WRITE_QUEUE_BLOCKS);
        let recycle = self.recycle_tx.clone();
        let generation = self.generation;
        let events = self.events.clone();
        let spawned_threads = thread::Builder::new()
            .name("output-writer".into())
            .spawn(move || write_feed(stdin, feed_rx, recycle))
            .and_then(|_| {
                thread::Builder::new()
                    .name("output-reader".into())
                    .spawn(move || read_output_events(stdout, generation, events))
            });
        self.running = Some(Running {
            child,
            feed: feed_tx,
            ready_at: None,
        });
        match spawned_threads {
            Ok(_) => None,
            Err(error) => Some(self.fail(format!("output threads could not start: {error}"), now)),
        }
    }

    /// Renders every session's mix for one captured block, interleaves them and queues
    /// the result for the child.
    pub fn write_block(&mut self, block: &CaptureBlock) {
        if self.running.is_none() {
            return;
        }
        let width = self.mixes.len();
        let mut buffer = self
            .recycle_rx
            .try_recv()
            .unwrap_or_else(|_| Vec::with_capacity(FRAMES_PER_BLOCK * width));
        self.render_interleaved(block, &mut buffer);
        let Some(running) = &self.running else {
            return;
        };
        match running.feed.try_send(buffer) {
            Ok(()) => {}
            Err(TrySendError::Full(buffer)) => {
                self.dropped_blocks.fetch_add(1, Ordering::Relaxed);
                let _ = self.recycle_tx.send(buffer);
            }
            // The child ended; its reader reports why.
            Err(TrySendError::Disconnected(_)) => {}
        }
    }

    /// Renders every session's mix into `buffer` as interleaved frames, mix order.
    fn render_interleaved(&mut self, block: &CaptureBlock, buffer: &mut Vec<f32>) {
        let width = self.mixes.len();
        buffer.resize(FRAMES_PER_BLOCK * width, 0.0);
        for (index, mix) in self.mixes.iter_mut().enumerate() {
            mix.render(block, &mut self.scratch);
            for (frame, sample) in self.scratch.iter().enumerate() {
                buffer[frame * width + index] = *sample;
            }
        }
    }

    pub fn handle_event(&mut self, event: OutputEvent, now: Instant) -> Option<OutputReport> {
        match event {
            OutputEvent::Ready {
                generation,
                device_name,
                channel_count,
                output_routes,
            } if generation == self.generation => {
                if let Some(running) = &mut self.running {
                    running.ready_at = Some(now);
                }
                Some(OutputReport::Ready {
                    device_name,
                    channel_count,
                    output_routes,
                })
            }
            OutputEvent::Stats {
                generation,
                underruns,
                skipped_frames,
                overflow_frames,
            } if generation == self.generation => {
                let dropped_blocks = self.dropped_blocks.load(Ordering::Relaxed);
                let stats = (underruns, skipped_frames, overflow_frames, dropped_blocks);
                // Unchanged counters are not repeated.
                if self.last_stats == Some(stats) {
                    return None;
                }
                self.last_stats = Some(stats);
                Some(OutputReport::Stats {
                    underruns,
                    skipped_frames,
                    overflow_frames,
                    dropped_blocks,
                })
            }
            OutputEvent::Ended { generation, detail } if generation == self.generation => {
                Some(self.fail(detail, now))
            }
            _ => None,
        }
    }

    pub fn next_deadline(&self) -> Option<Instant> {
        self.restart_at
    }

    pub fn poll(&mut self, now: Instant) -> Option<OutputReport> {
        match self.restart_at {
            Some(at) if now >= at => self.start(now),
            _ => None,
        }
    }

    /// Reopens the output child on other routes at once, with fresh backoff. The same
    /// routes are a no-op, so a repeated setting never interrupts the feed. Mixes are kept
    /// by position; added sessions start silent and removed ones are dropped.
    pub fn set_routes(&mut self, routes: String, now: Instant) -> Option<OutputReport> {
        if self.args.routes == *routes {
            return None;
        }
        self.args.routes = routes.into();
        self.mixes
            .resize_with(route_count(&self.args.routes), MonitorMix::new);
        // Blocks of the old width must not reach the new child.
        while self.recycle_rx.try_recv().is_ok() {}
        self.shutdown();
        self.attempt = 0;
        self.start(now)
    }

    pub fn shutdown(&mut self) {
        if let Some(mut running) = self.running.take() {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }

    fn fail(&mut self, detail: String, now: Instant) -> OutputReport {
        let mut detail = detail;
        if let Some(mut running) = self.running.take() {
            if running
                .ready_at
                .is_some_and(|ready| now.duration_since(ready) >= STABLE_OUTPUT)
            {
                self.attempt = 0;
            }
            let _ = running.child.kill();
            if let Ok(status) = running.child.wait()
                && !status.success()
            {
                detail = format!("{detail} ({status})");
            }
        }
        self.schedule_restart(detail, now)
    }

    fn schedule_restart(&mut self, detail: String, now: Instant) -> OutputReport {
        let retry_in = RESTART_DELAYS[self.attempt.min(RESTART_DELAYS.len() - 1)];
        self.attempt += 1;
        self.restart_at = Some(now + retry_in);
        OutputReport::Failed { detail, retry_in }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn constant_block(channels: usize, values: &[f32]) -> CaptureBlock {
        let mut samples = Vec::with_capacity(FRAMES_PER_BLOCK * channels);
        for _ in 0..FRAMES_PER_BLOCK {
            samples.extend_from_slice(&values[..channels]);
        }
        CaptureBlock {
            first_frame: 0,
            channel_count: channels,
            samples,
        }
    }

    #[test]
    fn mix_is_silent_until_an_input_is_selected_then_ramps_in() {
        let block = constant_block(2, &[0.5, -0.5]);
        let mut mix = MonitorMix::new();
        let mut output = vec![1.0; FRAMES_PER_BLOCK];
        mix.render(&block, &mut output);
        assert!(output.iter().all(|sample| *sample == 0.0));

        mix.set(Some(1), 1.0);
        mix.render(&block, &mut output);
        assert!(output[0].abs() < 0.01, "starts near silence");
        assert!((output[FRAMES_PER_BLOCK - 1] + 0.5).abs() < 1e-6);
        mix.render(&block, &mut output);
        assert!(output.iter().all(|sample| (*sample + 0.5).abs() < 1e-6));
    }

    #[test]
    fn mix_ramps_gain_and_fades_out_on_release() {
        let block = constant_block(1, &[1.0]);
        let mut mix = MonitorMix::new();
        let mut output = vec![0.0; FRAMES_PER_BLOCK];
        mix.set(Some(0), 1.0);
        mix.render(&block, &mut output);

        mix.set(Some(0), 0.25);
        mix.render(&block, &mut output);
        assert!(output.windows(2).all(|pair| pair[1] <= pair[0]));
        assert!((output[FRAMES_PER_BLOCK - 1] - 0.25).abs() < 1e-6);

        mix.set(None, 1.0);
        mix.render(&block, &mut output);
        assert!(output[0] > 0.2 && output[FRAMES_PER_BLOCK - 1].abs() < 1e-6);
        mix.render(&block, &mut output);
        assert!(output.iter().all(|sample| *sample == 0.0));
    }

    #[test]
    fn mix_clamps_gain_to_twelve_decibels() {
        let block = constant_block(1, &[0.1]);
        let mut mix = MonitorMix::new();
        let mut output = vec![0.0; FRAMES_PER_BLOCK];
        mix.set(Some(0), 100.0);
        mix.render(&block, &mut output);
        mix.render(&block, &mut output);
        assert!((output[0] - 0.1 * MAX_MONITOR_GAIN).abs() < 1e-6);
    }

    #[test]
    fn parses_ready_and_stats_lines_strictly() {
        assert_eq!(
            parse_output_line(
                r#"{"type":"ready","deviceName":"DVS","sampleRateHz":48000,"channelCount":64,"outputRoutes":[[3,4],[5]]}"#,
                7
            ),
            Ok(OutputEvent::Ready {
                generation: 7,
                device_name: "DVS".into(),
                channel_count: 64,
                output_routes: vec![vec![3, 4], vec![5]],
            })
        );
        assert_eq!(
            parse_output_line(
                r#"{"type":"stats","underruns":1,"skippedFrames":0,"overflowFrames":2}"#,
                7
            ),
            Ok(OutputEvent::Stats {
                generation: 7,
                underruns: 1,
                skipped_frames: 0,
                overflow_frames: 2,
            })
        );
        assert_eq!(
            parse_output_line(
                r#"{"type":"failed","detail":"output channel 12 is beyond DVS's 2 outputs"}"#,
                7
            ),
            Ok(OutputEvent::Ended {
                generation: 7,
                detail: "output channel 12 is beyond DVS's 2 outputs".into(),
            })
        );
        for invalid in [
            r#"{"type":"ready","deviceName":"DVS","sampleRateHz":44100,"channelCount":2,"outputRoutes":[[1]]}"#,
            r#"{"type":"ready","deviceName":"DVS","sampleRateHz":48000,"channelCount":2,"outputRoutes":[[3]]}"#,
            r#"{"type":"ready","deviceName":"DVS","sampleRateHz":48000,"channelCount":2,"outputRoutes":[[]]}"#,
            r#"{"type":"stats","underruns":1,"skippedFrames":0}"#,
            r#"{"type":"stats","underruns":-1,"skippedFrames":0,"overflowFrames":0}"#,
            "[]",
        ] {
            assert!(parse_output_line(invalid, 1).is_err(), "{invalid}");
        }
    }

    #[test]
    fn new_routes_restart_at_once_with_fresh_backoff() {
        let (events, _receiver) = mpsc::sync_channel(4);
        let mut output = HostOutput::new(
            OutputArgs {
                binary: "/nonexistent/pulse-device-output".into(),
                device_name: "DVS".into(),
                routes: "1".into(),
            },
            events,
        );
        let now = Instant::now();
        output.start(now);
        output.poll(now + Duration::from_secs(1));
        assert!(output.set_routes("1".into(), now).is_none());
        assert!(matches!(
            output.set_routes("1;12".into(), now),
            Some(OutputReport::Failed { retry_in, .. }) if retry_in == Duration::from_secs(1)
        ));
        assert_eq!(output.args.routes, "1;12");
        assert_eq!(output.mixes.len(), 2, "one mix per session");
        output.set_monitor(5, Some(0), 1.0);
    }

    #[test]
    fn each_session_renders_its_own_input_into_its_own_slot() {
        let (events, _receiver) = mpsc::sync_channel(4);
        let mut output = HostOutput::new(
            OutputArgs {
                binary: "/nonexistent/pulse-device-output".into(),
                device_name: "DVS".into(),
                routes: "1;2".into(),
            },
            events,
        );
        output.set_monitor(0, Some(1), 1.0);
        output.set_monitor(1, Some(0), 0.5);
        let block = constant_block(2, &[0.5, -0.5]);
        let mut buffer = Vec::new();
        // The first block ramps in from silence; the second is at the set gain.
        output.render_interleaved(&block, &mut buffer);
        output.render_interleaved(&block, &mut buffer);
        assert_eq!(buffer.len(), FRAMES_PER_BLOCK * 2);
        assert!(
            buffer
                .as_chunks::<2>()
                .0
                .iter()
                .all(|frame| { (frame[0] + 0.5).abs() < 1e-6 && (frame[1] - 0.25).abs() < 1e-6 })
        );
    }

    #[test]
    fn a_missing_binary_schedules_a_backed_off_restart() {
        let (events, _receiver) = mpsc::sync_channel(4);
        let mut output = HostOutput::new(
            OutputArgs {
                binary: "/nonexistent/pulse-device-output".into(),
                device_name: "DVS".into(),
                routes: "1".into(),
            },
            events,
        );
        let now = Instant::now();
        assert!(matches!(
            output.start(now),
            Some(OutputReport::Failed { retry_in, .. }) if retry_in == Duration::from_secs(1)
        ));
        assert_eq!(output.next_deadline(), Some(now + Duration::from_secs(1)));
        assert!(output.poll(now).is_none());
        assert!(matches!(
            output.poll(now + Duration::from_secs(1)),
            Some(OutputReport::Failed { retry_in, .. }) if retry_in == Duration::from_secs(2)
        ));
    }
}
