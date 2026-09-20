use std::ffi::OsString;
use std::io::{self, Write};
use std::process::ExitCode;

use a2_replay::{
    CaptureEpochId, CaptureSessionId, DiscontinuityFlags, DrainOutcome, IngressCommit, NodeBootId,
    ReaderPolicy, ReplayBlockMetadata, ReplayIngress, ReplayIngressConfig, ReplayRing,
    ReplayRingConfig,
};

const BOOT: NodeBootId = NodeBootId(*b"smoke-node-boot1");
const SESSION: CaptureSessionId = CaptureSessionId(2);
const EPOCH: CaptureEpochId = CaptureEpochId(3);
const GENERATION: u64 = 4;
const CHANNELS: u16 = 2;
const FRAMES_PER_BLOCK: u16 = 4;
const MAX_SUMMARY_BYTES: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SmokeSummary {
    ingress_dropped_blocks: u64,
    source_gap_frames: u64,
    loss_events: u32,
    replay_blocks: u32,
    retained_first_frame: u64,
    retained_end_frame: u64,
}

fn parse_cli<I>(mut arguments: I) -> Result<(), &'static str>
where
    I: Iterator<Item = OsString>,
{
    if arguments.next().is_some() {
        return Err("usage: a2-replay-smoke");
    }
    Ok(())
}

fn metadata(sequence: u64, first_frame_index: u64) -> ReplayBlockMetadata {
    ReplayBlockMetadata {
        sequence,
        node_boot_id: BOOT,
        capture_session_id: SESSION,
        capture_epoch: EPOCH,
        first_frame_index,
        frame_count: FRAMES_PER_BLOCK,
        channel_count: CHANNELS,
        sample_rate_hz: 48_000,
        monotonic_capture_ns: Some(first_frame_index * 1_000),
        discontinuity: DiscontinuityFlags::NONE,
        cumulative_source_xruns: 0,
    }
}

fn run_scenario() -> Result<SmokeSummary, &'static str> {
    let mut ingress = ReplayIngress::new(ReplayIngressConfig {
        node_boot_id: BOOT,
        capture_session_id: SESSION,
        capture_epoch: EPOCH,
        sample_rate_hz: 48_000,
        channels: CHANNELS,
        frames_per_block: FRAMES_PER_BLOCK,
        capacity_blocks: 2,
        max_drop_ranges: 2,
        initial_capture_sequence: 0,
        initial_ingress_sequence: 0,
    })
    .map_err(|_| "ingress setup failed")?;
    let ring = ReplayRing::new(ReplayRingConfig {
        generation: GENERATION,
        node_boot_id: BOOT,
        capture_session_id: SESSION,
        sample_rate_hz: 48_000,
        channels: CHANNELS,
        frames_per_block: FRAMES_PER_BLOCK,
        capacity_blocks: 4,
        max_readers: 1,
        initial_sequence: 0,
    })
    .map_err(|_| "replay setup failed")?;
    let mut writer = ring
        .attach_writer(GENERATION)
        .map_err(|_| "writer attach failed")?;

    let pcm = [0.25; 8];
    let first = ingress
        .enqueue(metadata(0, 0), &pcm)
        .map_err(|_| "first enqueue failed")?;
    let second = ingress
        .enqueue(metadata(1, 8), &pcm)
        .map_err(|_| "second enqueue failed")?;
    let third = ingress
        .enqueue(metadata(2, 12), &pcm)
        .map_err(|_| "overflow enqueue failed")?;
    if first.source_gap.is_some() || third.dropped_oldest.is_none() {
        return Err("synthetic ingress did not exercise required boundaries");
    }
    let expected_source_gap_frames = second
        .source_gap
        .map_or(0, |range| range.end_exclusive - range.start);

    let mut loss_events = 0_u32;
    let mut dropped_blocks = 0_u64;
    let mut replay_blocks = 0_u32;
    let mut source_gap_frames = 0_u64;
    let mut drain_samples = [0.0; 8];
    loop {
        match ingress
            .peek_into(&mut drain_samples)
            .map_err(|_| "ingress peek failed")?
        {
            DrainOutcome::Dropped(range) => {
                if replay_blocks != 0 {
                    return Err("ingress loss was not drained before later audio");
                }
                loss_events += 1;
                dropped_blocks += range.capture_sequences.len();
                ingress
                    .commit(IngressCommit::Dropped { range })
                    .map_err(|_| "loss commit failed")?;
            }
            DrainOutcome::Block {
                ingress_sequence,
                metadata,
                source_gap_before,
            } => {
                source_gap_frames +=
                    source_gap_before.map_or(0, |range| range.end_exclusive - range.start);
                let sample_count =
                    usize::from(metadata.frame_count) * usize::from(metadata.channel_count);
                writer
                    .append(metadata, &drain_samples[..sample_count])
                    .map_err(|_| "replay append failed")?;
                ingress
                    .commit(IngressCommit::Block { ingress_sequence })
                    .map_err(|_| "block commit failed")?;
                replay_blocks += 1;
            }
            DrainOutcome::IngressFenced { .. } => return Err("ingress unexpectedly fenced"),
            DrainOutcome::Empty => break,
        }
    }
    if source_gap_frames != expected_source_gap_frames {
        return Err("source gap was not preserved through ingress drain");
    }

    // Exercise the reader attachment fence without consuming or influencing retention.
    let _reader = ring
        .attach_reader(
            GENERATION,
            ReaderPolicy {
                cancel_after_lag_blocks: None,
            },
        )
        .map_err(|_| "reader attach failed")?;
    let window = ring.retained_window();
    let earliest = window.earliest.ok_or("missing earliest replay block")?;
    let latest = window.latest.ok_or("missing latest replay block")?;
    Ok(SmokeSummary {
        ingress_dropped_blocks: dropped_blocks,
        source_gap_frames,
        loss_events,
        replay_blocks,
        retained_first_frame: earliest.first_frame_index,
        retained_end_frame: latest.end_frame_exclusive,
    })
}

