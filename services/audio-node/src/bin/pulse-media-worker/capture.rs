//! Reader for the `pulse-device-capture` stdout contract: one JSON header line followed by
//! interleaved Float32LE frames. Frames are regrouped into fixed 10 ms blocks, the Opus
//! packet duration, so every downstream step works on whole packets.

use serde_json::Value;
use std::cell::RefCell;
use std::io::{ErrorKind, Read};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, TrySendError};

use crate::Event;

pub const SAMPLE_RATE_HZ: u32 = 48_000;
pub const FRAMES_PER_BLOCK: usize = 480;
const HEADER_LIMIT_BYTES: usize = 16 * 1024;
const MAX_CHANNELS: usize = 256;
const READ_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CaptureHeader {
    pub device_name: String,
    pub sample_rate_hz: u32,
    pub channel_count: usize,
}

/// One 10 ms block of interleaved samples. `first_frame` counts frames since capture start
/// and is the RTP media time source, so dropped blocks remain visible as timestamp gaps.
#[derive(Debug)]
pub struct CaptureBlock {
    pub first_frame: u64,
    pub channel_count: usize,
    pub samples: Vec<f32>,
}

impl CaptureBlock {
    pub fn sample(&self, frame: usize, channel: usize) -> f32 {
        self.samples[frame * self.channel_count + channel]
    }
}

pub fn parse_header(line: &[u8]) -> Result<CaptureHeader, String> {
    let value: Value =
        serde_json::from_slice(line).map_err(|_| "capture header is not valid JSON".to_owned())?;
    let record = value
        .as_object()
        .ok_or_else(|| "capture header must be a JSON object".to_owned())?;
    let mut keys: Vec<&str> = record.keys().map(String::as_str).collect();
    keys.sort_unstable();
    if keys
        != [
            "channelCount",
            "deviceName",
            "sampleRateHz",
            "schemaVersion",
        ]
    {
        return Err("capture header fields do not match schema version 0".to_owned());
    }
    if record.get("schemaVersion").and_then(Value::as_u64) != Some(0) {
        return Err("capture header schemaVersion must be 0".to_owned());
    }
    let device_name = record
        .get("deviceName")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty() && name.len() <= 512)
        .ok_or_else(|| "capture header deviceName is invalid".to_owned())?;
    let sample_rate_hz = record
        .get("sampleRateHz")
        .and_then(Value::as_u64)
        .ok_or_else(|| "capture header sampleRateHz is invalid".to_owned())?;
    if sample_rate_hz != u64::from(SAMPLE_RATE_HZ) {
        return Err(format!(
            "capture is {sample_rate_hz} Hz; the Opus listen path requires {SAMPLE_RATE_HZ} Hz"
        ));
    }
    let channel_count = record
        .get("channelCount")
        .and_then(Value::as_u64)
        .and_then(|count| usize::try_from(count).ok())
        .filter(|count| (1..=MAX_CHANNELS).contains(count))
        .ok_or_else(|| "capture header channelCount is invalid".to_owned())?;
    Ok(CaptureHeader {
        device_name: device_name.to_owned(),
        sample_rate_hz: SAMPLE_RATE_HZ,
        channel_count,
    })
}

/// Regroups an arbitrary byte stream into whole 10 ms blocks without per-sample allocation.
pub struct BlockAssembler {
    channel_count: usize,
    block_samples: usize,
    partial: [u8; 4],
    partial_len: usize,
    current: Vec<f32>,
    next_frame: u64,
}

impl BlockAssembler {
    pub fn new(channel_count: usize) -> Self {
        let block_samples = FRAMES_PER_BLOCK * channel_count;
        Self {
            channel_count,
            block_samples,
            partial: [0; 4],
            partial_len: 0,
            current: Vec::with_capacity(block_samples),
            next_frame: 0,
        }
    }

    pub fn block_samples(&self) -> usize {
        self.block_samples
    }

