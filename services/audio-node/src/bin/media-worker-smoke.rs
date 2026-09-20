use std::cell::Cell;
use std::ffi::OsString;
use std::io::{self, Write};
use std::process::ExitCode;
use std::rc::Rc;

use a2_media::{
    CaptureEpochId, FrameNtpAnchor, MediaClock, MediaClockConfig, MediaSessionContext,
    MediaSessionEpochId, MediaSource, MediaWorkerGeneration, NodeBootId, NtpTimestamp,
    ProjectionError, SessionBoundary, SourcePacket,
};
use a2_pcm_abi::{
    ConcurrentPcmRing, ConcurrentPublishOutcome, ConcurrentPublishedBlock, ConcurrentReadOutcome,
    PcmAbiConfig, PcmBlockMetadata, SampleFormat,
};
use a2_supervisor::{
    BootId, EventDisposition, MonotonicClock, NodeReadiness, ProcessDriver, ReadinessRequirement,
    ReadyEvidence, RestartPolicy, Supervisor, WorkerHealth, WorkerId, WorkerRole, WorkerSpec,
};

const SAMPLE_RATE_HZ: u32 = 48_000;
const CHANNELS: u16 = 2;
const FRAMES_PER_BLOCK: u16 = 480;
const SAMPLES_PER_BLOCK: usize = CHANNELS as usize * FRAMES_PER_BLOCK as usize;
const CAPTURE_EPOCH: u64 = 7;
const MAPPING_GENERATION: u64 = 3;
const FRAME_BASE: u64 = 1_000;
const SOURCE_GAP_FRAMES: u32 = 480;
const RTP_BASE: u32 = u32::MAX - 239;
const FIRST_SSRC: u32 = 0x1020_3040;
const SECOND_SSRC: u32 = 0x5060_7080;
const MAX_SUMMARY_BYTES: usize = 640;
const BOOT: NodeBootId = NodeBootId(*b"smoke-node-boot1");
const SUPERVISOR_BOOT: BootId = BootId(u128::from_be_bytes(BOOT.0));
const MEDIA_WORKER: WorkerId = WorkerId(4);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SmokeSummary {
    pcm_blocks: u32,
    first_publication_sequence: u64,
    last_publication_sequence: u64,
    first_source_sequence: u64,
    last_source_sequence: u64,
    source_gap_frames: u32,
    first_rtp: u32,
    first_rtp_end: u32,
    second_rtp: u32,
    rtcp_rtp: u32,
    initial_worker_generation: u64,
    restarted_worker_generation: u64,
    initial_ssrc: u32,
    restarted_ssrc: u32,
    rtcp_anchor_generation: u64,
    rtcp_uncertainty_ns: u64,
    worker_spawns: usize,
}

#[derive(Clone, Debug, Default)]
struct ManualClock(Rc<Cell<u64>>);

impl ManualClock {
    fn advance(&self, milliseconds: u64) {
        self.0.set(self.0.get().saturating_add(milliseconds));
    }
}

impl MonotonicClock for ManualClock {
    fn now_ms(&self) -> u64 {
        self.0.get()
    }
}

#[derive(Debug, Default)]
struct RecordingDriver {
    spawns: Vec<(WorkerId, WorkerRole, BootId, u64)>,
}

impl ProcessDriver for RecordingDriver {
    type Handle = u64;
    type Error = ();

    fn spawn(
        &mut self,
        worker: WorkerId,
        role: WorkerRole,
        boot_id: BootId,
        generation: u64,
    ) -> Result<Self::Handle, Self::Error> {
        self.spawns.push((worker, role, boot_id, generation));
        Ok(generation)
    }

    fn request_shutdown(&mut self, _handle: Self::Handle) -> Result<(), Self::Error> {
        Ok(())
    }

    fn force_terminate(&mut self, _handle: Self::Handle) -> Result<(), Self::Error> {
        Ok(())
    }
}

