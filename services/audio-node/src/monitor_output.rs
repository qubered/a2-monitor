//! Host monitor output (ADR 0029): the pieces of `pulse-device-output` that do not touch a
//! device API, so they are testable on every platform.
//!
//! The media worker renders one mono mix per host output session and sends them down a pipe
//! as interleaved 48 kHz frames (one sample per mix). The output process pushes whole frames
//! into a [`frame_ring`] from a reader thread, and the device callback pulls from it and
//! copies each mix onto its own output channels. The callback side never allocates, locks
//! or blocks: an empty ring plays silence and a ring that has drifted too full is skipped
//! forward, and both are counted.

use std::cell::UnsafeCell;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

/// Reserved output device name: accepts and discards the feed without opening a device, so
/// the shared host-output workflow runs in simulation. It is never evidence about hardware.
pub const SIMULATED_OUTPUT_DEVICE_NAME: &str = "Pulse simulated output";
pub const OUTPUT_SAMPLE_RATE_HZ: u32 = 48_000;
/// At most this many device channels may carry one session's mix.
pub const MAX_OUTPUT_CHANNELS: usize = 8;
/// At most this many sessions (mixes) share the output device.
pub const MAX_OUTPUT_ROUTES: usize = 8;
const MAX_OUTPUT_CHANNEL_NUMBER: u16 = 256;

/// Parses a comma-separated list of distinct 1-based device output channel numbers.
pub fn parse_output_channels(value: &str) -> Result<Vec<u16>, String> {
    let mut channels = Vec::new();
    for part in value.split(',') {
        let number = part
            .trim()
            .parse::<u16>()
            .ok()
            .filter(|number| (1..=MAX_OUTPUT_CHANNEL_NUMBER).contains(number))
            .ok_or_else(|| {
                format!(
                    "output channel {part:?} is not a number from 1 to {MAX_OUTPUT_CHANNEL_NUMBER}"
                )
            })?;
        if channels.contains(&number) {
            return Err(format!("output channel {number} is listed twice"));
        }
        channels.push(number);
    }
    if channels.len() > MAX_OUTPUT_CHANNELS {
        return Err(format!(
            "at most {MAX_OUTPUT_CHANNELS} output channels can carry one session"
        ));
    }
    Ok(channels)
}

/// Parses one route per session, separated by `;`, e.g. `1;2,3`: mix 0 plays on output 1
/// and mix 1 on outputs 2 and 3. A device channel can carry only one mix.
pub fn parse_output_routes(value: &str) -> Result<Vec<Vec<u16>>, String> {
    let routes = value
        .split(';')
        .map(parse_output_channels)
        .collect::<Result<Vec<_>, _>>()?;
    if routes.len() > MAX_OUTPUT_ROUTES {
        return Err(format!(
            "at most {MAX_OUTPUT_ROUTES} sessions can share the output device"
        ));
    }
    let mut used = Vec::new();
    for channel in routes.iter().flatten() {
        if used.contains(channel) {
            return Err(format!(
                "output channel {channel} is in more than one session"
            ));
        }
        used.push(*channel);
    }
    Ok(routes)
}

