import { EventEmitter } from "node:events";
import type { MeterFrame, NodeLevels } from "@rvlt/pulse-protocol/http";

/** The backend's alert evaluation reads the trailing summary over this window. */
export const LEVEL_WINDOW_MS = 1000;
/** Digital silence is reported as this floor rather than -Infinity. */
export const LEVEL_FLOOR_DBFS = -120;
/** Readings retained for the summary; twice the window at the worker's 20 Hz cadence. */
const RETAINED_READINGS = 40;
const MAX_CLIPPED_SAMPLES = 10_000_000;

/** One closed interval measured by `pulse-media-worker`, one value per captured input. */
export type MeterReading = {
  sequence: number;
  intervalMs: number;
  peakDbfs: number[];
  rmsDbfs: number[];
  clippedSamples: number[];
};

type Retained = MeterReading & { atMs: number };

export type LevelBankOptions = {
  channelCount: number;
  now?: () => number;
};

function round(dbfs: number): number {
  return Math.round(Math.min(0, Math.max(LEVEL_FLOOR_DBFS, dbfs)) * 10) / 10;
}

/**
 * Holds the worker's recent meter readings for one capture. The worker meters
 * outside the capture callback (ADR 0027); this only relays the 20 Hz frames
 * and aggregates the trailing window the backend evaluates alerts from.
 * Memory is bounded by a fixed number of readings.
 */
export class LevelBank extends EventEmitter<{ frame: [MeterFrame] }> {
  readonly channelCount: number;
  private readonly now: () => number;
  private readonly retained: Retained[] = [];

  constructor(options: LevelBankOptions) {
    super();
    this.channelCount = options.channelCount;
    this.now = options.now ?? Date.now;
  }

  ingest(reading: MeterReading): void {
    if (reading.peakDbfs.length !== this.channelCount) return;
    this.retained.push({ ...reading, atMs: this.now() });
    if (this.retained.length > RETAINED_READINGS) this.retained.shift();
    this.emit("frame", {
      schemaVersion: "0",
      sequence: reading.sequence,
      intervalMs: reading.intervalMs,
      peakDbfs: reading.peakDbfs,
      rmsDbfs: reading.rmsDbfs,
      clipped: reading.clippedSamples.map((count) => count > 0),
    });
  }

  /**
   * Aggregates readings received inside the trailing window. RMS is the power
   * mean of equal-length intervals; an input with no reading in the window is
   * unknown (null), never silent.
   */
  summary(windowMs = LEVEL_WINDOW_MS): NodeLevels["inputs"] {
    const since = this.now() - windowMs;
    const recent = this.retained.filter(({ atMs }) => atMs > since);
    return Array.from({ length: this.channelCount }, (_, index) => {
      if (recent.length === 0) {
        return { index, peakDbfs: null, rmsDbfs: null, clippedSamples: 0 };
      }
      let peak = LEVEL_FLOOR_DBFS;
      let power = 0;
      let clippedSamples = 0;
      for (const reading of recent) {
        peak = Math.max(peak, reading.peakDbfs[index]!);
        power += 10 ** (reading.rmsDbfs[index]! / 10);
        clippedSamples += reading.clippedSamples[index]!;
      }
      const meanPower = power / recent.length;
      return {
        index,
        peakDbfs: round(peak),
        rmsDbfs: round(
          meanPower > 0 ? 10 * Math.log10(meanPower) : LEVEL_FLOOR_DBFS,
        ),
        clippedSamples: Math.min(clippedSamples, MAX_CLIPPED_SAMPLES),
      };
    });
  }
}
