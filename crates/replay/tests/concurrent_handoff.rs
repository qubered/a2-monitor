use a2_audio_host_api::{CaptureEpochId, DiscontinuityFlags};
use a2_pcm_abi::{
    ConcurrentPcmRing, ConcurrentPublishOutcome, ConcurrentReadOutcome, PcmAbiConfig,
    PcmBlockMetadata, SampleFormat, SequenceRange as PcmSequenceRange,
};
use a2_replay::{
    CaptureSessionId, DrainOutcome, IngressCommit, NodeBootId, ReadOutcome, ReaderPolicy,
    ReplayBlockMetadata, ReplayIngress, ReplayIngressConfig, ReplayRing, ReplayRingConfig,
};

const NODE_BOOT: [u8; 16] = *b"node-boot-id-001";
const CAPTURE_EPOCH: u64 = 9;

fn pcm_metadata(sequence: u64) -> PcmBlockMetadata {
    PcmBlockMetadata {
        sequence,
        capture_epoch: CAPTURE_EPOCH,
        first_frame_index: sequence * 4,
        frame_count: 4,
        channel_count: 2,
        monotonic_capture_ns: Some(sequence * 1_000),
        timing_uncertainty_ns: Some(25),
        discontinuity_flags: 0,
        cumulative_source_xruns: 0,
    }
}

fn replay_metadata(source: PcmBlockMetadata) -> ReplayBlockMetadata {
    ReplayBlockMetadata {
        sequence: source.sequence,
        node_boot_id: NodeBootId(NODE_BOOT),
        capture_session_id: CaptureSessionId(7),
        capture_epoch: CaptureEpochId(source.capture_epoch),
        first_frame_index: source.first_frame_index,
        frame_count: source.frame_count,
        channel_count: source.channel_count,
        sample_rate_hz: 48_000,
        monotonic_capture_ns: source.monotonic_capture_ns,
        discontinuity: DiscontinuityFlags::NONE,
        cumulative_source_xruns: source.cumulative_source_xruns,
    }
}

#[test]
fn concurrent_transport_loss_precedes_surviving_pcm_in_replay() {
    let transport = ConcurrentPcmRing::new(PcmAbiConfig {
        node_boot_id: NODE_BOOT,
        mapping_generation: 5,
        capture_epoch: CAPTURE_EPOCH,
        sample_format: SampleFormat::F32,
        channels: 2,
        frames_per_slot: 4,
        capacity: 2,
        page_size: 4_096,
    })
    .unwrap();
    let (mut producer, mut consumer) = transport.split(5, CAPTURE_EPOCH).unwrap();

    for sequence in 0..5 {
        let outcome = producer
            .publish(pcm_metadata(sequence), &[sequence as f32; 8])
            .unwrap();
        let expected_overwritten = sequence.checked_sub(2);
        match (outcome, expected_overwritten) {
            (
                ConcurrentPublishOutcome::Published {
                    overwritten: None, ..
                },
                None,
            ) => {}
            (
                ConcurrentPublishOutcome::Published {
                    overwritten: Some(overwritten),
                    ..
                },
                Some(expected),
            ) => {
                assert_eq!(overwritten.publication_sequence, expected);
                assert_eq!(overwritten.source.source_sequence, expected);
                assert_eq!(overwritten.source.frames.start, expected * 4);
                assert_eq!(overwritten.source.frames.end_exclusive, expected * 4 + 4);
            }
            other => panic!("unexpected publish accounting: {other:?}"),
        }
    }

    let replay = ReplayRing::new(ReplayRingConfig {
        generation: 11,
        node_boot_id: NodeBootId(NODE_BOOT),
        capture_session_id: CaptureSessionId(7),
        sample_rate_hz: 48_000,
        channels: 2,
        frames_per_block: 4,
        capacity_blocks: 4,
        max_readers: 1,
        initial_sequence: 0,
    })
    .unwrap();
    let mut writer = replay.attach_writer(11).unwrap();
    let mut ingress = ReplayIngress::new(ReplayIngressConfig {
        node_boot_id: NodeBootId(NODE_BOOT),
        capture_session_id: CaptureSessionId(7),
        capture_epoch: CaptureEpochId(CAPTURE_EPOCH),
        sample_rate_hz: 48_000,
        channels: 2,
        frames_per_block: 4,
        capacity_blocks: 2,
        max_drop_ranges: 2,
        initial_capture_sequence: 3,
        initial_ingress_sequence: 0,
    })
    .unwrap();

    let mut transport_samples = [0.0; 8];
    assert_eq!(
        consumer.read_into(&mut transport_samples).unwrap(),
        ConcurrentReadOutcome::Gap(PcmSequenceRange {
            start: 0,
            end_exclusive: 3,
        })
    );
    for expected in 3..5 {
        let ConcurrentReadOutcome::Block(block) =
            consumer.read_into(&mut transport_samples).unwrap()
        else {
            panic!("transport loss must be surfaced before surviving audio")
        };
        assert_eq!(block.source.sequence, expected);
        assert_eq!(transport_samples, [expected as f32; 8]);
        ingress
            .enqueue(replay_metadata(block.source), &transport_samples)
            .unwrap();
    }

    let mut replay_samples = [0.0; 8];
    loop {
        match ingress.peek_into(&mut replay_samples).unwrap() {
            DrainOutcome::Block {
                ingress_sequence,
                metadata,
                source_gap_before: None,
            } => {
                writer.append(metadata, &replay_samples).unwrap();
                ingress
                    .commit(IngressCommit::Block { ingress_sequence })
                    .unwrap();
            }
            DrainOutcome::Empty => break,
            other => panic!("unexpected replay ingress result: {other:?}"),
        }
    }

    let mut reader = replay
        .attach_reader(
            11,
            ReaderPolicy {
                cancel_after_lag_blocks: None,
            },
        )
        .unwrap();
    for expected in 3..5 {
        let ReadOutcome::Block(metadata) = reader.read_into(&mut replay_samples).unwrap() else {
            panic!("expected retained replay audio")
        };
        assert_eq!(metadata.first_frame_index, expected * 4);
        assert_eq!(replay_samples, [expected as f32; 8]);
    }
    assert_eq!(
        reader.read_into(&mut replay_samples),
        Ok(ReadOutcome::Empty)
    );
}