fn restart_policy() -> RestartPolicy {
    RestartPolicy {
        startup_timeout_ms: 100,
        heartbeat_timeout_ms: 30,
        shutdown_grace_ms: 50,
        restart_window_ms: 1_000,
        restart_base_delay_ms: 10,
        restart_max_delay_ms: 40,
        max_restart_attempts: 2,
        terminate_retry_base_delay_ms: 10,
        terminate_retry_max_delay_ms: 40,
        max_force_terminate_attempts: 2,
    }
}

fn worker_generation(
    supervisor: &Supervisor<ManualClock, RecordingDriver>,
    expected_health: WorkerHealth,
) -> Result<u64, &'static str> {
    let snapshot = supervisor
        .snapshot(MEDIA_WORKER)
        .ok_or("media worker snapshot missing")?;
    if snapshot.health != expected_health {
        return Err("media worker lifecycle state changed");
    }
    snapshot.generation.ok_or("media worker generation missing")
}

fn parse_cli<I>(mut arguments: I) -> Result<(), &'static str>
where
    I: Iterator<Item = OsString>,
{
    if arguments.next().is_some() {
        return Err("usage: a2-media-worker-smoke");
    }
    Ok(())
}

fn context(worker_generation: u64, media_session_epoch: u64) -> MediaSessionContext {
    MediaSessionContext {
        node_boot_id: BOOT,
        media_session_epoch: MediaSessionEpochId(media_session_epoch),
        media_worker_generation: MediaWorkerGeneration(worker_generation),
    }
}

fn metadata(source_sequence: u64, first_frame_index: u64) -> PcmBlockMetadata {
    PcmBlockMetadata {
        sequence: source_sequence,
        capture_epoch: CAPTURE_EPOCH,
        first_frame_index,
        frame_count: FRAMES_PER_BLOCK,
        channel_count: CHANNELS,
        monotonic_capture_ns: Some(first_frame_index * 1_000_000_000 / u64::from(SAMPLE_RATE_HZ)),
        timing_uncertainty_ns: Some(50_000),
        discontinuity_flags: 0,
        cumulative_source_xruns: 0,
    }
}

fn read_block(
    consumer: &mut a2_pcm_abi::ConcurrentConsumer,
    output: &mut [f32],
) -> Result<ConcurrentPublishedBlock, &'static str> {
    match consumer.read_into(output).map_err(|_| "PCM read failed")? {
        ConcurrentReadOutcome::Block(block) => Ok(block),
        ConcurrentReadOutcome::Empty => Err("PCM ring unexpectedly empty"),
        ConcurrentReadOutcome::Gap(_) => Err("PCM ring unexpectedly lost a publication"),
        ConcurrentReadOutcome::Retry => Err("PCM ring unexpectedly requested a retry"),
    }
}

fn source_packet(block: ConcurrentPublishedBlock) -> SourcePacket {
    SourcePacket {
        source: MediaSource::Live(CaptureEpochId(block.source.capture_epoch)),
        first_frame_index: block.source.first_frame_index,
        frame_count: u32::from(block.source.frame_count),
    }
}