/// Formats routes back into the `1;2,3` form.
pub fn format_output_routes(routes: &[Vec<u16>]) -> String {
    routes
        .iter()
        .map(|route| {
            route
                .iter()
                .map(u16::to_string)
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect::<Vec<_>>()
        .join(";")
}

/// Writes interleaved mixes to a device buffer: every `(mix, channel)` pair copies that
/// mix's sample to that 0-based device channel, and every other channel is silent. Frames
/// beyond `mixes` are silent. Real-time safe.
pub fn route_mixes(
    mixes: &[f32],
    mix_count: usize,
    routes: &[(usize, usize)],
    channel_count: usize,
    output: &mut [f32],
) {
    output.fill(0.0);
    if channel_count == 0 || mix_count == 0 {
        return;
    }
    for (frame, samples) in output
        .chunks_exact_mut(channel_count)
        .zip(mixes.chunks_exact(mix_count))
    {
        for &(mix, channel) in routes {
            if let (Some(slot), Some(sample)) = (frame.get_mut(channel), samples.get(mix)) {
                *slot = *sample;
            }
        }
    }
}

/// Buffering targets in frames. Playback starts (and restarts after an underrun) only once
/// `prime` frames are queued; the consumer skips back to `prime` when more than `ceiling`
/// frames are queued, which bounds latency when the capture clock runs faster than the
/// output clock.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RingTargets {
    pub prime: usize,
    pub ceiling: usize,
}

/// 15 ms primes one and a half 10 ms worker blocks; 60 ms is the most added latency
/// tolerated before skipping. Both are targets, not measurements.
pub const DEFAULT_RING_TARGETS: RingTargets = RingTargets {
    prime: 720,
    ceiling: 2_880,
};

#[derive(Debug, Default)]
pub struct RingCounters {
    /// Device callbacks that found fewer frames than they needed.
    pub underruns: AtomicU64,
    /// Frames skipped because the queue exceeded its ceiling.
    pub skipped_frames: AtomicU64,
    /// Frames the reader could not queue because the ring was full.
    pub overflow_frames: AtomicU64,
}

struct RingStorage {
    samples: Box<[UnsafeCell<f32>]>,
    /// Samples per frame: one per mix.
    width: usize,
    /// Capacity in frames.
    frames: usize,
    /// Frame positions.
    read: AtomicUsize,
    write: AtomicUsize,
    counters: Arc<RingCounters>,
}

// Safety: after `frame_ring` there is exactly one producer and one consumer. Release/acquire
// publication orders sample writes before the consumer reads them, and the producer never
// writes a slot the consumer has not released.
unsafe impl Sync for RingStorage {}

/// Creates a single-producer, single-consumer ring of `width`-sample frames with all
/// storage allocated up front. `capacity` and `targets` are in frames.
pub fn frame_ring(
    capacity: usize,
    width: usize,
    targets: RingTargets,
) -> Result<(RingProducer, RingConsumer, Arc<RingCounters>), &'static str> {
    if capacity == 0 || width == 0 || targets.prime == 0 || targets.ceiling < targets.prime {
        return Err("monitor ring targets are invalid");
    }
    if targets.ceiling >= capacity {
        return Err("monitor ring capacity must exceed its ceiling");
    }
    let sample_count = capacity
        .checked_mul(width)
        .ok_or("monitor ring size overflow")?;
    let mut samples = Vec::new();
    samples
        .try_reserve_exact(sample_count)
        .map_err(|_| "could not allocate the monitor ring")?;
    samples.extend((0..sample_count).map(|_| UnsafeCell::new(0.0)));
    let counters = Arc::new(RingCounters::default());
    let storage = Arc::new(RingStorage {
        samples: samples.into_boxed_slice(),
        width,
        frames: capacity,
        read: AtomicUsize::new(0),
        write: AtomicUsize::new(0),
        counters: Arc::clone(&counters),
    });
    Ok((
        RingProducer {
            storage: Arc::clone(&storage),
        },
        RingConsumer {
            storage,
            targets,
            primed: false,
        },
        counters,
    ))
}

pub struct RingProducer {
    storage: Arc<RingStorage>,
}

impl RingProducer {
    pub fn width(&self) -> usize {
        self.storage.width
    }

    /// Queues as many whole frames as fit and counts the rest as overflow. A trailing
    /// partial frame is ignored; callers push whole frames. Returns the frames queued.
    pub fn push(&mut self, samples: &[f32]) -> usize {
        let storage = &self.storage;
        let width = storage.width;
        let frames = samples.len() / width;
        let read = storage.read.load(Ordering::Acquire);
        let write = storage.write.load(Ordering::Relaxed);
        let free = storage.frames - write.wrapping_sub(read);
        let count = frames.min(free);
        for frame in 0..count {
            let base = (write.wrapping_add(frame) % storage.frames) * width;
            for (offset, sample) in samples[frame * width..(frame + 1) * width]
                .iter()
                .enumerate()
            {
                // Safety: this producer exclusively owns unpublished slots.
                unsafe { *storage.samples[base + offset].get() = *sample };
            }
        }
        storage
            .write
            .store(write.wrapping_add(count), Ordering::Release);
        if frames > count {
            storage
                .counters
                .overflow_frames
                .fetch_add((frames - count) as u64, Ordering::Relaxed);
        }
        count
    }
}

pub struct RingConsumer {
    storage: Arc<RingStorage>,
    targets: RingTargets,
    primed: bool,
}

impl RingConsumer {
    pub fn width(&self) -> usize {
        self.storage.width
    }