fn write_summary<W: Write>(mut output: W, summary: SmokeSummary) -> io::Result<W> {
    let line = format!(
        "schema_version=1 artifact_kind=smoke model=single_threaded_in_memory packaged=false promotion_eligible=false ingress_dropped_blocks={} source_gap_frames={} loss_events={} replay_blocks={} retained_frames={}..{}",
        summary.ingress_dropped_blocks,
        summary.source_gap_frames,
        summary.loss_events,
        summary.replay_blocks,
        summary.retained_first_frame,
        summary.retained_end_frame,
    );
    if line.len() + 1 > MAX_SUMMARY_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "replay smoke summary exceeds its fixed bound",
        ));
    }
    output.write_all(line.as_bytes())?;
    output.write_all(b"\n")?;
    Ok(output)
}

fn main() -> ExitCode {
    if let Err(message) = parse_cli(std::env::args_os().skip(1)) {
        eprintln!("{message}");
        return ExitCode::from(2);
    }
    let result = run_scenario().and_then(|summary| {
        let stdout = io::stdout();
        write_summary(stdout.lock(), summary)
            .map(|_| ())
            .map_err(|_| "summary write failed")
    });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("a2-replay-smoke: {message}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closed_cli_accepts_no_arguments_only() {
        assert_eq!(parse_cli(std::iter::empty()), Ok(()));
        assert_eq!(
            parse_cli([OsString::from("--unknown")].into_iter()),
            Err("usage: a2-replay-smoke")
        );
    }

    #[test]
    fn scenario_forces_loss_and_source_gap_then_retains_later_audio() {
        assert_eq!(
            run_scenario(),
            Ok(SmokeSummary {
                ingress_dropped_blocks: 1,
                source_gap_frames: 4,
                loss_events: 1,
                replay_blocks: 2,
                retained_first_frame: 8,
                retained_end_frame: 16,
            })
        );
    }

    #[test]
    fn output_is_one_bounded_non_promotional_line() {
        let summary = run_scenario().unwrap();
        let output = write_summary(Vec::new(), summary).unwrap();
        assert_eq!(
            String::from_utf8(output).unwrap(),
            "schema_version=1 artifact_kind=smoke model=single_threaded_in_memory packaged=false promotion_eligible=false ingress_dropped_blocks=1 source_gap_frames=4 loss_events=1 replay_blocks=2 retained_frames=8..16\n"
        );
    }

    #[test]
    fn failed_replay_append_leaves_ingress_block_identical_for_retry() {
        let mut ingress = ReplayIngress::new(ReplayIngressConfig {
            node_boot_id: BOOT,
            capture_session_id: SESSION,
            capture_epoch: EPOCH,
            sample_rate_hz: 48_000,
            channels: CHANNELS,
            frames_per_block: FRAMES_PER_BLOCK,
            capacity_blocks: 1,
            max_drop_ranges: 1,
            initial_capture_sequence: 0,
            initial_ingress_sequence: 0,
        })
        .unwrap();
        ingress.enqueue(metadata(0, 0), &[0.25; 8]).unwrap();
        let mut first_samples = [0.0; 8];
        let first = ingress.peek_into(&mut first_samples).unwrap();

        let wrong_shape = ReplayRing::new(ReplayRingConfig {
            generation: GENERATION,
            node_boot_id: BOOT,
            capture_session_id: SESSION,
            sample_rate_hz: 48_000,
            channels: 1,
            frames_per_block: FRAMES_PER_BLOCK,
            capacity_blocks: 1,
            max_readers: 1,
            initial_sequence: 0,
        })
        .unwrap();
        let mut writer = wrong_shape.attach_writer(GENERATION).unwrap();
        let DrainOutcome::Block { metadata, .. } = first else {
            panic!("expected ingress block")
        };
        assert!(writer.append(metadata, &first_samples).is_err());

        let mut retry_samples = [0.0; 8];
        assert_eq!(ingress.peek_into(&mut retry_samples).unwrap(), first);
        assert_eq!(retry_samples, first_samples);
        assert_eq!(ingress.queued_blocks(), 1);
    }
}