fn run_scenario() -> Result<SmokeSummary, &'static str> {
    let supervisor_clock = ManualClock::default();
    let mut supervisor = Supervisor::new(
        supervisor_clock.clone(),
        RecordingDriver::default(),
        SUPERVISOR_BOOT,
        restart_policy(),
        [WorkerSpec {
            id: MEDIA_WORKER,
            role: WorkerRole::Media,
            readiness: ReadinessRequirement::FreshMediaSessions,
        }],
    )
    .map_err(|_| "supervisor setup failed")?;
    supervisor.start();
    let initial_worker_generation = worker_generation(&supervisor, WorkerHealth::Starting)?;
    if supervisor.worker_ready(
        MEDIA_WORKER,
        SUPERVISOR_BOOT,
        initial_worker_generation,
        ReadyEvidence::Basic,
    ) != EventDisposition::EvidenceRejected
    {
        return Err("media worker accepted basic readiness evidence");
    }

    let pcm_ring = ConcurrentPcmRing::new(PcmAbiConfig {
        node_boot_id: BOOT.0,
        mapping_generation: MAPPING_GENERATION,
        capture_epoch: CAPTURE_EPOCH,
        sample_format: SampleFormat::F32,
        channels: CHANNELS,
        frames_per_slot: FRAMES_PER_BLOCK,
        capacity: 2,
        page_size: 4096,
    })
    .map_err(|_| "PCM ring setup failed")?;
    let (mut producer, mut consumer) = pcm_ring
        .split(MAPPING_GENERATION, CAPTURE_EPOCH)
        .map_err(|_| "PCM endpoint attach failed")?;
    let mut read_samples = [0.0_f32; SAMPLES_PER_BLOCK];
    let first_samples = [0.25_f32; SAMPLES_PER_BLOCK];
    let second_samples = [-0.5_f32; SAMPLES_PER_BLOCK];

    if !matches!(
        producer
            .publish(metadata(10, FRAME_BASE), &first_samples)
            .map_err(|_| "first PCM publish failed")?,
        ConcurrentPublishOutcome::Published {
            publication_sequence: 0,
            overwritten: None,
        }
    ) {
        return Err("first PCM publication was not retained");
    }
    let first = read_block(&mut consumer, &mut read_samples)?;
    if read_samples != first_samples {
        return Err("first PCM pattern changed");
    }

    let second_frame = FRAME_BASE + u64::from(FRAMES_PER_BLOCK) + u64::from(SOURCE_GAP_FRAMES);
    if !matches!(
        producer
            .publish(metadata(12, second_frame), &second_samples)
            .map_err(|_| "second PCM publish failed")?,
        ConcurrentPublishOutcome::Published {
            publication_sequence: 1,
            overwritten: None,
        }
    ) {
        return Err("second PCM publication was not retained");
    }
    let second = read_block(&mut consumer, &mut read_samples)?;
    if read_samples != second_samples || first.source.sequence != 10 || second.source.sequence != 12
    {
        return Err("PCM source identity or pattern changed");
    }

    let initial_context = context(initial_worker_generation, 11);
    let source = MediaSource::Live(CaptureEpochId(CAPTURE_EPOCH));
    let clock = MediaClock::new(MediaClockConfig {
        context: initial_context,
        source,
        source_frame_base: FRAME_BASE,
        rtp_timestamp_base: RTP_BASE,
        ssrc: FIRST_SSRC,
    })
    .map_err(|_| "media clock setup failed")?;
    if supervisor.worker_ready(
        MEDIA_WORKER,
        SUPERVISOR_BOOT,
        initial_worker_generation,
        ReadyEvidence::FreshMediaSessions,
    ) != EventDisposition::Accepted
        || supervisor.readiness() != NodeReadiness::WorkersReady
    {
        return Err("fresh media session did not satisfy readiness");
    }
    let first_packet = source_packet(first);
    let second_packet = source_packet(second);
    let gap = clock
        .validate_continuity(
            initial_context,
            first_packet,
            second_packet,
            SOURCE_GAP_FRAMES,
        )
        .map_err(|_| "source gap validation failed")?;
    let first_rtp = clock
        .project_packet(initial_context, first_packet)
        .map_err(|_| "first RTP projection failed")?;
    let second_rtp = clock
        .project_packet(initial_context, second_packet)
        .map_err(|_| "second RTP projection failed")?;
    if first_rtp.timestamp <= first_rtp.end_timestamp_exclusive {
        return Err("fixture did not cross the RTP wrap boundary");
    }

    let sender_report = clock
        .project_sender_report(
            initial_context,
            second_packet,
            FrameNtpAnchor {
                context: initial_context,
                source,
                source_frame_index: FRAME_BASE,
                monotonic_ns: 20_000_000,
                ntp: NtpTimestamp {
                    era: 0,
                    seconds: 1_000,
                    fraction: 0,
                },
                generation: 1,
                measurement_uncertainty_ns: 50_000,
                rate_error_ppb: 25,
            },
        )
        .map_err(|_| "RTCP projection failed")?;
    if sender_report.rtp_timestamp != second_rtp.timestamp
        || sender_report.anchor_generation != 1
        || sender_report.anchor_monotonic_ns != 20_000_000
        || sender_report.uncertainty_ns != 50_001
    {
        return Err("RTP and RTCP projection identity diverged");
    }

    if supervisor.worker_exited(MEDIA_WORKER, SUPERVISOR_BOOT, initial_worker_generation)
        != EventDisposition::Accepted
        || supervisor.readiness() != NodeReadiness::Degraded
    {
        return Err("media worker exit did not enter restart policy");
    }
    supervisor_clock.advance(10);
    supervisor.tick();
    let restarted_worker_generation = worker_generation(&supervisor, WorkerHealth::Starting)?;
    if supervisor.worker_ready(
        MEDIA_WORKER,
        SUPERVISOR_BOOT,
        initial_worker_generation,
        ReadyEvidence::FreshMediaSessions,
    ) != EventDisposition::IgnoredStale
    {
        return Err("supervisor accepted stale media readiness");
    }

    let restarted_context = context(restarted_worker_generation, 12);
    let reused_session = MediaClockConfig {
        context: context(restarted_worker_generation, 11),
        source,
        source_frame_base: FRAME_BASE,
        rtp_timestamp_base: 100,
        ssrc: SECOND_SSRC,
    };
    if clock.validate_successor(reused_session)
        != Err(ProjectionError::FreshSessionRequired(
            SessionBoundary::MediaWorkerRestarted,
        ))
    {
        return Err("worker restart accepted a reused media session");
    }
    let reused_ssrc = MediaClockConfig {
        context: restarted_context,
        ssrc: FIRST_SSRC,
        ..reused_session
    };
    if clock.validate_successor(reused_ssrc) != Err(ProjectionError::ReusedSsrc) {
        return Err("worker restart accepted a reused SSRC");
    }
    let restarted = MediaClockConfig {
        ssrc: SECOND_SSRC,
        ..reused_ssrc
    };
    clock
        .validate_successor(restarted)
        .map_err(|_| "fresh worker media identity was rejected")?;
    let restarted_clock = MediaClock::new(restarted).map_err(|_| "restart clock setup failed")?;
    if restarted_clock.project_packet(initial_context, first_packet)
        != Err(ProjectionError::FreshSessionRequired(
            SessionBoundary::MediaWorkerRestarted,
        ))
        || clock.project_packet(restarted_context, first_packet)
            != Err(ProjectionError::FreshSessionRequired(
                SessionBoundary::MediaWorkerRestarted,
            ))
    {
        return Err("worker restart did not fence stale media context");
    }
    if supervisor.worker_ready(
        MEDIA_WORKER,
        SUPERVISOR_BOOT,
        restarted_worker_generation,
        ReadyEvidence::FreshMediaSessions,
    ) != EventDisposition::Accepted
        || supervisor.readiness() != NodeReadiness::WorkersReady
    {
        return Err("restarted media worker did not become ready");
    }
    let worker_spawns = supervisor.driver().spawns.len();
    if worker_spawns != 2 {
        return Err("restart did not create exactly one replacement generation");
    }

    Ok(SmokeSummary {
        pcm_blocks: 2,
        first_publication_sequence: first.publication_sequence,
        last_publication_sequence: second.publication_sequence,
        first_source_sequence: first.source.sequence,
        last_source_sequence: second.source.sequence,
        source_gap_frames: gap,
        first_rtp: first_rtp.timestamp,
        first_rtp_end: first_rtp.end_timestamp_exclusive,
        second_rtp: second_rtp.timestamp,
        rtcp_rtp: sender_report.rtp_timestamp,
        initial_worker_generation,
        restarted_worker_generation,
        initial_ssrc: FIRST_SSRC,
        restarted_ssrc: SECOND_SSRC,
        rtcp_anchor_generation: sender_report.anchor_generation,
        rtcp_uncertainty_ns: sender_report.uncertainty_ns,
        worker_spawns,
    })
}

