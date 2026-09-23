//! Built-in development test signal for `pulse-device-capture` (ADR 0027).
//!
//! The reserved device name [`TEST_SIGNAL_DEVICE_NAME`] selects this generator instead of a
//! physical input. It is never matched against a real device list, so a real interface
//! cannot be opened by accident, and the gateway always reports it as simulated. The
//! signal is deterministic: every run produces the same samples.

use std::f64::consts::TAU;

pub const TEST_SIGNAL_DEVICE_NAME: &str = "Pulse test signal";
pub const DEFAULT_TEST_SIGNAL_CHANNELS: usize = 8;
pub const MAX_TEST_SIGNAL_CHANNELS: usize = 64;
pub const TEST_SIGNAL_SAMPLE_RATE_HZ: u32 = 48_000;

/// Parses `A2_SIMULATED_CHANNELS`; unset means the default eight inputs.
pub fn channel_count_from(value: Option<&str>) -> Result<usize, String> {
    let Some(value) = value else {
        return Ok(DEFAULT_TEST_SIGNAL_CHANNELS);
    };
    value
        .parse::<usize>()
        .ok()
        .filter(|count| (1..=MAX_TEST_SIGNAL_CHANNELS).contains(count))
        .ok_or_else(|| {
            format!("A2_SIMULATED_CHANNELS must be an integer from 1 to {MAX_TEST_SIGNAL_CHANNELS}")
        })
}

/// Deterministic xorshift noise in -1..=1.
struct Noise(u32);

impl Noise {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        (f64::from(self.0) / f64::from(u32::MAX)) * 2.0 - 1.0
    }
}

fn db_to_linear(db: f64) -> f64 {
    10_f64.powf(db / 20.0)
}

/// Speech-like programme: band-limited noise under a syllabic envelope with phrase pauses.
struct Speech {
    amplitude: f64,
    phrase_seconds: f64,
    pause_seconds: f64,
    phase: f64,
    lowpass: f64,
}

impl Speech {
    fn new(level_db: f64, phrase_seconds: f64, pause_seconds: f64, phase: f64) -> Self {
        Self {
            amplitude: db_to_linear(level_db),
            phrase_seconds,
            pause_seconds,
            phase,
            lowpass: 0.0,
        }
    }

    fn sample(&mut self, time: f64, noise: &mut Noise) -> f64 {
        let cycle = self.phrase_seconds + self.pause_seconds;
        let position = (time + self.phase) % cycle;
        self.lowpass += 0.18 * (noise.next() - self.lowpass);
        if position > self.phrase_seconds {
            return self.lowpass * db_to_linear(-62.0) * 3.0;
        }
        let syllable = 0.55 + 0.45 * (TAU * 4.6 * (time + self.phase)).sin();
        let fade = (position * 8.0)
            .min((self.phrase_seconds - position) * 8.0)
            .min(1.0);
        self.lowpass * self.amplitude * 3.0 * syllable * fade
    }
}

enum Program {
    Speech(Speech),
    Tone {
        amplitude: f64,
        frequency_hz: f64,
    },
    RoomNoise {
        amplitude: f64,
    },
    /// Sings normally, then drives into full scale for one second every twenty.
    Clipping(Speech),
    DigitalSilence,
    /// Talks for twenty seconds, then drops out for forty: a failing cable or pack.
    Dropout(Speech),
}

impl Program {
    fn for_channel(channel: usize) -> Self {
        match channel {
            0 => Self::Speech(Speech::new(-12.0, 3.0, 1.4, 0.0)),
            1 => Self::Speech(Speech::new(-20.0, 2.2, 2.6, 0.9)),
            2 => Self::Tone {
                amplitude: db_to_linear(-18.0),
                frequency_hz: 1_000.0,
            },
            3 => Self::Speech(Speech::new(-9.0, 5.0, 0.6, 2.2)),
            4 => Self::RoomNoise {
                amplitude: db_to_linear(-64.0),
            },
            5 => Self::Clipping(Speech::new(-14.0, 4.0, 1.0, 0.7)),
            6 => Self::DigitalSilence,
            7 => Self::Dropout(Speech::new(-16.0, 2.5, 0.8, 1.9)),
            _ => {
                let step = channel as f64;
                Self::Speech(Speech::new(
                    -14.0 - (channel % 5) as f64 * 3.0,
                    2.0 + (channel % 3) as f64,
                    1.0 + (channel % 4) as f64,
                    step * 0.37,
                ))
            }
        }
    }