    pub fn push_bytes(
        &mut self,
        mut bytes: &[u8],
        next_buffer: &mut dyn FnMut() -> Vec<f32>,
        emit: &mut dyn FnMut(CaptureBlock),
    ) {
        if self.partial_len > 0 {
            let needed = 4 - self.partial_len;
            let take = needed.min(bytes.len());
            self.partial[self.partial_len..self.partial_len + take].copy_from_slice(&bytes[..take]);
            self.partial_len += take;
            bytes = &bytes[take..];
            if self.partial_len < 4 {
                return;
            }
            self.partial_len = 0;
            let sample = f32::from_le_bytes(self.partial);
            self.push_sample(sample, next_buffer, emit);
        }

        let (whole, remainder) = bytes.as_chunks::<4>();
        for sample in whole {
            self.push_sample(f32::from_le_bytes(*sample), next_buffer, emit);
        }
        self.partial[..remainder.len()].copy_from_slice(remainder);
        self.partial_len = remainder.len();
    }

    fn push_sample(
        &mut self,
        sample: f32,
        next_buffer: &mut dyn FnMut() -> Vec<f32>,
        emit: &mut dyn FnMut(CaptureBlock),
    ) {
        self.current.push(sample);
        if self.current.len() == self.block_samples {
            let mut replacement = next_buffer();
            replacement.clear();
            let samples = std::mem::replace(&mut self.current, replacement);
            let first_frame = self.next_frame;
            self.next_frame += FRAMES_PER_BLOCK as u64;
            emit(CaptureBlock {
                first_frame,
                channel_count: self.channel_count,
                samples,
            });
        }
    }
}

