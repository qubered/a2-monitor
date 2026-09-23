import { Buffer } from "node:buffer";
import { PassThrough } from "node:stream";
import type { CaptureProcess } from "./capture.js";

/**
 * Reserved device name that selects the built-in test signal instead of a
 * physical input. It is never matched against a real device list, so a real
 * interface cannot be opened by accident and the simulated source is always
 * reported as simulated.
 */
export const SIMULATED_DEVICE_NAME = "Pulse test signal";
export const DEFAULT_SIMULATED_CHANNELS = 8;

const SAMPLE_RATE_HZ = 48_000;
const TICK_MS = 10;
const MAX_FRAMES_PER_TICK = SAMPLE_RATE_HZ / 10;

/** Deterministic xorshift noise so the signal is the same on every run. */
function createNoise(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0xffffffff) * 2 - 1;
  };
}

function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

type ChannelProgram = (timeSeconds: number, noise: () => number) => number;

/** Speech-like programme: band-limited noise under a syllabic envelope with phrase pauses. */
function speech(
  levelDb: number,
  phraseSeconds: number,
  pauseSeconds: number,
  phase: number,
): ChannelProgram {
  const amplitude = dbToLinear(levelDb);
  let lowpass = 0;
  return (time, noise) => {
    const cycle = phraseSeconds + pauseSeconds;
    const position = (time + phase) % cycle;
    lowpass += 0.18 * (noise() - lowpass);
    if (position > phraseSeconds) return lowpass * dbToLinear(-62) * 3;
    const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4.6 * (time + phase));
    const fade = Math.min(1, position * 8, (phraseSeconds - position) * 8);
    return lowpass * amplitude * 3 * syllable * fade;
  };
}

function tone(levelDb: number, frequencyHz: number): ChannelProgram {
  const amplitude = dbToLinear(levelDb);
  return (time) => amplitude * Math.sin(2 * Math.PI * frequencyHz * time);
}

function roomNoise(levelDb: number): ChannelProgram {
  const amplitude = dbToLinear(levelDb);
  return (_time, noise) => noise() * amplitude;
}

/** Sings normally, then drives into full scale for one second every twenty. */
function clipping(): ChannelProgram {
  const voice = speech(-14, 4, 1, 0.7);
  return (time, noise) => {
    const hot = time % 20 > 19;
    const sample = voice(time, noise) * (hot ? 9 : 1);
    return Math.max(-1, Math.min(1, sample));
  };
}

/** Talks for twenty seconds, then drops out for forty — a failing cable or pack. */
function dropout(): ChannelProgram {
  const voice = speech(-16, 2.5, 0.8, 1.9);
  return (time, noise) => (time % 60 < 20 ? voice(time, noise) : 0);
}

const PROGRAMS: ChannelProgram[] = [
  speech(-12, 3, 1.4, 0),
  speech(-20, 2.2, 2.6, 0.9),
  tone(-18, 1_000),
  speech(-9, 5, 0.6, 2.2),
  roomNoise(-64),
  clipping(),
  () => 0,
  dropout(),
];

function programFor(channel: number): ChannelProgram {
  if (channel < PROGRAMS.length) return PROGRAMS[channel]!;
  return speech(
    -14 - (channel % 5) * 3,
    2 + (channel % 3),
    1 + (channel % 4),
    channel * 0.37,
  );
}

/**
 * A capture process double that speaks the same stdout protocol as
 * `pulse-device-capture`: one JSON header line, then interleaved Float32LE
 * frames at the device rate. It exists so the full metering, alerting and
 * listening path can run without an audio interface.
 */
export function createSimulatedCaptureProcess(
  channelCount = DEFAULT_SIMULATED_CHANNELS,
): CaptureProcess {
  const stdout = new PassThrough();
  const programs = Array.from({ length: channelCount }, (_, channel) =>
    programFor(channel),
  );
  const noises = Array.from({ length: channelCount }, (_, channel) =>
    createNoise(0x9e3779b9 + channel * 7919),
  );
  const exitListeners: Array<
    (code: number | null, signal: NodeJS.Signals | null) => void
  > = [];
  const startedAt = performance.now();
  let emittedFrames = 0;
  let stopped = false;

  stdout.write(
    `${JSON.stringify({
      schemaVersion: 0,
      deviceName: SIMULATED_DEVICE_NAME,
      sampleRateHz: SAMPLE_RATE_HZ,
      channelCount,
    })}\n`,
  );

  const timer = setInterval(() => {
    const dueFrames = Math.floor(
      ((performance.now() - startedAt) / 1000) * SAMPLE_RATE_HZ,
    );
    const frames = Math.min(MAX_FRAMES_PER_TICK, dueFrames - emittedFrames);
    if (frames <= 0) return;
    const block = Buffer.allocUnsafe(
      frames * channelCount * Float32Array.BYTES_PER_ELEMENT,
    );
    for (let frame = 0; frame < frames; frame += 1) {
      const time = (emittedFrames + frame) / SAMPLE_RATE_HZ;
      for (let channel = 0; channel < channelCount; channel += 1) {
        block.writeFloatLE(
          programs[channel]!(time, noises[channel]!),
          (frame * channelCount + channel) * Float32Array.BYTES_PER_ELEMENT,
        );
      }
    }
    emittedFrames += frames;
    stdout.write(block);
  }, TICK_MS);

  return {
    stdout,
    onError: () => undefined,
    onExit: (listener) => exitListeners.push(listener),
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      stdout.end();
      for (const listener of exitListeners) listener(null, "SIGTERM");
    },
  };
}
