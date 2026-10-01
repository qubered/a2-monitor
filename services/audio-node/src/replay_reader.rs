//! Reads a recorded input back as 10 ms mono PCM blocks, in real time order, for replay.
//!
//! The reader works from the segment files alone. It starts at a UTC time, decodes packet by
//! packet, and crosses segment boundaries without a click. A gap in the recording (dropped
//! capture, or recording paused) is played as silence for its real length, never skipped, so
//! what a listener hears stays on the timeline. When it runs out of recording it says so and the
//! caller returns the listener to live.

use std::collections::VecDeque;
use std::io;
use std::path::{Path, PathBuf};

use opus::{Channels, Decoder};

use crate::recording::{PACKET_MS, PACKET_SAMPLES, SAMPLE_RATE_HZ, list_segments, read_segment};

/// Samples per millisecond at the recording rate.
const SAMPLES_PER_MS: u64 = SAMPLE_RATE_HZ as u64 / 1_000;
/// Consecutive segments are written by separate blocks, so their times differ by a few
/// milliseconds. Gaps this short are treated as continuous.
const CONTINUOUS_GAP_MS: u64 = 100;

#[derive(Debug, Eq, PartialEq)]
pub enum Read {
    Audio,
    /// There is no more recorded audio after what was just read.
    EndOfRecording,
}

struct Current {
    start_ms: u64,
    path: PathBuf,
    packets: Vec<Vec<u8>>,
    next: usize,
}

impl Current {
    fn end_ms(&self) -> u64 {
        self.start_ms + self.packets.len() as u64 * PACKET_MS
    }
}

pub struct ReplayReader {
    directory: PathBuf,
    decoder: Decoder,
    current: Option<Current>,
    pending: VecDeque<f32>,
    silent_samples: u64,
}

fn load(start_ms: u64, path: PathBuf) -> io::Result<Current> {
    let segment = read_segment(&path)?;
    Ok(Current {
        start_ms,
        path,
        packets: segment.packets,
        next: 0,
    })
}

impl ReplayReader {
    /// Opens `directory` (one input's segments) at `at_utc_ms`. `None` when nothing was recorded
    /// at or after that time.
    pub fn open(directory: &Path, at_utc_ms: u64) -> io::Result<Option<Self>> {
        let mut decoder = Decoder::new(SAMPLE_RATE_HZ, Channels::Mono)
            .map_err(|error| io::Error::other(error.to_string()))?;
        let mut reader = Self {
            directory: directory.to_path_buf(),
            decoder: Decoder::new(SAMPLE_RATE_HZ, Channels::Mono)
                .map_err(|error| io::Error::other(error.to_string()))?,
            current: None,
            pending: VecDeque::new(),
            silent_samples: 0,
        };
        let segments = list_segments(directory);
        let containing = segments.iter().rev().find(|(start, _)| *start <= at_utc_ms);
        if let Some((start, path)) = containing {
            let mut current = load(*start, path.clone())?;
            if at_utc_ms < current.end_ms() {
                let index = ((at_utc_ms - start) / PACKET_MS) as usize;
                // Prime the decoder with the packet before, so the first sound is not a cold start.
                if index > 0 {
                    let mut scratch = [0.0_f32; PACKET_SAMPLES];
                    let _ = decoder.decode_float(&current.packets[index - 1], &mut scratch, false);
                }
                current.next = index;
                let skip = ((at_utc_ms - start) % PACKET_MS * SAMPLES_PER_MS) as usize;
                reader.decoder = decoder;
                reader.current = Some(current);
                if reader.decode_next() {
                    reader.pending.drain(..skip.min(reader.pending.len()));
                }
                return Ok(Some(reader));
            }
            // After the end of that segment: start in the gap before the next one.
            reader.current = Some(current);
        }
        let from = reader.current.as_ref().map_or(at_utc_ms, Current::end_ms);
        let Some((next_start, next_path)) = segments
            .into_iter()
            .find(|(start, _)| *start > at_utc_ms.max(from.saturating_sub(1)))
        else {
            return Ok(None);
        };
        reader.silent_samples = next_start.saturating_sub(at_utc_ms) * SAMPLES_PER_MS;
        reader.current = Some(load(next_start, next_path)?);
        Ok(Some(reader))
    }

    fn decode_next(&mut self) -> bool {
        let Some(current) = self.current.as_mut() else {
            return false;
        };
        let Some(packet) = current.packets.get(current.next) else {
            return false;
        };
        current.next += 1;
        let mut pcm = [0.0_f32; PACKET_SAMPLES];
        match self.decoder.decode_float(packet, &mut pcm, false) {
            Ok(count) => self.pending.extend(&pcm[..count]),
            // A packet that will not decode is a short gap, not a reason to end replay.
            Err(_) => self
                .pending
                .extend(std::iter::repeat_n(0.0, PACKET_SAMPLES)),
        }
        true
    }