/// Runs on its own thread: parses the header, then forwards whole blocks to the event loop.
/// A full event queue drops the block rather than stalling the capture pipe.
pub fn read_capture(
    mut input: impl Read,
    events: SyncSender<Event>,
    recycled: Receiver<Vec<f32>>,
    dropped_blocks: Arc<AtomicU64>,
) {
    let mut buffer = vec![0_u8; READ_BUFFER_BYTES];
    let mut header_bytes = Vec::new();
    let mut assembler: Option<BlockAssembler> = None;
    // Buffers of blocks dropped on a full queue are reused before asking the event loop.
    let spare: RefCell<Vec<Vec<f32>>> = RefCell::new(Vec::new());

    loop {
        let count = match input.read(&mut buffer) {
            Ok(0) => {
                let _ = events.send(Event::CaptureEnded(
                    "capture process closed its output".into(),
                ));
                return;
            }
            Ok(count) => count,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => {
                let _ = events.send(Event::CaptureEnded(format!("capture read failed: {error}")));
                return;
            }
        };
        let mut bytes = &buffer[..count];

        if assembler.is_none() {
            let Some(newline) = bytes.iter().position(|byte| *byte == b'\n') else {
                if header_bytes.len() + bytes.len() > HEADER_LIMIT_BYTES {
                    let _ = events.send(Event::CaptureEnded(
                        "capture header exceeds the size limit".into(),
                    ));
                    return;
                }
                header_bytes.extend_from_slice(bytes);
                continue;
            };
            if header_bytes.len() + newline > HEADER_LIMIT_BYTES {
                let _ = events.send(Event::CaptureEnded(
                    "capture header exceeds the size limit".into(),
                ));
                return;
            }
            header_bytes.extend_from_slice(&bytes[..newline]);
            let header = match parse_header(&header_bytes) {
                Ok(header) => header,
                Err(detail) => {
                    let _ = events.send(Event::CaptureEnded(detail));
                    return;
                }
            };
            assembler = Some(BlockAssembler::new(header.channel_count));
            if events.send(Event::CaptureReady(header)).is_err() {
                return;
            }
            bytes = &bytes[newline + 1..];
        }

        let Some(assembler) = assembler.as_mut() else {
            continue;
        };
        let block_samples = assembler.block_samples();
        let mut disconnected = false;
        assembler.push_bytes(
            bytes,
            &mut || {
                spare
                    .borrow_mut()
                    .pop()
                    .or_else(|| recycled.try_recv().ok())
                    .unwrap_or_else(|| Vec::with_capacity(block_samples))
            },
            &mut |block| match events.try_send(Event::Capture(block)) {
                Ok(()) => {}
                Err(TrySendError::Full(Event::Capture(block))) => {
                    dropped_blocks.fetch_add(1, Ordering::Relaxed);
                    spare.borrow_mut().push(block.samples);
                }
                Err(_) => disconnected = true,
            },
        );
        if disconnected {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(json: &str) -> Result<CaptureHeader, String> {
        parse_header(json.as_bytes())
    }

    #[test]
    fn accepts_only_the_exact_version_zero_header_at_48_khz() {
        assert_eq!(
            header(
                r#"{"schemaVersion":0,"deviceName":"DVS","sampleRateHz":48000,"channelCount":64}"#
            ),
            Ok(CaptureHeader {
                device_name: "DVS".into(),
                sample_rate_hz: 48_000,
                channel_count: 64,
            })
        );
        assert!(
            header(
                r#"{"schemaVersion":0,"deviceName":"DVS","sampleRateHz":44100,"channelCount":2}"#
            )
            .is_err()
        );
        assert!(
            header(
                r#"{"schemaVersion":0,"deviceName":"DVS","sampleRateHz":48000,"channelCount":2,"x":1}"#
            )
            .is_err()
        );
        assert!(
            header(
                r#"{"schemaVersion":1,"deviceName":"DVS","sampleRateHz":48000,"channelCount":2}"#
            )
            .is_err()
        );
        assert!(
            header(
                r#"{"schemaVersion":0,"deviceName":"DVS","sampleRateHz":48000,"channelCount":0}"#
            )
            .is_err()
        );
    }

    #[test]
    fn regroups_split_float_bytes_into_whole_blocks_with_frame_positions() {
        let channels = 2;
        let total_frames = FRAMES_PER_BLOCK * 2 + 7;
        let mut bytes = Vec::new();
        for index in 0..total_frames * channels {
            bytes.extend_from_slice(&(index as f32).to_le_bytes());
        }

        let mut assembler = BlockAssembler::new(channels);
        let mut blocks = Vec::new();
        // Split at awkward offsets, including inside a sample.
        for chunk in bytes.chunks(333) {
            assembler.push_bytes(chunk, &mut Vec::new, &mut |block| blocks.push(block));
        }

        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].first_frame, 0);
        assert_eq!(blocks[1].first_frame, FRAMES_PER_BLOCK as u64);
        assert_eq!(blocks[1].samples.len(), FRAMES_PER_BLOCK * channels);
        assert_eq!(blocks[0].sample(0, 1), 1.0);
        assert_eq!(blocks[1].sample(0, 0), (FRAMES_PER_BLOCK * channels) as f32);
    }

    #[test]
    fn reader_reports_ready_then_blocks_then_end_of_stream() {
        let mut input =
            br#"{"schemaVersion":0,"deviceName":"Test","sampleRateHz":48000,"channelCount":1}"#
                .to_vec();
        input.push(b'\n');
        for index in 0..FRAMES_PER_BLOCK {
            input.extend_from_slice(&(index as f32).to_le_bytes());
        }

        let (events_tx, events_rx) = std::sync::mpsc::sync_channel(8);
        let (_recycle_tx, recycle_rx) = std::sync::mpsc::channel();
        read_capture(
            input.as_slice(),
            events_tx,
            recycle_rx,
            Arc::new(AtomicU64::new(0)),
        );

        assert!(
            matches!(events_rx.recv(), Ok(Event::CaptureReady(header)) if header.channel_count == 1)
        );
        assert!(matches!(
            events_rx.recv(),
            Ok(Event::Capture(block)) if block.first_frame == 0 && block.samples[479] == 479.0
        ));
        assert!(matches!(events_rx.recv(), Ok(Event::CaptureEnded(_))));
    }
}
