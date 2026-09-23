use std::ffi::OsString;

#[cfg(any(target_os = "macos", target_os = "windows"))]
const SAMPLE_RATE_HZ: u32 = 48_000;

#[derive(Debug, Eq, PartialEq)]
enum Command {
    List,
    Capture { device_name: String },
}

fn parse_args<I>(mut args: I) -> Result<Command, &'static str>
where
    I: Iterator<Item = OsString>,
{
    match (args.next(), args.next(), args.next()) {
        (Some(flag), None, None) if flag == "--list" => Ok(Command::List),
        (Some(flag), Some(device_name), None) if flag == "--device" => {
            let device_name = device_name
                .into_string()
                .map_err(|_| "device name must be valid UTF-8")?;
            if device_name.is_empty() {
                return Err("device name must not be empty");
            }
            Ok(Command::Capture { device_name })
        }
        _ => Err("usage: pulse-device-capture --list | --device <exact-device-name>"),
    }
}

#[cfg(any(test, target_os = "macos", target_os = "windows"))]
fn f32_sample(sample: f32) -> f32 {
    sample
}

#[cfg(any(test, target_os = "macos", target_os = "windows"))]
fn i16_sample(sample: i16) -> f32 {
    f32::from(sample) / 32_768.0
}

#[cfg(any(test, target_os = "macos", target_os = "windows"))]
fn u16_sample(sample: u16) -> f32 {
    (f32::from(sample) - 32_768.0) / 32_768.0
}

