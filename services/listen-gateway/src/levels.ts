import { EventEmitter } from "node:events";
import type { MeterFrame, NodeLevels } from "@rvlt/pulse-protocol/http";
import type { CaptureAudioChunk } from "./capture.js";

/** Meter frames are published at this cadence; the card trace and the player read them directly. */
export const METER_INTERVAL_MS = 50;
/** The backend's alert evaluation reads the trailing summary over this window. */
export const LEVEL_WINDOW_MS = 1000;
/** Digital silence is reported as this floor rather than -Infinity. */
export const LEVEL_FLOOR_DBFS = -120;
/** A sample at or above this magnitude counts as clipped (about -0.01 dBFS). */
export const CLIP_THRESHOLD = 0.999;

const RETAINED_INTERVALS = Math.ceil((LEVEL_WINDOW_MS * 2) / METER_INTERVAL_MS);

type Interval = {
  atMs: number;
  frames: number;
  peak: Float32Array;
  sumSquares: Float64Array;
  clipped: Uint32Array;
};

export type LevelMeterOptions = {
  sampleRateHz: number;
  channelCount: number;
  intervalMs?: number;
  now?: () => number;
};

export function toDbfs(linear: number): number {
  if (!(linear > 0)) return LEVEL_FLOOR_DBFS;
  const dbfs = 20 * Math.log10(linear);
  return Math.round(Math.min(0, Math.max(LEVEL_FLOOR_DBFS, dbfs)) * 10) / 10;
}

function rmsDbfs(sumSquares: number, frames: number): number {
  if (frames === 0) return LEVEL_FLOOR_DBFS;
  return toDbfs(Math.sqrt(sumSquares / frames));
}

/** Copies to an aligned buffer only when the capture chunk is not already 4-byte aligned. */
function samplesOf(chunk: CaptureAudioChunk): Float32Array {
  const bytes = chunk.interleaved;
  const length = chunk.frameCount * chunk.channelCount;
  if (bytes.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0) {
    return new Float32Array(bytes.buffer, bytes.byteOffset, length);
  }
  const aligned = new Uint8Array(length * Float32Array.BYTES_PER_ELEMENT);
  aligned.set(bytes.subarray(0, aligned.byteLength));
  return new Float32Array(aligned.buffer);
}

/**
 * Per-input peak, RMS and clip metering over the captured stream. It runs in
 * the gateway process on bytes already drained from the capture queue — never
 * on the real-time callback — and keeps a fixed number of intervals so memory
 * does not grow with uptime.
 */
export class LevelMeter extends EventEmitter<{ frame: [MeterFrame] }> {
  readonly channelCount: number;
  private readonly framesPerInterval: number;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly retained: Interval[] = [];
  private current: Interval;
  private sequence = 0;

  constructor(options: LevelMeterOptions) {
    super();
    this.channelCount = options.channelCount;
    this.intervalMs = options.intervalMs ?? METER_INTERVAL_MS;
    this.framesPerInterval = Math.max(
      1,
      Math.round((options.sampleRateHz * this.intervalMs) / 1000),
    );
    this.now = options.now ?? Date.now;
    this.current = this.emptyInterval();
  }

  process(chunk: CaptureAudioChunk): void {
    if (chunk.channelCount !== this.channelCount) return;
    const samples = samplesOf(chunk);
    const channels = this.channelCount;
    let frame = 0;
    while (frame < chunk.frameCount) {
      const take = Math.min(
        chunk.frameCount - frame,
        this.framesPerInterval - this.current.frames,
      );
      const { peak, sumSquares, clipped } = this.current;
      for (let channel = 0; channel < channels; channel += 1) {
        let channelPeak = peak[channel]!;
        let channelSum = 0;
        let channelClipped = 0;
        for (
          let index = frame * channels + channel,
            end = (frame + take) * channels;
          index < end;
          index += channels
        ) {
          const sample = samples[index]!;
          const magnitude = sample < 0 ? -sample : sample;
          if (magnitude > channelPeak) channelPeak = magnitude;
          channelSum += sample * sample;
          if (magnitude >= CLIP_THRESHOLD) channelClipped += 1;
        }
        peak[channel] = channelPeak;
        sumSquares[channel]! += channelSum;
        clipped[channel]! += channelClipped;
      }
      this.current.frames += take;
      frame += take;
      if (this.current.frames >= this.framesPerInterval) this.closeInterval();
    }
  }

  /** Aggregates the retained intervals that closed inside the trailing window. */
  summary(windowMs = LEVEL_WINDOW_MS): NodeLevels["inputs"] {
    const since = this.now() - windowMs;
    const recent = this.retained.filter(({ atMs }) => atMs > since);
    return Array.from({ length: this.channelCount }, (_, index) => {
      if (recent.length === 0) {
        return { index, peakDbfs: null, rmsDbfs: null, clippedSamples: 0 };
      }
      let peak = 0;
      let sumSquares = 0;
      let frames = 0;
      let clippedSamples = 0;
      for (const interval of recent) {
        if (interval.peak[index]! > peak) peak = interval.peak[index]!;
        sumSquares += interval.sumSquares[index]!;
        frames += interval.frames;
        clippedSamples += interval.clipped[index]!;
      }
      return {
        index,
        peakDbfs: toDbfs(peak),
        rmsDbfs: rmsDbfs(sumSquares, frames),
        clippedSamples: Math.min(clippedSamples, 10_000_000),
      };
    });
  }

  private emptyInterval(): Interval {
    return {
      atMs: 0,
      frames: 0,
      peak: new Float32Array(this.channelCount),
      sumSquares: new Float64Array(this.channelCount),
      clipped: new Uint32Array(this.channelCount),
    };
  }

  private closeInterval(): void {
    const closed = this.current;
    closed.atMs = this.now();
    this.retained.push(closed);
    if (this.retained.length > RETAINED_INTERVALS) this.retained.shift();
    this.current = this.emptyInterval();

    const peakDbfs: number[] = [];
    const rms: number[] = [];
    const clipped: boolean[] = [];
    for (let channel = 0; channel < this.channelCount; channel += 1) {
      peakDbfs.push(toDbfs(closed.peak[channel]!));
      rms.push(rmsDbfs(closed.sumSquares[channel]!, closed.frames));
      clipped.push(closed.clipped[channel]! > 0);
    }
    this.emit("frame", {
      schemaVersion: "0",
      sequence: this.sequence,
      intervalMs: this.intervalMs,
      peakDbfs,
      rmsDbfs: rms,
      clipped,
    });
    this.sequence += 1;
  }
}