    fn sample(&mut self, time: f64, noise: &mut Noise) -> f64 {
        match self {
            Self::Speech(voice) => voice.sample(time, noise),
            Self::Tone {
                amplitude,
                frequency_hz,
            } => *amplitude * (TAU * *frequency_hz * time).sin(),
            Self::RoomNoise { amplitude } => noise.next() * *amplitude,
            Self::Clipping(voice) => {
                let gain = if time % 20.0 > 19.0 { 9.0 } else { 1.0 };
                (voice.sample(time, noise) * gain).clamp(-1.0, 1.0)
            }
            Self::DigitalSilence => 0.0,
            Self::Dropout(voice) => {
                if time % 60.0 < 20.0 {
                    voice.sample(time, noise)
                } else {
                    0.0
                }
            }
        }
    }
}

/// Generates interleaved 48 kHz frames for every simulated input.
pub struct TestSignal {
    programs: Vec<Program>,
    noises: Vec<Noise>,
    next_frame: u64,
}

impl TestSignal {
    pub fn new(channel_count: usize) -> Self {
        Self {
            programs: (0..channel_count).map(Program::for_channel).collect(),
            noises: (0..channel_count)
                .map(|channel| {
                    let seed = 0x9e37_79b9_u32.wrapping_add((channel as u32).wrapping_mul(7_919));
                    Noise(seed.max(1))
                })
                .collect(),
            next_frame: 0,
        }
    }

    pub fn channel_count(&self) -> usize {
        self.programs.len()
    }

    /// Fills `output` with whole interleaved frames; a trailing partial frame is left untouched.
    pub fn fill(&mut self, output: &mut [f32]) -> usize {
        let channels = self.programs.len();
        let frames = output.len() / channels;
        for frame in output.chunks_exact_mut(channels).take(frames) {
            let time = self.next_frame as f64 / f64::from(TEST_SIGNAL_SAMPLE_RATE_HZ);
            for ((sample, program), noise) in frame
                .iter_mut()
                .zip(&mut self.programs)
                .zip(&mut self.noises)
            {
                *sample = program.sample(time, noise) as f32;
            }
            self.next_frame += 1;
        }
        frames
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peak_and_rms(signal: &mut TestSignal, seconds: f64) -> Vec<(f32, f32)> {
        let channels = signal.channel_count();
        let frames = (seconds * f64::from(TEST_SIGNAL_SAMPLE_RATE_HZ)) as usize;
        let mut samples = vec![0.0_f32; frames * channels];
        signal.fill(&mut samples);
        (0..channels)
            .map(|channel| {
                let mut peak = 0.0_f32;
                let mut sum = 0.0_f64;
                for frame in samples.chunks_exact(channels) {
                    peak = peak.max(frame[channel].abs());
                    sum += f64::from(frame[channel]).powi(2);
                }
                (peak, (sum / frames as f64).sqrt() as f32)
            })
            .collect()
    }

    #[test]
    fn channel_count_defaults_to_eight_and_is_bounded() {
        assert_eq!(channel_count_from(None), Ok(8));
        assert_eq!(channel_count_from(Some("16")), Ok(16));
        assert!(channel_count_from(Some("0")).is_err());
        assert!(channel_count_from(Some("65")).is_err());
        assert!(channel_count_from(Some("eight")).is_err());
    }

    #[test]
    fn programmes_cover_speech_tone_noise_clipping_silence_and_dropout() {
        let mut signal = TestSignal::new(8);
        let levels = peak_and_rms(&mut signal, 2.0);
        // A -18 dBFS sine peaks at 0.126.
        assert!((levels[2].0 - 0.126).abs() < 0.002, "{:?}", levels[2]);
        // Room noise stays near -64 dBFS.
        assert!(levels[4].0 < 0.001 && levels[4].1 > 0.0, "{:?}", levels[4]);
        // Digital silence is exactly zero.
        assert_eq!(levels[6], (0.0, 0.0));
        // Speech and the dropout channel are audible before the dropout begins.
        assert!(levels[0].1 > 0.01 && levels[7].1 > 0.001);
        for (peak, _) in &levels {
            assert!(*peak <= 1.0);
        }
    }

    #[test]
    fn clipping_input_reaches_full_scale_once_every_twenty_seconds() {
        let mut signal = TestSignal::new(8);
        let calm = peak_and_rms(&mut signal, 19.0);
        assert!(calm[5].0 < 0.999, "{:?}", calm[5]);
        let hot = peak_and_rms(&mut signal, 1.0);
        assert!(hot[5].0 >= 0.999, "{:?}", hot[5]);
    }

    #[test]
    fn dropout_input_goes_silent_after_twenty_seconds() {
        let mut signal = TestSignal::new(8);
        let _ = peak_and_rms(&mut signal, 20.0);
        let dropped = peak_and_rms(&mut signal, 1.0);
        assert_eq!(dropped[7], (0.0, 0.0));
    }

    #[test]
    fn output_is_deterministic() {
        let mut first = TestSignal::new(3);
        let mut second = TestSignal::new(3);
        let mut a = vec![0.0; 3 * 480];
        let mut b = vec![0.0; 3 * 480];
        first.fill(&mut a);
        second.fill(&mut b);
        assert_eq!(a, b);
    }
}
