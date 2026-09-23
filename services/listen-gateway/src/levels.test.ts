import { parseMeterFrame, type MeterFrame } from "@rvlt/pulse-protocol/http";
import { describe, expect, it } from "vitest";
import { LEVEL_FLOOR_DBFS, LevelBank, type MeterReading } from "./levels.js";

function reading(
  sequence: number,
  peakDbfs: number[],
  rmsDbfs: number[],
  clippedSamples = peakDbfs.map(() => 0),
): MeterReading {
  return { sequence, intervalMs: 50, peakDbfs, rmsDbfs, clippedSamples };
}

describe("LevelBank", () => {
  it("relays each worker reading as a contract-valid meter frame", () => {
    const bank = new LevelBank({ channelCount: 2, now: () => 0 });
    const frames: MeterFrame[] = [];
    bank.on("frame", (frame) => frames.push(parseMeterFrame(frame)));

    bank.ingest(reading(7, [-6, -120], [-9, -120], [3, 0]));

    expect(frames).toEqual([
      {
        schemaVersion: "0",
        sequence: 7,
        intervalMs: 50,
        peakDbfs: [-6, -120],
        rmsDbfs: [-9, -120],
        clipped: [true, false],
      },
    ]);
  });

  it("ignores a reading for a different channel count", () => {
    const bank = new LevelBank({ channelCount: 3, now: () => 0 });
    const frames: MeterFrame[] = [];
    bank.on("frame", (frame) => frames.push(frame));
    bank.ingest(reading(0, [-6, -6], [-9, -9]));
    expect(frames).toHaveLength(0);
    expect(bank.summary()[0]?.peakDbfs).toBeNull();
  });

  it("summarises the trailing window with max peak, power-mean RMS and summed clips", () => {
    let clock = 0;
    const bank = new LevelBank({ channelCount: 2, now: () => clock });

    bank.ingest(reading(0, [-30, -120], [-40, -120], [0, 0]));
    clock = 600;
    bank.ingest(reading(1, [-3, -120], [-6, -120], [2, 0]));
    clock = 1_200;
    bank.ingest(reading(2, [-12, -120], [-6, -120], [1, 0]));

    // The reading at t=0 has left the one-second window.
    expect(bank.summary(1_000)).toEqual([
      { index: 0, peakDbfs: -3, rmsDbfs: -6, clippedSamples: 3 },
      { index: 1, peakDbfs: -120, rmsDbfs: -120, clippedSamples: 0 },
    ]);
  });

  it("reports unknown levels rather than silence once readings stop arriving", () => {
    let clock = 0;
    const bank = new LevelBank({ channelCount: 1, now: () => clock });
    bank.ingest(reading(0, [-20], [-24]));
    clock = 5_000;
    expect(bank.summary()).toEqual([
      { index: 0, peakDbfs: null, rmsDbfs: null, clippedSamples: 0 },
    ]);
    expect(LEVEL_FLOOR_DBFS).toBe(-120);
  });
});
