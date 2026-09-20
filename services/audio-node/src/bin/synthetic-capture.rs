use a2_audio_core::{Producer, PushError, RingConfig, SpscPcmRing};
use a2_audio_host_api::{
    CallbackControl, CaptureBlock, CaptureBlockMetadata, CaptureCallback, HostError, HostErrorKind,
    InputStream, SampleFormat, StreamConfig,
};
use a2_audio_node::{SYNTHETIC_DEVICE_ID, SyntheticAudioHost};
use a2_build_info::BUILD_ID;
use std::ffi::OsString;
use std::io::{self, Write};
use std::sync::mpsc::sync_channel;

const CAPTURE_BLOCKS: usize = 16;
const TRACE_RECORDS: usize = CAPTURE_BLOCKS + 2;
const MAX_TRACE_LINE_BYTES: usize = 512;
const MAX_TRACE_BYTES: usize = TRACE_RECORDS * (MAX_TRACE_LINE_BYTES + 1);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OutputMode {
    Human,
    TraceJsonl,
}

struct RingSink(Producer);

impl CaptureCallback for RingSink {
    fn process(&mut self, block: CaptureBlock<'_>) -> CallbackControl {
        match self.0.try_push(block) {
            Ok(()) | Err(PushError::Full) => CallbackControl::Continue,
            Err(PushError::ShapeMismatch) => CallbackControl::Stop,
        }
    }
}

fn parse_output_mode<I>(mut arguments: I) -> Result<OutputMode, &'static str>
where
    I: Iterator<Item = OsString>,
{
    match (arguments.next(), arguments.next()) {
        (None, None) => Ok(OutputMode::Human),
        (Some(argument), None) if argument == "--trace-jsonl" => Ok(OutputMode::TraceJsonl),
        _ => Err("usage: a2-synthetic-capture [--trace-jsonl]"),
    }
}

fn optional_u64_json(value: Option<u64>) -> String {
    value.map_or_else(|| "null".to_owned(), |value| format!("\"{value}\""))
}

fn optional_u32_json(value: Option<u32>) -> String {
    value.map_or_else(|| "null".to_owned(), |value| value.to_string())
}

fn trace_start(requested: StreamConfig, resolved: StreamConfig, capture_epoch: u64) -> String {
    format!(
        "{{\"schemaVersion\":1,\"recordType\":\"capture_start\",\"promotionEligible\":false,\"expectedBlockCount\":{CAPTURE_BLOCKS},\"captureEpoch\":\"{capture_epoch}\",\"requested\":{{\"sampleRateHz\":{},\"channelCount\":{},\"framesPerBlock\":{},\"sampleFormat\":\"f32\"}},\"resolved\":{{\"sampleRateHz\":{},\"channelCount\":{},\"framesPerBlock\":{},\"sampleFormat\":\"f32\"}}}}",
        requested.sample_rate_hz,
        requested.channels,
        requested.frames_per_block,
        resolved.sample_rate_hz,
        resolved.channels,
        resolved.frames_per_block,
    )
}

// This serializer accepts copied metadata only. It runs after the control-side
// ring consumer pops a block, so JSON formatting and I/O cannot reach the
// real-time callback or expose PCM samples.
fn trace_block(metadata: CaptureBlockMetadata) -> String {
    format!(
        "{{\"schemaVersion\":1,\"recordType\":\"capture_block\",\"captureEpoch\":\"{}\",\"sequence\":\"{}\",\"firstFrameIndex\":\"{}\",\"frameCount\":{},\"channelCount\":{},\"monotonicCaptureNs\":{},\"timingUncertaintyNs\":{},\"discontinuityFlags\":{},\"cumulativeSourceXruns\":\"{}\"}}",
        metadata.capture_epoch.0,
        metadata.sequence,
        metadata.first_frame_index,
        metadata.frame_count,
        metadata.channel_count,
        optional_u64_json(metadata.timing.monotonic_capture_ns),
        optional_u32_json(metadata.timing.uncertainty_ns),
        metadata.discontinuity.bits(),
        metadata.cumulative_source_xruns,
    )
}

fn trace_end(capture_epoch: u64, observed_blocks: usize) -> String {
    format!(
        "{{\"schemaVersion\":1,\"recordType\":\"capture_end\",\"captureEpoch\":\"{capture_epoch}\",\"observedBlockCount\":{observed_blocks}}}"
    )
}

struct BoundedTraceWriter<W> {
    output: W,
    records: usize,
    bytes: usize,
}

enum CaptureOutput<W> {
    Human(W),
    Trace(BoundedTraceWriter<W>),
}