    /// Fills `output` (whole interleaved frames) for one device callback. Real-time safe:
    /// no allocation, lock or wait.
    pub fn pull(&mut self, output: &mut [f32]) {
        let storage = &self.storage;
        let width = storage.width;
        let wanted = output.len() / width;
        let write = storage.write.load(Ordering::Acquire);
        let mut read = storage.read.load(Ordering::Relaxed);
        let mut available = write.wrapping_sub(read);

        if available > self.targets.ceiling {
            let skip = available - self.targets.prime;
            read = read.wrapping_add(skip);
            available -= skip;
            storage
                .counters
                .skipped_frames
                .fetch_add(skip as u64, Ordering::Relaxed);
        }
        if !self.primed && available >= self.targets.prime {
            self.primed = true;
        }
        if !self.primed {
            output.fill(0.0);
            storage.read.store(read, Ordering::Release);
            return;
        }

        let count = available.min(wanted);
        for frame in 0..count {
            let base = (read.wrapping_add(frame) % storage.frames) * width;
            for (offset, slot) in output[frame * width..(frame + 1) * width]
                .iter_mut()
                .enumerate()
            {
                // Safety: acquire observed publication; the producer does not reuse this
                // slot until `read` advances past it.
                *slot = unsafe { *storage.samples[base + offset].get() };
            }
        }
        output[count * width..].fill(0.0);
        storage
            .read
            .store(read.wrapping_add(count), Ordering::Release);
        if count < wanted {
            self.primed = false;
            storage.counters.underruns.fetch_add(1, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TARGETS: RingTargets = RingTargets {
        prime: 4,
        ceiling: 8,
    };

    #[test]
    fn output_channels_are_distinct_one_based_numbers() {
        assert_eq!(parse_output_channels("1"), Ok(vec![1]));
        assert_eq!(parse_output_channels("3, 4"), Ok(vec![3, 4]));
        for invalid in ["", "0", "257", "1,1", "a", "1,,2", "1,2,3,4,5,6,7,8,9"] {
            assert!(parse_output_channels(invalid).is_err(), "{invalid:?}");
        }
    }

    #[test]
    fn routes_are_sessions_on_distinct_channels() {
        assert_eq!(parse_output_routes("1"), Ok(vec![vec![1]]));
        assert_eq!(parse_output_routes("1;2,3"), Ok(vec![vec![1], vec![2, 3]]));
        assert_eq!(format_output_routes(&[vec![1], vec![2, 3]]), "1;2,3");
        for invalid in ["", "1;", "1;1", "1,2;2", "1;2;3;4;5;6;7;8;9"] {
            assert!(parse_output_routes(invalid).is_err(), "{invalid:?}");
        }
    }

    #[test]
    fn routes_each_mix_to_its_own_channels_only() {
        let mut output = [9.0; 8];
        // Two frames of two mixes onto a four-channel device: mix 0 → ch 0, mix 1 → ch 2, 3.
        route_mixes(
            &[0.5, -0.5, 0.25, -0.25],
            2,
            &[(0, 0), (1, 2), (1, 3)],
            4,
            &mut output,
        );
        assert_eq!(output, [0.5, 0.0, -0.5, -0.5, 0.25, 0.0, -0.25, -0.25]);
        route_mixes(&[0.5, -0.5], 2, &[(0, 1)], 4, &mut output);
        assert_eq!(output, [0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn waits_for_the_prime_target_before_playing() {
        let (mut producer, mut consumer, counters) = frame_ring(16, 1, TARGETS).unwrap();
        let mut output = [1.0; 2];
        producer.push(&[0.1, 0.2, 0.3]);
        consumer.pull(&mut output);
        assert_eq!(output, [0.0, 0.0]);
        producer.push(&[0.4]);
        consumer.pull(&mut output);
        assert_eq!(output, [0.1, 0.2]);
        assert_eq!(counters.underruns.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn keeps_interleaved_frames_together() {
        let (mut producer, mut consumer, _counters) = frame_ring(16, 2, TARGETS).unwrap();
        let samples: Vec<f32> = (0..8).map(|value| value as f32).collect();
        assert_eq!(producer.push(&samples), 4);
        let mut output = [0.0; 6];
        consumer.pull(&mut output);
        assert_eq!(output, [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]);
    }

    #[test]
    fn counts_an_underrun_and_reprimes() {
        let (mut producer, mut consumer, counters) = frame_ring(16, 1, TARGETS).unwrap();
        producer.push(&[0.1, 0.2, 0.3, 0.4]);
        let mut output = [1.0; 3];
        consumer.pull(&mut output);
        consumer.pull(&mut output);
        assert_eq!(output, [0.4, 0.0, 0.0]);
        assert_eq!(counters.underruns.load(Ordering::Relaxed), 1);
        producer.push(&[0.5]);
        consumer.pull(&mut output);
        assert_eq!(output, [0.0, 0.0, 0.0], "re-primes before playing again");
    }

    #[test]
    fn skips_back_to_prime_when_too_much_is_queued() {
        let (mut producer, mut consumer, counters) = frame_ring(16, 1, TARGETS).unwrap();
        let samples: Vec<f32> = (0..10).map(|value| value as f32).collect();
        producer.push(&samples);
        let mut output = [0.0; 2];
        consumer.pull(&mut output);
        assert_eq!(output, [6.0, 7.0], "keeps the newest `prime` frames");
        assert_eq!(counters.skipped_frames.load(Ordering::Relaxed), 6);
    }

    #[test]
    fn a_full_ring_drops_and_counts_the_excess() {
        let (mut producer, _consumer, counters) = frame_ring(10, 1, TARGETS).unwrap();
        assert_eq!(producer.push(&[0.0; 12]), 10);
        assert_eq!(counters.overflow_frames.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn rejects_inconsistent_targets() {
        assert!(frame_ring(8, 1, TARGETS).is_err());
        assert!(frame_ring(16, 0, TARGETS).is_err());
        assert!(
            frame_ring(
                16,
                1,
                RingTargets {
                    prime: 0,
                    ceiling: 4
                }
            )
            .is_err()
        );
    }
}