    /// Makes more audio available, crossing into the next segment when this one is used up.
    /// False when the recording has ended.
    fn refill(&mut self) -> bool {
        loop {
            if self.decode_next() {
                return true;
            }
            let Some(current) = self.current.as_ref() else {
                return false;
            };
            // The newest segment may still be growing.
            if let Ok(segment) = read_segment(&current.path)
                && segment.packets.len() > current.packets.len()
            {
                let current = self.current.as_mut().expect("checked above");
                current.packets = segment.packets;
                continue;
            }
            let (start_ms, end_ms) = (current.start_ms, current.end_ms());
            let Some((next_start, next_path)) = list_segments(&self.directory)
                .into_iter()
                .find(|(start, _)| *start > start_ms)
            else {
                return false;
            };
            let Ok(next) = load(next_start, next_path) else {
                return false;
            };
            let gap_ms = next_start.saturating_sub(end_ms);
            if gap_ms > CONTINUOUS_GAP_MS {
                self.silent_samples = gap_ms * SAMPLES_PER_MS;
            }
            self.decoder = Decoder::new(SAMPLE_RATE_HZ, Channels::Mono)
                .expect("decoder parameters are fixed and valid");
            self.current = Some(next);
        }
    }

    /// Fills `output` with the next samples. On `EndOfRecording` the rest of `output` is silent.
    pub fn read_block(&mut self, output: &mut [f32]) -> Read {
        let mut written = 0;
        while written < output.len() {
            if self.silent_samples > 0 {
                output[written] = 0.0;
                self.silent_samples -= 1;
                written += 1;
            } else if let Some(sample) = self.pending.pop_front() {
                output[written] = sample;
                written += 1;
            } else if !self.refill() {
                output[written..].fill(0.0);
                return Read::EndOfRecording;
            }
        }
        Read::Audio
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recording::{SegmentHeader, SegmentWriter, channel_directory};
    use opus::{Application, Encoder};
    use std::fs;

    const T0: u64 = 1_700_000_000_000;

    fn scratch(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("pulse-replay-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        path
    }

    /// Writes `seconds` of a 1 kHz tone as one segment starting at `start_ms`.
    fn write_tone(root: &Path, start_ms: u64, seconds: u64, finish: bool) {
        let mut encoder = Encoder::new(48_000, Channels::Mono, Application::Audio).unwrap();
        let mut writer = SegmentWriter::create(
            root,
            SegmentHeader {
                channel: 0,
                first_frame: 0,
                start_utc_ms: start_ms,
            },
        )
        .unwrap();
        let mut out = [0_u8; 1_275];
        for packet in 0..seconds * 50 {
            let pcm: Vec<f32> = (0..960)
                .map(|n| {
                    let t = (packet as usize * 960 + n) as f32 / 48_000.0;
                    0.5 * (2.0 * std::f32::consts::PI * 1_000.0 * t).sin()
                })
                .collect();
            let length = encoder.encode_float(&pcm, &mut out).unwrap();
            writer.write_packet(&out[..length]).unwrap();
        }
        if finish {
            writer.finish().unwrap();
        }
    }

    fn peak(reader: &mut ReplayReader, blocks: usize) -> (f32, Read) {
        let mut block = [0.0_f32; 480];
        let mut peak = 0.0_f32;
        let mut outcome = Read::Audio;
        for _ in 0..blocks {
            outcome = reader.read_block(&mut block);
            peak = block
                .iter()
                .fold(peak, |peak, sample| peak.max(sample.abs()));
        }
        (peak, outcome)
    }

    #[test]
    fn plays_from_the_requested_time_and_ends_with_the_recording() {
        let root = scratch("play");
        write_tone(&root, T0, 2, true);
        let directory = channel_directory(&root, 0);
        let mut reader = ReplayReader::open(&directory, T0 + 500).unwrap().unwrap();
        // 1.5 s remain: 150 blocks of tone, then the recording ends.
        let (tone, outcome) = peak(&mut reader, 120);
        assert!((0.4..0.6).contains(&tone), "tone peak {tone}");
        assert_eq!(outcome, Read::Audio);
        let (_, outcome) = peak(&mut reader, 40);
        assert_eq!(outcome, Read::EndOfRecording);
        assert!(
            ReplayReader::open(&directory, T0 + 5_000)
                .unwrap()
                .is_none()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn crosses_a_segment_boundary_and_plays_a_gap_as_silence() {
        let root = scratch("gap");
        write_tone(&root, T0, 1, true);
        write_tone(&root, T0 + 1_003, 1, true); // a few ms later: continuous
        write_tone(&root, T0 + 3_000, 1, true); // 1 s gap before this one
        let directory = channel_directory(&root, 0);
        let mut reader = ReplayReader::open(&directory, T0).unwrap().unwrap();
        let (tone, _) = peak(&mut reader, 200);
        assert!(tone > 0.4, "both continuous segments are audible");
        let (silence, _) = peak(&mut reader, 90); // 0.9 s of the 1 s gap
        assert!(silence < 0.01, "the gap is silent, peak {silence}");
        let (tone, outcome) = peak(&mut reader, 40);
        assert!(tone > 0.4, "audio resumes after the gap");
        assert_eq!(outcome, Read::Audio);

        // Opening inside the gap starts silent, then plays the next segment.
        let mut inside = ReplayReader::open(&directory, T0 + 2_500).unwrap().unwrap();
        assert!(peak(&mut inside, 49).0 < 0.01);
        assert!(peak(&mut inside, 60).0 > 0.4);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn follows_a_segment_that_is_still_being_written() {
        let root = scratch("open");
        write_tone(&root, T0, 1, false); // never finished: no packet count in the name
        let directory = channel_directory(&root, 0);
        let mut reader = ReplayReader::open(&directory, T0 + 900).unwrap().unwrap();
        let (_, outcome) = peak(&mut reader, 20);
        assert_eq!(outcome, Read::EndOfRecording, "caught up with the writer");
        fs::remove_dir_all(root).unwrap();
    }
}
