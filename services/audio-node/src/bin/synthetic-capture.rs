use a2_audio_core::{Producer, PushError, RingConfig, SpscPcmRing};
use a2_audio_host_api::{
    CallbackControl, CaptureBlock, CaptureCallback, HostError, HostErrorKind, InputStream,
    SampleFormat, StreamConfig,
};
use a2_audio_node::{SYNTHETIC_DEVICE_ID, SyntheticAudioHost};
use a2_build_info::BUILD_ID;
use std::sync::mpsc::sync_channel;

struct RingSink(Producer);

impl CaptureCallback for RingSink {
    fn process(&mut self, block: CaptureBlock<'_>) -> CallbackControl {
        match self.0.try_push(block) {
            Ok(()) | Err(PushError::Full) => CallbackControl::Continue,
            Err(PushError::ShapeMismatch) => CallbackControl::Stop,
        }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("build_id={BUILD_ID}");
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
    println!(
        "capture_epoch={} sample_rate_hz={} channels={} frames_per_block={}",
        stream.capture_epoch().0,
        resolved.sample_rate_hz,
        resolved.channels,
        resolved.frames_per_block
    );
    stream.start()?;

    let mut output =
        vec![0.0; usize::from(resolved.channels) * usize::from(resolved.frames_per_block)];
    for _ in 0..16 {
        stream.render_blocks(1)?;
        let metadata = consumer
            .try_pop_into(&mut output)?
            .ok_or("synthetic block was not published")?;
        println!(
            "sequence={} first_frame={} frames={} channels={}",
            metadata.sequence,
            metadata.first_frame_index,
            metadata.frame_count,
            metadata.channel_count
        );
    }
    stream.stop()?;
    stream.close()?;
    Ok(())
}
