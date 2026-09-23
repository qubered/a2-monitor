//! Per-input peak, RMS and clip metering over captured blocks (ADR 0027).
//!
//! Metering runs in the worker's event loop on blocks already read from the capture pipe,
//! never on the capture callback. Accumulators are sized once per capture, so steady-state
//! metering does not grow with uptime.

use crate::capture::{CaptureBlock, FRAMES_PER_BLOCK, SAMPLE_RATE_HZ};

/// Five 10 ms blocks: meters are published at 20 Hz.
pub const METER_INTERVAL_BLOCKS: usize = 5;
pub const METER_INTERVAL_MS: u64 =
    (METER_INTERVAL_BLOCKS * FRAMES_PER_BLOCK) as u64 * 1_000 / SAMPLE_RATE_HZ as u64;
/// Digital silence is reported as this floor rather than negative infinity.
pub const LEVEL_FLOOR_DBFS: f64 = -120.0;
/// A sample at or above this magnitude counts as clipped (about -0.01 dBFS).
pub const CLIP_THRESHOLD: f32 = 0.999;

/// One closed meter interval, one value per captured input.
#[derive(Debug, PartialEq)]
pub struct MeterReading {
    pub sequence: u64,
    pub peak_dbfs: Vec<f64>,
    pub rms_dbfs: Vec<f64>,
    pub clipped_samples: Vec<u32>,
}

pub fn to_dbfs(linear: f64) -> f64 {
    if linear.is_nan() || linear <= 0.0 {
        return LEVEL_FLOOR_DBFS;
    }
    let dbfs = (20.0 * linear.log10()).clamp(LEVEL_FLOOR_DBFS, 0.0);
    (dbfs * 10.0).round() / 10.0
}

pub struct MeterBank {
    channel_count: usize,
    peak: Vec<f32>,
    sum_squares: Vec<f64>,
    clipped: Vec<u32>,
    frames: usize,
    blocks: usize,
    sequence: u64,
}

impl MeterBank {
    pub fn new(channel_count: usize) -> Self {
        Self {
            channel_count,
            peak: vec![0.0; channel_count],
            sum_squares: vec![0.0; channel_count],
            clipped: vec![0; channel_count],
            frames: 0,
            blocks: 0,
            sequence: 0,
        }
    }

    /// Accumulates one block and returns a reading when it closes an interval.
    pub fn process(&mut self, block: &CaptureBlock) -> Option<MeterReading> {
        if block.channel_count != self.channel_count {
            return None;
        }
        for frame in block.samples.chunks_exact(self.channel_count) {
            for (channel, sample) in frame.iter().enumerate() {
                let magnitude = sample.abs();
                if magnitude > self.peak[channel] {
                    self.peak[channel] = magnitude;
                }
                self.sum_squares[channel] += f64::from(*sample) * f64::from(*sample);
                if magnitude >= CLIP_THRESHOLD {
                    self.clipped[channel] = self.clipped[channel].saturating_add(1);
                }
            }
            self.frames += 1;
        }
        self.blocks += 1;
        if self.blocks < METER_INTERVAL_BLOCKS {
            return None;
        }

        let frames = self.frames.max(1) as f64;
        let reading = MeterReading {
            sequence: self.sequence,
            peak_dbfs: self
                .peak
                .iter()
                .map(|peak| to_dbfs(f64::from(*peak)))
                .collect(),
            rms_dbfs: self
                .sum_squares
                .iter()
                .map(|sum| to_dbfs((sum / frames).sqrt()))
                .collect(),
            clipped_samples: self.clipped.clone(),
        };
        self.peak.fill(0.0);
        self.sum_squares.fill(0.0);
        self.clipped.fill(0);
        self.frames = 0;
        self.blocks = 0;
        self.sequence += 1;
        Some(reading)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(channel_count: usize, sample: impl Fn(usize, usize) -> f32) -> CaptureBlock {
        let mut samples = Vec::with_capacity(FRAMES_PER_BLOCK * channel_count);
        for frame in 0..FRAMES_PER_BLOCK {
            for channel in 0..channel_count {
                samples.push(sample(frame, channel));
            }
        }
        CaptureBlock {
            first_frame: 0,
            channel_count,
            samples,
        }
    }

    #[test]
    fn floors_silence_and_rounds_to_a_tenth_of_a_db() {
        assert_eq!(to_dbfs(0.0), LEVEL_FLOOR_DBFS);
        assert_eq!(to_dbfs(1e-9), LEVEL_FLOOR_DBFS);
        assert_eq!(to_dbfs(0.5), -6.0);
        assert_eq!(to_dbfs(1.8), 0.0);
    }

    #[test]
    fn publishes_one_reading_per_fifty_milliseconds_with_per_input_levels() {
        assert_eq!(METER_INTERVAL_MS, 50);
        let mut bank = MeterBank::new(3);
        let mut readings = Vec::new();
        for _ in 0..METER_INTERVAL_BLOCKS * 2 {
            let input = block(3, |frame, channel| match channel {
                0 => {
                    if frame % 2 == 0 {
                        0.5
                    } else {
                        -0.5
                    }
                }
                1 => 0.0,
                _ => {
                    if frame == 0 {
                        -1.0
                    } else {
                        0.1
                    }
                }
            });
            readings.extend(bank.process(&input));
        }

        assert_eq!(readings.len(), 2);
        let first = &readings[0];
        assert_eq!(first.sequence, 0);
        assert_eq!(readings[1].sequence, 1);
        assert_eq!(first.peak_dbfs, vec![-6.0, LEVEL_FLOOR_DBFS, 0.0]);
        assert_eq!(first.rms_dbfs[0], -6.0);
        assert_eq!(first.rms_dbfs[1], LEVEL_FLOOR_DBFS);
        assert_eq!(
            first.clipped_samples,
            vec![0, 0, METER_INTERVAL_BLOCKS as u32]
        );
    }

    #[test]
    fn ignores_a_block_with_a_different_channel_count() {
        let mut bank = MeterBank::new(2);
        for _ in 0..METER_INTERVAL_BLOCKS {
            assert!(bank.process(&block(3, |_, _| 0.5)).is_none());
        }
    }
}