#[cfg(any(test, target_os = "macos", target_os = "windows"))]
fn encode_float32_le(samples: &[f32], output: &mut [u8]) -> usize {
    let sample_count = samples.len().min(output.len() / size_of::<f32>());
    let (output_samples, _) = output.as_chunks_mut::<{ size_of::<f32>() }>();
    for (sample, bytes) in samples[..sample_count]
        .iter()
        .zip(output_samples.iter_mut())
    {
        bytes.copy_from_slice(&sample.to_le_bytes());
    }
    sample_count * size_of::<f32>()
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod supported {
    use super::{Command, SAMPLE_RATE_HZ, encode_float32_le, f32_sample, i16_sample, u16_sample};
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{
        Device, SampleFormat, SampleRate, StreamConfig, SupportedBufferSize,
        SupportedStreamConfigRange,
    };
    use serde_json::json;
    use std::cell::UnsafeCell;
    use std::error::Error;
    use std::io::{self, Write};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::thread;
    use std::time::Duration;

    const MAX_LISTED_DEVICES: usize = 128;
    const MAX_CONFIGS_PER_DEVICE: usize = 128;
    const QUEUE_SECONDS: usize = 2;
    const WRITER_SAMPLES: usize = 16_384;
    const TARGET_BUFFER_FRAMES: u32 = 128;

    pub fn run(command: Command) -> Result<(), Box<dyn Error>> {
        match command {
            Command::List => list_devices(),
            Command::Capture { device_name } => capture(&device_name),
        }
    }

    fn list_devices() -> Result<(), Box<dyn Error>> {
        let host = cpal::default_host();
        let mut devices_json = Vec::new();
        let mut devices_truncated = false;

        for (device_index, device) in host.input_devices()?.enumerate() {
            if device_index == MAX_LISTED_DEVICES {
                devices_truncated = true;
                break;
            }
            let name = device.name().unwrap_or_else(|_| "<unavailable>".to_owned());
            let mut configs_json = Vec::new();
            let mut configs_truncated = false;
            if let Ok(configs) = device.supported_input_configs() {
                for (config_index, config) in configs.enumerate() {
                    if config_index == MAX_CONFIGS_PER_DEVICE {
                        configs_truncated = true;
                        break;
                    }
                    configs_json.push(json!({
                        "channelCount": config.channels(),
                        "sampleFormat": sample_format_name(config.sample_format()),
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

    fn capture(device_name: &str) -> Result<(), Box<dyn Error>> {
        let host = cpal::default_host();
        let device = find_exact_device(&host, device_name)?;
        let selected = select_config(&device)?.ok_or_else(|| {
            format!("device {device_name:?} has no 48 kHz f32, i16, or u16 input configuration")
        })?;
        let channels = selected.channels();
        let format = selected.sample_format();
        let queue_samples = usize::try_from(SAMPLE_RATE_HZ)?
            .checked_mul(usize::from(channels))
            .and_then(|samples| samples.checked_mul(QUEUE_SECONDS))
            .ok_or("capture queue size overflow")?;
        let stream_failed = Arc::new(AtomicBool::new(false));
        let callback_errors = Arc::new(AtomicU64::new(0));

        // The driver default is often 512 frames (10.7 ms at 48 kHz) before a sample reaches
        // this process. Ask for a small fixed buffer where the device advertises one, and fall
        // back to the default when the host (for example WASAPI shared mode) refuses it.
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
        let mut last_error = None;
        for buffer_size in buffer_sizes.into_iter().flatten() {
            let config = StreamConfig {
                channels,
                sample_rate: SampleRate(SAMPLE_RATE_HZ),
                buffer_size,
            };
            let (producer, consumer) = PcmQueue::new(queue_samples)?.split();
            let errors_for_callback = Arc::clone(&callback_errors);
            let failed_for_callback = Arc::clone(&stream_failed);
            let error_callback = move |_error| {
                errors_for_callback.fetch_add(1, Ordering::Relaxed);
                failed_for_callback.store(true, Ordering::Release);
            };
            match build_stream(&device, &config, format, producer, error_callback) {
                Ok(stream) => {
                    eprintln!("pulse-device-capture: input buffer {buffer_size:?}");
                    opened = Some((stream, consumer));
                    break;
                }
                Err(error) => last_error = Some(error),
            }
        }
        let (stream, mut consumer) = opened.ok_or_else(|| {
            format!(
                "device {device_name:?} could not open a 48 kHz input stream: {}",
                last_error.map_or_else(|| "no configuration".to_owned(), |error| error.to_string())
            )
        })?;

        let stdout = io::stdout();
        let mut output = stdout.lock();
        writeln!(
            output,
            "{}",
            json!({
                "schemaVersion": 0,
                "deviceName": device_name,
                "sampleRateHz": SAMPLE_RATE_HZ,
                "channelCount": channels,
            })
        )?;
        output.flush()?;
        stream.play()?;

        let mut samples = vec![0.0_f32; WRITER_SAMPLES];
        let mut bytes = vec![0_u8; WRITER_SAMPLES * size_of::<f32>()];
        loop {
            let count = consumer.try_pop(&mut samples);
            if count == 0 {
                if stream_failed.load(Ordering::Acquire) {
                    return Err(format!(
                        "audio input stream failed ({} callback error(s))",
                        callback_errors.load(Ordering::Relaxed)
                    )
                    .into());
                }
                thread::sleep(Duration::from_millis(1));
                continue;
            }
            let byte_count = encode_float32_le(&samples[..count], &mut bytes);
            output.write_all(&bytes[..byte_count])?;
            // Stdout is line-buffered; binary PCM must not wait for a 0x0A byte.
            output.flush()?;
        }
    }

    fn build_stream(
        device: &Device,
        config: &StreamConfig,
        format: SampleFormat,
        mut producer: Producer,
        error_callback: impl FnMut(cpal::StreamError) + Send + 'static,
    ) -> Result<cpal::Stream, Box<dyn Error>> {
        Ok(match format {
            SampleFormat::F32 => device.build_input_stream(
                config,
                move |data: &[f32], _| producer.try_push(data.iter().copied().map(f32_sample)),
                error_callback,
                None,
            )?,
            SampleFormat::I16 => device.build_input_stream(
                config,
                move |data: &[i16], _| producer.try_push(data.iter().copied().map(i16_sample)),
                error_callback,
                None,
            )?,
            SampleFormat::U16 => device.build_input_stream(
                config,
                move |data: &[u16], _| producer.try_push(data.iter().copied().map(u16_sample)),
                error_callback,
                None,
            )?,
            _ => return Err(format!("unsupported input sample format: {format}").into()),
        })
    }

    fn find_exact_device(host: &cpal::Host, expected_name: &str) -> Result<Device, Box<dyn Error>> {
        let mut selected = None;
        for device in host.input_devices()? {
            if matches!(device.name(), Ok(name) if name == expected_name) {
                if selected.is_some() {
                    return Err(format!(
                        "more than one input device has the exact name {expected_name:?}"
                    )
                    .into());
                }
                selected = Some(device);
            }
        }
        selected.ok_or_else(|| format!("input device not found: {expected_name:?}").into())
    }

    fn select_config(
        device: &Device,
    ) -> Result<Option<SupportedStreamConfigRange>, Box<dyn Error>> {
        let mut selected = None;
        for candidate in device.supported_input_configs()? {
            if candidate.min_sample_rate().0 <= SAMPLE_RATE_HZ
                && candidate.max_sample_rate().0 >= SAMPLE_RATE_HZ
                && matches!(
                    candidate.sample_format(),
                    SampleFormat::F32 | SampleFormat::I16 | SampleFormat::U16
                )
                && selected
                    .as_ref()
                    .is_none_or(|current: &SupportedStreamConfigRange| {
                        candidate.channels() > current.channels()
                    })
            {
                selected = Some(candidate);
            }
        }
        Ok(selected)
    }

    fn sample_format_name(format: SampleFormat) -> &'static str {
        match format {
            SampleFormat::F32 => "f32",
            SampleFormat::I16 => "i16",
            SampleFormat::U16 => "u16",
            _ => "unsupported",
        }
    }

    struct PcmQueue {
        samples: Box<[UnsafeCell<f32>]>,
        read: AtomicUsize,
        write: AtomicUsize,
        dropped_callbacks: AtomicU64,
    }

    // Safety: after split there is exactly one producer and one consumer.
    // Release/acquire publication prevents the consumer from reading samples
    // before the producer finishes writing them, and unread slots are not
    // overwritten.
    unsafe impl Sync for PcmQueue {}

    impl PcmQueue {
        fn new(capacity: usize) -> Result<Arc<Self>, &'static str> {
            if capacity == 0 {
                return Err("capture queue capacity must not be zero");
            }
            let mut samples = Vec::new();
            samples
                .try_reserve_exact(capacity)
                .map_err(|_| "could not allocate capture queue")?;
            samples.extend((0..capacity).map(|_| UnsafeCell::new(0.0)));
            Ok(Arc::new(Self {
                samples: samples.into_boxed_slice(),
                read: AtomicUsize::new(0),
                write: AtomicUsize::new(0),
                dropped_callbacks: AtomicU64::new(0),
            }))
        }

        fn split(self: Arc<Self>) -> (Producer, Consumer) {
            (
                Producer {
                    queue: Arc::clone(&self),
                },
                Consumer { queue: self },
            )
        }
    }

    struct Producer {
        queue: Arc<PcmQueue>,
    }

    impl Producer {
        fn try_push<I>(&mut self, samples: I)
        where
            I: ExactSizeIterator<Item = f32>,
        {
            let sample_count = samples.len();
            let read = self.queue.read.load(Ordering::Acquire);
            let write = self.queue.write.load(Ordering::Relaxed);
            let used = write.wrapping_sub(read);
            if sample_count > self.queue.samples.len().saturating_sub(used) {
                self.queue.dropped_callbacks.fetch_add(1, Ordering::Relaxed);
                return;
            }
            for (offset, sample) in samples.enumerate() {
                let index = write.wrapping_add(offset) % self.queue.samples.len();
                // Safety: this producer exclusively owns every unpublished
                // slot between write and write + sample_count.
                unsafe { *self.queue.samples[index].get() = sample };
            }
            self.queue
                .write
                .store(write.wrapping_add(sample_count), Ordering::Release);
        }
    }

    struct Consumer {
        queue: Arc<PcmQueue>,
    }

    impl Consumer {
        fn try_pop(&mut self, output: &mut [f32]) -> usize {
            let read = self.queue.read.load(Ordering::Relaxed);
            let write = self.queue.write.load(Ordering::Acquire);
            let count = write.wrapping_sub(read).min(output.len());
            for (offset, output_sample) in output[..count].iter_mut().enumerate() {
                let index = read.wrapping_add(offset) % self.queue.samples.len();
                // Safety: acquire observed publication and the producer does
                // not reuse this slot until read advances.
                *output_sample = unsafe { *self.queue.samples[index].get() };
            }
            self.queue
                .read
                .store(read.wrapping_add(count), Ordering::Release);
            count
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod supported {
    use super::Command;
    use std::error::Error;

    pub fn run(_command: Command) -> Result<(), Box<dyn Error>> {
        Err(
            "pulse-device-capture is supported only on macOS (CoreAudio) and Windows (WASAPI)"
                .into(),
        )
    }
}

fn main() {
    let result = parse_args(std::env::args_os().skip(1))
        .map_err(|error| -> Box<dyn std::error::Error> { error.into() })
        .and_then(supported::run);
    if let Err(error) = result {
        eprintln!("pulse-device-capture: {error}");
        std::process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_requires_an_explicit_exact_device_name() {
        assert_eq!(
            parse_args(
                ["--device", "Dante Virtual Soundcard"]
                    .map(OsString::from)
                    .into_iter()
            ),
            Ok(Command::Capture {
                device_name: "Dante Virtual Soundcard".to_owned()
            })
        );
        assert!(parse_args(["Dante Virtual Soundcard"].map(OsString::from).into_iter()).is_err());
        assert!(parse_args(["--device", ""].map(OsString::from).into_iter()).is_err());
        assert!(parse_args(std::iter::empty()).is_err());
    }

    #[test]
    fn list_is_a_separate_bounded_discovery_mode() {
        assert_eq!(
            parse_args([OsString::from("--list")].into_iter()),
            Ok(Command::List)
        );
        assert!(parse_args(["--list", "extra"].map(OsString::from).into_iter()).is_err());
    }

    #[test]
    fn converts_supported_pcm_formats_to_float32() {
        assert_eq!(f32_sample(0.25), 0.25);
        assert_eq!(i16_sample(i16::MIN), -1.0);
        assert_eq!(i16_sample(0), 0.0);
        assert_eq!(u16_sample(0), -1.0);
        assert_eq!(u16_sample(32_768), 0.0);
    }

    #[test]
    fn frames_samples_as_raw_float32_little_endian() {
        let samples = [1.0_f32, -0.5_f32];
        let mut output = [0_u8; 8];
        assert_eq!(encode_float32_le(&samples, &mut output), 8);
        assert_eq!(&output[..4], &1.0_f32.to_le_bytes());
        assert_eq!(&output[4..], &(-0.5_f32).to_le_bytes());
    }
}