impl<W: Write> CaptureOutput<W> {
    fn start(
        &mut self,
        requested: StreamConfig,
        resolved: StreamConfig,
        capture_epoch: u64,
    ) -> io::Result<()> {
        match self {
            Self::Human(output) => {
                writeln!(output, "build_id={BUILD_ID}")?;
                writeln!(
                    output,
                    "capture_epoch={} sample_rate_hz={} channels={} frames_per_block={}",
                    capture_epoch,
                    resolved.sample_rate_hz,
                    resolved.channels,
                    resolved.frames_per_block
                )
            }
            Self::Trace(output) => {
                output.write_record(&trace_start(requested, resolved, capture_epoch))
            }
        }
    }

    fn block(&mut self, metadata: CaptureBlockMetadata) -> io::Result<()> {
        match self {
            Self::Human(output) => writeln!(
                output,
                "sequence={} first_frame={} frames={} channels={}",
                metadata.sequence,
                metadata.first_frame_index,
                metadata.frame_count,
                metadata.channel_count
            ),
            Self::Trace(output) => output.write_record(&trace_block(metadata)),
        }
    }

    fn finish(mut self, capture_epoch: u64) -> io::Result<W> {
        match &mut self {
            Self::Human(_) => {}
            Self::Trace(output) => {
                output.write_record(&trace_end(capture_epoch, CAPTURE_BLOCKS))?;
            }
        }
        match self {
            Self::Human(output) => Ok(output),
            Self::Trace(output) => output.finish(),
        }
    }
}

impl<W: Write> BoundedTraceWriter<W> {
    fn new(output: W) -> Self {
        Self {
            output,
            records: 0,
            bytes: 0,
        }
    }

    fn write_record(&mut self, record: &str) -> io::Result<()> {
        let record_bytes = record.len();
        if self.records >= TRACE_RECORDS
            || record_bytes > MAX_TRACE_LINE_BYTES
            || self.bytes + record_bytes + 1 > MAX_TRACE_BYTES
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "synthetic capture trace exceeds its fixed output bounds",
            ));
        }
        self.output.write_all(record.as_bytes())?;
        self.output.write_all(b"\n")?;
        self.records += 1;
        self.bytes += record_bytes + 1;
        Ok(())
    }

    fn finish(self) -> io::Result<W> {
        if self.records != TRACE_RECORDS {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "synthetic capture trace is incomplete",
            ));
        }
        Ok(self.output)
    }
}

