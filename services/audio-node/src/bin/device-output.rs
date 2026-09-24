//! `pulse-device-output`: plays the host monitor feed on one explicitly named output device
//! (ADR 0031).
//!
//! stdin carries raw Float32LE at 48 kHz from `pulse-media-worker`: interleaved frames with
//! one sample per feed mix, in `--routes` order; there is no header. stdout carries JSON
//! lines: one `ready` line once the device is open, then a `stats` line every second, or one
//! `failed` line with the reason before a non-zero exit. The device callback only pulls from
//! a preallocated ring.

use a2_audio_node::monitor_output::{
    DEFAULT_RING_TARGETS, OUTPUT_SAMPLE_RATE_HZ, RingCounters, RingProducer,
    SIMULATED_OUTPUT_DEVICE_NAME, frame_ring, parse_output_routes,
};
use serde_json::json;
use std::ffi::OsString;
use std::io::{self, ErrorKind, Read, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

/// One second of audio: far above the ceiling, so the reader never waits on the ring.
const RING_CAPACITY_FRAMES: usize = OUTPUT_SAMPLE_RATE_HZ as usize;
const READ_BUFFER_BYTES: usize = 16 * 1024;
const STATS_INTERVAL: Duration = Duration::from_secs(1);
/// The channel count reported for the simulated output.
const SIMULATED_CHANNEL_COUNT: usize = 8;

#[derive(Debug, Eq, PartialEq)]
enum Command {
    List,
    Play {
        device_name: String,
        /// 1-based device channels for each feed's mix, in pipe order.
        routes: Vec<Vec<u16>>,
    },
}

fn parse_args<I>(mut args: I) -> Result<Command, String>
where
    I: Iterator<Item = OsString>,
{
    const USAGE: &str = "usage: pulse-device-output --list | --device <exact-device-name> --routes <n[,n…][;n[,n…]…]>";
    match (
        args.next(),
        args.next(),
        args.next(),
        args.next(),
        args.next(),
    ) {
        (Some(flag), None, None, None, None) if flag == "--list" => Ok(Command::List),
        (Some(device_flag), Some(device_name), Some(routes_flag), Some(routes), None)
            if device_flag == "--device" && routes_flag == "--routes" =>
        {
            let device_name = device_name
                .into_string()
                .map_err(|_| "device name must be valid UTF-8".to_owned())?;
            if device_name.is_empty() {
                return Err("device name must not be empty".to_owned());
            }
            let routes = routes
                .to_str()
                .ok_or_else(|| "output routes must be valid UTF-8".to_owned())
                .and_then(parse_output_routes)?;
            Ok(Command::Play {
                device_name,
                routes,
            })
        }
        _ => Err(USAGE.to_owned()),
    }
}

/// Emits one JSON line on stdout. A closed stdout means the worker is gone.
fn emit(value: &serde_json::Value) -> io::Result<()> {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    serde_json::to_writer(&mut output, value)?;
    output.write_all(b"\n")?;
    output.flush()
}

fn ready_line(device_name: &str, channel_count: usize, routes: &[Vec<u16>]) -> serde_json::Value {
    json!({
        "type": "ready",
        "deviceName": device_name,
        "sampleRateHz": OUTPUT_SAMPLE_RATE_HZ,
        "channelCount": channel_count,
        "outputRoutes": routes,
    })
}

/// The first route channel the device does not have, as an error.
fn check_routes(
    device_name: &str,
    channel_count: usize,
    routes: &[Vec<u16>],
) -> Result<(), String> {
    match routes
        .iter()
        .flatten()
        .find(|channel| usize::from(**channel) > channel_count)
    {
        Some(channel) => Err(format!(
            "output channel {channel} is beyond {device_name:?}'s {channel_count} outputs"
        )),
        None => Ok(()),
    }
}

/// Reads the worker's feed into the ring until stdin closes. Runs on its own thread. Samples
/// split across reads and frames split across reads are carried to the next read.
fn feed_ring(mut input: impl Read, mut producer: RingProducer, ended: &AtomicBool) {
    let width = producer.width();
    let mut bytes = vec![0_u8; READ_BUFFER_BYTES];
    // Room for one read's samples plus a carried partial frame.
    let mut samples = vec![0.0_f32; READ_BUFFER_BYTES / size_of::<f32>() + width];
    let mut carried = 0;
    let mut partial = [0_u8; 4];
    let mut partial_len = 0;
    loop {
        let count = match input.read(&mut bytes) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        let mut data = &bytes[..count];
        let mut sample_count = carried;
        if partial_len > 0 {
            let take = (4 - partial_len).min(data.len());
            partial[partial_len..partial_len + take].copy_from_slice(&data[..take]);
            partial_len += take;
            data = &data[take..];
            if partial_len < 4 {
                // This read ended inside the same sample.
                continue;
            }
            samples[sample_count] = f32::from_le_bytes(partial);
            sample_count += 1;
        }
        let (whole, remainder) = data.as_chunks::<4>();
        for chunk in whole {
            samples[sample_count] = f32::from_le_bytes(*chunk);
            sample_count += 1;
        }
        partial[..remainder.len()].copy_from_slice(remainder);
        partial_len = remainder.len();
        let whole_samples = sample_count - sample_count % width;
        producer.push(&samples[..whole_samples]);
        carried = sample_count - whole_samples;
        samples.copy_within(whole_samples..sample_count, 0);
    }
    ended.store(true, Ordering::Release);
}

fn stats_line(counters: &RingCounters) -> serde_json::Value {
    json!({
        "type": "stats",
        "underruns": counters.underruns.load(Ordering::Relaxed),
        "skippedFrames": counters.skipped_frames.load(Ordering::Relaxed),
        "overflowFrames": counters.overflow_frames.load(Ordering::Relaxed),
    })
}

/// The reserved simulated output: validates the routes against a device with
/// `SIMULATED_CHANNEL_COUNT` outputs, drains the feed through the same ring and plays nothing.
fn run_simulated(routes: &[Vec<u16>]) -> Result<(), String> {
    check_routes(
        SIMULATED_OUTPUT_DEVICE_NAME,
        SIMULATED_CHANNEL_COUNT,
        routes,
    )?;
    let width = routes.len();
    let (producer, mut consumer, counters) =
        frame_ring(RING_CAPACITY_FRAMES, width, DEFAULT_RING_TARGETS).map_err(str::to_owned)?;
    let feed_ended = Arc::new(AtomicBool::new(false));
    {
        let ended = Arc::clone(&feed_ended);
        thread::Builder::new()
            .name("output-feed".into())
            .spawn(move || feed_ring(io::stdin().lock(), producer, &ended))
            .map_err(|error| error.to_string())?;
    }
    emit(&ready_line(
        SIMULATED_OUTPUT_DEVICE_NAME,
        SIMULATED_CHANNEL_COUNT,
        routes,
    ))
    .map_err(|error| error.to_string())?;
    // Stand in for a device clock: every 10 ms, pull the frames the wall clock says are due.
    let started = std::time::Instant::now();
    let mut pulled_frames = 0_u64;
    let max_frames = OUTPUT_SAMPLE_RATE_HZ as usize / 10;
    let mut block = vec![0.0_f32; max_frames * width];
    let mut next_report = started + STATS_INTERVAL;
    loop {
        thread::sleep(Duration::from_millis(10));
        let due = (started.elapsed().as_secs_f64() * f64::from(OUTPUT_SAMPLE_RATE_HZ)) as u64;
        let frames = (due.saturating_sub(pulled_frames) as usize).min(max_frames);
        consumer.pull(&mut block[..frames * width]);
        pulled_frames += frames as u64;
        if feed_ended.load(Ordering::Acquire) {
            return Ok(());
        }
        if std::time::Instant::now() >= next_report {
            next_report += STATS_INTERVAL;
            if emit(&stats_line(&counters)).is_err() {
                return Ok(());
            }
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod supported {
    use super::{
        Command, DEFAULT_RING_TARGETS, OUTPUT_SAMPLE_RATE_HZ, RING_CAPACITY_FRAMES, STATS_INTERVAL,
        check_routes, emit, feed_ring, frame_ring, ready_line, stats_line,
    };
    use a2_audio_node::monitor_output::{RingConsumer, RingCounters, route_mixes};
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{
        Device, SampleFormat, SampleRate, StreamConfig, SupportedBufferSize,
        SupportedStreamConfigRange,
    };
    use serde_json::json;
    use std::io;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread;

    const MAX_LISTED_DEVICES: usize = 128;
    const MAX_CONFIGS_PER_DEVICE: usize = 128;
    const TARGET_BUFFER_FRAMES: u32 = 128;
    /// Scratch sized for the largest callback the host is expected to request.
    const MAX_CALLBACK_FRAMES: usize = 8_192;

    pub fn run(command: Command) -> Result<(), String> {
        match command {
            Command::List => list_devices().map_err(|error| error.to_string()),
            Command::Play {
                device_name,
                routes,
            } => play(&device_name, &routes),
        }
    }

    fn list_devices() -> Result<(), Box<dyn std::error::Error>> {
        let host = cpal::default_host();
        let mut devices_json = Vec::new();
        let mut devices_truncated = false;
        for (device_index, device) in host.output_devices()?.enumerate() {
            if device_index == MAX_LISTED_DEVICES {
                devices_truncated = true;
                break;
            }
            let name = device.name().unwrap_or_else(|_| "<unavailable>".to_owned());
            let mut configs_json = Vec::new();
            let mut configs_truncated = false;
            if let Ok(configs) = device.supported_output_configs() {
                for (config_index, config) in configs.enumerate() {
                    if config_index == MAX_CONFIGS_PER_DEVICE {
                        configs_truncated = true;
                        break;
                    }
                    configs_json.push(json!({
                        "channelCount": config.channels(),
                        "sampleFormat": format_name(config.sample_format()),
                        "minSampleRateHz": config.min_sample_rate().0,
                        "maxSampleRateHz": config.max_sample_rate().0,
                    }));
                }
            }
            devices_json.push(json!({
                "deviceName": name,
                "configs": configs_json,
                "configsTruncated": configs_truncated,
            }));
        }
        println!(
            "{}",
            json!({
                "schemaVersion": 0,
                "host": host.id().name(),
                "devices": devices_json,
                "devicesTruncated": devices_truncated,
            })
        );
        Ok(())
    }

    fn format_name(format: SampleFormat) -> &'static str {
        match format {
            SampleFormat::F32 => "f32",
            SampleFormat::I16 => "i16",
            SampleFormat::U16 => "u16",
            _ => "unsupported",
        }
    }

    fn find_exact_device(host: &cpal::Host, expected: &str) -> Result<Device, String> {
        let mut selected = None;
        for device in host.output_devices().map_err(|error| error.to_string())? {
            if matches!(device.name(), Ok(name) if name == expected) {
                if selected.is_some() {
                    return Err(format!(
                        "more than one output device has the exact name {expected:?}"
                    ));
                }
                selected = Some(device);
            }
        }
        selected.ok_or_else(|| format!("output device not found: {expected:?}"))
    }

    /// The widest 48 kHz configuration, so every device channel can be addressed.
    fn select_config(device: &Device) -> Result<Option<SupportedStreamConfigRange>, String> {
        let mut selected: Option<SupportedStreamConfigRange> = None;
        for candidate in device
            .supported_output_configs()
            .map_err(|error| error.to_string())?
        {
            if candidate.min_sample_rate().0 <= OUTPUT_SAMPLE_RATE_HZ
                && candidate.max_sample_rate().0 >= OUTPUT_SAMPLE_RATE_HZ
                && matches!(
                    candidate.sample_format(),
                    SampleFormat::F32 | SampleFormat::I16 | SampleFormat::U16
                )
                && selected
                    .as_ref()
                    .is_none_or(|current| candidate.channels() > current.channels())
            {
                selected = Some(candidate);
            }
        }
        Ok(selected)
    }

    /// Reports counters once a second until the feed ends or the device fails.
    fn report_until_done(
        counters: &RingCounters,
        feed_ended: &AtomicBool,
        device_failed: &AtomicBool,
    ) -> Result<(), String> {
        loop {
            thread::sleep(STATS_INTERVAL);
            if device_failed.load(Ordering::Acquire) {
                return Err("audio output stream failed".to_owned());
            }
            if feed_ended.load(Ordering::Acquire) || emit(&stats_line(counters)).is_err() {
                return Ok(());
            }
        }
    }

    /// Callback state: all buffers allocated before the stream starts.
    struct Renderer {
        consumer: RingConsumer,
        /// `(mix, 0-based device channel)` pairs.
        routes: Vec<(usize, usize)>,
        mix_count: usize,
        channel_count: usize,
        mixes: Vec<f32>,
        interleaved: Vec<f32>,
    }

    impl Renderer {
        /// Renders into `interleaved[..len]` and returns that slice; real-time safe.
        fn render(&mut self, samples: usize) -> &[f32] {
            let samples = samples.min(self.interleaved.len());
            let frames = samples / self.channel_count;
            let mix_samples = frames * self.mix_count;
            self.consumer.pull(&mut self.mixes[..mix_samples]);
            route_mixes(
                &self.mixes[..mix_samples],
                self.mix_count,
                &self.routes,
                self.channel_count,
                &mut self.interleaved[..samples],
            );
            &self.interleaved[..samples]
        }
    }

    fn play(device_name: &str, routes: &[Vec<u16>]) -> Result<(), String> {
        let host = cpal::default_host();
        let device = find_exact_device(&host, device_name)?;
        let selected = select_config(&device)?.ok_or_else(|| {
            format!("device {device_name:?} has no 48 kHz f32, i16, or u16 output configuration")
        })?;
        let channel_count = usize::from(selected.channels());
        check_routes(device_name, channel_count, routes)?;
        let mix_count = routes.len();
        let format = selected.sample_format();
        let device_failed = Arc::new(AtomicBool::new(false));
        let feed_ended = Arc::new(AtomicBool::new(false));

        let buffer_sizes = [
            match selected.buffer_size() {
                SupportedBufferSize::Range { min, max } => Some(cpal::BufferSize::Fixed(
                    TARGET_BUFFER_FRAMES.clamp(*min, *max),
                )),
                SupportedBufferSize::Unknown => None,
            },
            Some(cpal::BufferSize::Default),
        ];
        let mut opened = None;
        let mut last_error = String::from("no configuration");
        for buffer_size in buffer_sizes.into_iter().flatten() {
            let config = StreamConfig {
                channels: selected.channels(),
                sample_rate: SampleRate(OUTPUT_SAMPLE_RATE_HZ),
                buffer_size,
            };
            let (producer, consumer, counters) =
                frame_ring(RING_CAPACITY_FRAMES, mix_count, DEFAULT_RING_TARGETS)
                    .map_err(str::to_owned)?;
            let renderer = Renderer {
                consumer,
                routes: routes
                    .iter()
                    .enumerate()
                    .flat_map(|(mix, channels)| {
                        channels
                            .iter()
                            .map(move |channel| (mix, usize::from(*channel) - 1))
                    })
                    .collect(),
                mix_count,
                channel_count,
                mixes: vec![0.0; MAX_CALLBACK_FRAMES * mix_count],
                interleaved: vec![0.0; MAX_CALLBACK_FRAMES * channel_count],
            };
            let failed = Arc::clone(&device_failed);
            match build_stream(&device, &config, format, renderer, move |_| {
                failed.store(true, Ordering::Release)
            }) {
                Ok(stream) => {
                    eprintln!("pulse-device-output: output buffer {buffer_size:?}");
                    opened = Some((stream, producer, counters));
                    break;
                }
                Err(error) => last_error = error,
            }
        }
        let (stream, producer, counters) = opened.ok_or_else(|| {
            format!("device {device_name:?} could not open a 48 kHz output stream: {last_error}")
        })?;
        {
            let ended = Arc::clone(&feed_ended);
            thread::Builder::new()
                .name("output-feed".into())
                .spawn(move || feed_ring(io::stdin().lock(), producer, &ended))
                .map_err(|error| error.to_string())?;
        }
        stream.play().map_err(|error| error.to_string())?;
        emit(&ready_line(device_name, channel_count, routes)).map_err(|error| error.to_string())?;
        report_until_done(&counters, &feed_ended, &device_failed)
    }

    fn build_stream(
        device: &Device,
        config: &StreamConfig,
        format: SampleFormat,
        mut renderer: Renderer,
        error_callback: impl FnMut(cpal::StreamError) + Send + 'static,
    ) -> Result<cpal::Stream, String> {
        let stream = match format {
            SampleFormat::F32 => device.build_output_stream(
                config,
                move |data: &mut [f32], _| {
                    let rendered = renderer.render(data.len());
                    data[..rendered.len()].copy_from_slice(rendered);
                    data[rendered.len()..].fill(0.0);
                },
                error_callback,
                None,
            ),
            SampleFormat::I16 => device.build_output_stream(
                config,
                move |data: &mut [i16], _| {
                    let rendered = renderer.render(data.len());
                    for (slot, sample) in data.iter_mut().zip(rendered.iter().copied()) {
                        *slot = (sample.clamp(-1.0, 1.0) * 32_767.0) as i16;
                    }
                    data[rendered.len()..].fill(0);
                },
                error_callback,
                None,
            ),
            SampleFormat::U16 => device.build_output_stream(
                config,
                move |data: &mut [u16], _| {
                    let rendered = renderer.render(data.len());
                    for (slot, sample) in data.iter_mut().zip(rendered.iter().copied()) {
                        *slot = (sample.clamp(-1.0, 1.0) * 32_767.0 + 32_768.0) as u16;
                    }
                    data[rendered.len()..].fill(32_768);
                },
                error_callback,
                None,
            ),
            _ => return Err(format!("unsupported output sample format: {format}")),
        };
        stream.map_err(|error| error.to_string())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod supported {
    use super::Command;

    pub fn run(_command: Command) -> Result<(), String> {
        Err(
            "pulse-device-output is supported only on macOS (CoreAudio) and Windows (WASAPI)"
                .into(),
        )
    }
}

fn main() {
    let result = parse_args(std::env::args_os().skip(1)).and_then(|command| match command {
        Command::Play {
            device_name,
            routes,
        } if device_name == SIMULATED_OUTPUT_DEVICE_NAME => run_simulated(&routes),
        command => supported::run(command),
    });
    if let Err(error) = result {
        eprintln!("pulse-device-output: {error}");
        // Best effort: the worker reports this reason instead of a bare exit status.
        let _ = emit(&json!({ "type": "failed", "detail": error }));
        std::process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use a2_audio_node::monitor_output::RingTargets;

    fn args(values: &[&str]) -> Result<Command, String> {
        parse_args(values.iter().map(OsString::from))
    }

    #[test]
    fn playback_requires_an_exact_device_and_explicit_routes() {
        assert_eq!(
            args(&["--device", "Dante Virtual Soundcard", "--routes", "1;2,3"]),
            Ok(Command::Play {
                device_name: "Dante Virtual Soundcard".into(),
                routes: vec![vec![1], vec![2, 3]],
            })
        );
        assert_eq!(args(&["--list"]), Ok(Command::List));
        assert!(args(&["--device", "DVS"]).is_err());
        assert!(args(&["--device", "", "--routes", "1"]).is_err());
        assert!(args(&["--device", "DVS", "--routes", "0"]).is_err());
        assert!(args(&["--device", "DVS", "--routes", "1;1"]).is_err());
        assert!(args(&["--list", "extra"]).is_err());
    }

    #[test]
    fn feed_reassembles_samples_and_frames_split_across_reads() {
        struct Chunked(Vec<u8>, usize);
        impl Read for Chunked {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                let count = self.1.min(self.0.len()).min(buffer.len());
                buffer[..count].copy_from_slice(&self.0[..count]);
                self.0.drain(..count);
                Ok(count)
            }
        }
        let mut bytes = Vec::new();
        let values = [0.25_f32, -0.5, 0.75, 1.0, -0.25, 0.5, 0.125, -0.125];
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        // Two mixes per frame; 3-byte reads split samples and frames.
        let (producer, mut consumer, _counters) = frame_ring(
            16,
            2,
            RingTargets {
                prime: 4,
                ceiling: 8,
            },
        )
        .unwrap();
        let ended = AtomicBool::new(false);
        feed_ring(Chunked(bytes, 3), producer, &ended);
        assert!(ended.load(Ordering::Acquire));
        let mut output = [0.0; 8];
        consumer.pull(&mut output);
        assert_eq!(output, values);
    }
}
