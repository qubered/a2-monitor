use a2_audio_core::{Producer, PushError, RingConfig, SpscPcmRing};
use a2_audio_host_api::{
    CallbackControl, CaptureBlock, CaptureCallback, CaptureEpochId, InputStream, SampleFormat,
    StreamConfig,
};
use a2_audio_node::{SYNTHETIC_DEVICE_ID, SyntheticAudioHost};
use a2_build_info::BUILD_ID;

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
        channels: 8,
        frames_per_block: 480,
        sample_format: SampleFormat::F32,
    };
    let ring = SpscPcmRing::new(RingConfig {
        capacity_blocks: 8,
        channels: config.channels,
        frames_per_block: config.frames_per_block,
    })?;
    let (producer, mut consumer) = ring.split().ok_or("ring endpoints already claimed")?;
    let mut stream = SyntheticAudioHost::new(CaptureEpochId(1))
        .open_deterministic_input(config, Box::new(RingSink(producer)))?;
    stream.start()?;

    let mut output = vec![0.0; usize::from(config.channels) * usize::from(config.frames_per_block)];
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
    Ok(())
}