fn run<W: Write>(mode: OutputMode, output: W) -> Result<W, Box<dyn std::error::Error>> {
    let config = StreamConfig {
        device_id: SYNTHETIC_DEVICE_ID,
        sample_rate_hz: 48_000,
        channels: 64,
        frames_per_block: 480,
        sample_format: SampleFormat::F32,
    };
    let (consumer_sender, consumer_receiver) = sync_channel(1);
    let callback_factory = move |resolved: StreamConfig| {
        let ring = SpscPcmRing::new(RingConfig {
            capacity_blocks: 8,
            channels: resolved.channels,
            frames_per_block: resolved.frames_per_block,
        })
        .map_err(|_| {
            HostError::new(
                HostErrorKind::CallbackSetupFailed,
                "resolved stream configuration cannot size the PCM ring",
            )
        })?;
        let (producer, consumer) = ring.split().ok_or_else(|| {
            HostError::new(
                HostErrorKind::CallbackSetupFailed,
                "PCM ring endpoints are already claimed",
            )
        })?;
        consumer_sender.send(consumer).map_err(|_| {
            HostError::new(
                HostErrorKind::CallbackSetupFailed,
                "PCM ring consumer handoff failed",
            )
        })?;
        Ok(Box::new(RingSink(producer)) as Box<dyn CaptureCallback>)
    };
    let mut stream =
        SyntheticAudioHost::new().open_deterministic_input(config, Box::new(callback_factory))?;
    let mut consumer = consumer_receiver.recv()?;
    let resolved = stream.resolved_config();
    let capture_epoch = stream.capture_epoch().0;
    let mut capture_output = match mode {
        OutputMode::Human => CaptureOutput::Human(output),
        OutputMode::TraceJsonl => CaptureOutput::Trace(BoundedTraceWriter::new(output)),
    };
    capture_output.start(config, resolved, capture_epoch)?;
    stream.start()?;

    let mut samples =
        vec![0.0; usize::from(resolved.channels) * usize::from(resolved.frames_per_block)];
    for _ in 0..CAPTURE_BLOCKS {
        stream.render_blocks(1)?;
        let metadata = consumer
            .try_pop_into(&mut samples)?
            .ok_or("synthetic block was not published")?;
        capture_output.block(metadata)?;
    }
    stream.stop()?;
    stream.close()?;

    Ok(capture_output.finish(capture_epoch)?)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mode = parse_output_mode(std::env::args_os().skip(1))?;
    let stdout = io::stdout();
    let output = io::BufWriter::new(stdout.lock());
    run(mode, output)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use a2_audio_host_api::{CaptureEpochId, CaptureTiming, DiscontinuityFlags};

    fn metadata(timing: CaptureTiming) -> CaptureBlockMetadata {
        CaptureBlockMetadata {
            capture_epoch: CaptureEpochId(7),
            first_frame_index: 960,
            frame_count: 480,
            channel_count: 64,
            sequence: 2,
            timing,
            discontinuity: DiscontinuityFlags::SOURCE_XRUN,
            cumulative_source_xruns: 3,
        }
    }

    #[test]
    fn block_encoding_is_exact_and_preserves_u64_as_decimal_strings() {
        let encoded = trace_block(metadata(CaptureTiming {
            monotonic_capture_ns: Some(20_000_000),
            uncertainty_ns: Some(125),
        }));
        assert_eq!(
            encoded,
            "{\"schemaVersion\":1,\"recordType\":\"capture_block\",\"captureEpoch\":\"7\",\"sequence\":\"2\",\"firstFrameIndex\":\"960\",\"frameCount\":480,\"channelCount\":64,\"monotonicCaptureNs\":\"20000000\",\"timingUncertaintyNs\":125,\"discontinuityFlags\":1,\"cumulativeSourceXruns\":\"3\"}"
        );
        assert!(!encoded.contains("samples"));
    }

    #[test]
    fn unavailable_timing_values_encode_as_json_null() {
        let encoded = trace_block(metadata(CaptureTiming {
            monotonic_capture_ns: None,
            uncertainty_ns: None,
        }));
        assert!(encoded.contains("\"monotonicCaptureNs\":null"));
        assert!(encoded.contains("\"timingUncertaintyNs\":null"));
    }

    #[test]
    fn trace_mode_is_jsonl_only_and_within_fixed_bounds() {
        let bytes = run(OutputMode::TraceJsonl, Vec::new()).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        let lines: Vec<_> = text.lines().collect();

        assert_eq!(lines.len(), TRACE_RECORDS);
        assert!(lines.iter().all(|line| line.starts_with('{')));
        assert!(lines.iter().all(|line| line.len() <= MAX_TRACE_LINE_BYTES));
        assert!(text.len() <= MAX_TRACE_BYTES);
        assert_eq!(lines[0], trace_start(config(), config(), 1));
        assert!(lines[0].contains("\"promotionEligible\":false"));
        assert!(lines[0].contains("\"requested\":"));
        assert!(lines[0].contains("\"resolved\":"));
        assert_eq!(lines[TRACE_RECORDS - 1], trace_end(1, CAPTURE_BLOCKS));
        assert!(!text.contains("build_id="));
        assert_eq!(
            text,
            include_str!("../../../../tools/evidence/fixtures/synthetic-capture-trace-v1.jsonl")
        );
    }

    #[test]
    fn output_arguments_are_closed_and_human_output_remains_the_default() {
        assert_eq!(
            parse_output_mode(Vec::<OsString>::new().into_iter()),
            Ok(OutputMode::Human)
        );
        assert_eq!(
            parse_output_mode(vec![OsString::from("--trace-jsonl")].into_iter()),
            Ok(OutputMode::TraceJsonl)
        );
        assert!(parse_output_mode(vec![OsString::from("--unknown")].into_iter()).is_err());
        assert!(
            parse_output_mode(
                vec![OsString::from("--trace-jsonl"), OsString::from("extra")].into_iter()
            )
            .is_err()
        );

        let human = String::from_utf8(run(OutputMode::Human, Vec::new()).unwrap()).unwrap();
        assert!(human.starts_with(&format!("build_id={BUILD_ID}\n")));
        assert!(human.contains("sequence=15 first_frame=7200 frames=480 channels=64\n"));
        assert!(!human.contains("\"recordType\""));
    }

    #[test]
    fn bounded_writer_rejects_long_extra_and_incomplete_output() {
        let mut long = BoundedTraceWriter::new(Vec::new());
        assert!(
            long.write_record(&"x".repeat(MAX_TRACE_LINE_BYTES + 1))
                .is_err()
        );

        let mut extra = BoundedTraceWriter::new(Vec::new());
        for _ in 0..TRACE_RECORDS {
            extra.write_record("{}").unwrap();
        }
        assert!(extra.write_record("{}").is_err());

        let mut incomplete = BoundedTraceWriter::new(Vec::new());
        incomplete.write_record("{}").unwrap();
        assert!(incomplete.finish().is_err());
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
}