fn write_summary<W: Write>(mut output: W, summary: SmokeSummary) -> io::Result<W> {
    let line = format!(
        "schema_version=1 artifact_kind=smoke model=in_process_atomic supervision=policy_double os_process=false network=false codec=false random=false measured=false packaged=false promotion_eligible=false sample_rate_hz={SAMPLE_RATE_HZ} pcm_blocks={} publication_sequence={}..{} source_sequence={}..{} source_gap_frames={} rtp={}..{} second_rtp={} rtcp_rtp={} rtcp_anchor_generation={} rtcp_uncertainty_ns={} readiness=fresh_media_sessions restart=unexpected_exit worker_spawns={} worker_generation={}..{} stale_generation_fenced=true ssrc={}..{}",
        summary.pcm_blocks,
        summary.first_publication_sequence,
        summary.last_publication_sequence,
        summary.first_source_sequence,
        summary.last_source_sequence,
        summary.source_gap_frames,
        summary.first_rtp,
        summary.first_rtp_end,
        summary.second_rtp,
        summary.rtcp_rtp,
        summary.rtcp_anchor_generation,
        summary.rtcp_uncertainty_ns,
        summary.worker_spawns,
        summary.initial_worker_generation,
        summary.restarted_worker_generation,
        summary.initial_ssrc,
        summary.restarted_ssrc,
    );
    if line.len() + 1 > MAX_SUMMARY_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "media-worker smoke summary exceeds its fixed bound",
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
        write_summary(io::stdout().lock(), summary)
            .map(|_| ())
            .map_err(|_| "summary write failed")
    });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("a2-media-worker-smoke: {message}");
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
            parse_cli([OsString::from("--network")].into_iter()),
            Err("usage: a2-media-worker-smoke")
        );
    }

    #[test]
    fn scenario_composes_pcm_gap_wrap_rtcp_and_fresh_restart_identity() {
        assert_eq!(
            run_scenario(),
            Ok(SmokeSummary {
                pcm_blocks: 2,
                first_publication_sequence: 0,
                last_publication_sequence: 1,
                first_source_sequence: 10,
                last_source_sequence: 12,
                source_gap_frames: 480,
                first_rtp: u32::MAX - 239,
                first_rtp_end: 240,
                second_rtp: 720,
                rtcp_rtp: 720,
                initial_worker_generation: 1,
                restarted_worker_generation: 2,
                initial_ssrc: FIRST_SSRC,
                restarted_ssrc: SECOND_SSRC,
                rtcp_anchor_generation: 1,
                rtcp_uncertainty_ns: 50_001,
                worker_spawns: 2,
            })
        );
    }

    #[test]
    fn output_is_one_bounded_explicitly_non_promotional_line() {
        let output = write_summary(Vec::new(), run_scenario().unwrap()).unwrap();
        let output = String::from_utf8(output).unwrap();
        assert!(output.len() <= MAX_SUMMARY_BYTES);
        assert_eq!(
            output,
            "schema_version=1 artifact_kind=smoke model=in_process_atomic supervision=policy_double os_process=false network=false codec=false random=false measured=false packaged=false promotion_eligible=false sample_rate_hz=48000 pcm_blocks=2 publication_sequence=0..1 source_sequence=10..12 source_gap_frames=480 rtp=4294967056..240 second_rtp=720 rtcp_rtp=720 rtcp_anchor_generation=1 rtcp_uncertainty_ns=50001 readiness=fresh_media_sessions restart=unexpected_exit worker_spawns=2 worker_generation=1..2 stale_generation_fenced=true ssrc=270544960..1348497536\n"
        );
    }
}
