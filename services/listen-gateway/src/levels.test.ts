import { Buffer } from "node:buffer";
import { parseMeterFrame, type MeterFrame } from "@rvlt/pulse-protocol/http";
import { describe, expect, it } from "vitest";
import { LEVEL_FLOOR_DBFS, LevelMeter, toDbfs } from "./levels.js";

function chunkOf(frames: number[][], byteOffset = 0) {
  const channelCount = frames[0]!.length;
  const bytes = Buffer.alloc(byteOffset + frames.length * channelCount * 4);
  frames.forEach((frame, frameIndex) =>
    frame.forEach((sample, channel) =>
      bytes.writeFloatLE(
        sample,
        byteOffset + (frameIndex * channelCount + channel) * 4,
      ),
    ),
  );
  return {
    interleaved: bytes.subarray(byteOffset),
    frameCount: frames.length,
    channelCount,
  };
}

describe("toDbfs", () => {
  it("floors digital silence instead of reporting -Infinity", () => {
    expect(toDbfs(0)).toBe(LEVEL_FLOOR_DBFS);
    expect(toDbfs(1e-9)).toBe(LEVEL_FLOOR_DBFS);
  });

  it("rounds to a tenth of a dB and never exceeds full scale", () => {
    expect(toDbfs(0.5)).toBe(-6);
    expect(toDbfs(1.8)).toBe(0);
  });
});

describe("LevelMeter", () => {
  it("publishes one contract-valid frame per interval with per-input peak, RMS and clipping", () => {
    let clock = 1_000;
    const meter = new LevelMeter({
      sampleRateHz: 400,
      channelCount: 3,
      intervalMs: 10,
      now: () => clock,
    });
    const frames: MeterFrame[] = [];
    meter.on("frame", (frame) => frames.push(parseMeterFrame(frame)));

    meter.process(
      chunkOf([
        [0.5, 0, 1],
        [-0.5, 0, -1],
        [0.5, 0, 0.2],
        [-0.5, 0, 0.2],
        [0.1, 0, 0],
      ]),
    );

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      schemaVersion: "0",
      sequence: 0,
      intervalMs: 10,
      peakDbfs: [-6, LEVEL_FLOOR_DBFS, 0],
      rmsDbfs: [-6, LEVEL_FLOOR_DBFS, toDbfs(Math.sqrt((1 + 1 + 0.08) / 4))],
      clipped: [false, false, true],
    });

    clock += 10;
    meter.process(
      chunkOf([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
    );
    expect(frames).toHaveLength(2);
    expect(frames[1]?.sequence).toBe(1);
    expect(frames[1]?.peakDbfs[0]).toBe(-20);
  });

  it("summarises only intervals that closed inside the trailing window", () => {
    let clock = 0;
    const meter = new LevelMeter({
      sampleRateHz: 1_000,
      channelCount: 1,
      intervalMs: 2,
      now: () => clock,
    });
    expect(meter.summary(1_000)).toEqual([
      { index: 0, peakDbfs: null, rmsDbfs: null, clippedSamples: 0 },
    ]);

    meter.process(chunkOf([[1], [1]]));
    clock = 1_500;
    meter.process(chunkOf([[0.25], [-0.25]]));

    expect(meter.summary(1_000)).toEqual([
      { index: 0, peakDbfs: -12, rmsDbfs: -12, clippedSamples: 0 },
    ]);
    clock = 3_000;
    expect(meter.summary(1_000)[0]?.peakDbfs).toBeNull();
  });

  it("reads capture chunks that are not four-byte aligned", () => {
    const meter = new LevelMeter({
      sampleRateHz: 1_000,
      channelCount: 2,
      intervalMs: 1,
    });
    const frames: MeterFrame[] = [];
    meter.on("frame", (frame) => frames.push(frame));
    meter.process(chunkOf([[0.5, -0.25]], 1));
    expect(frames[0]?.peakDbfs).toEqual([-6, -12]);
  });

  it("ignores chunks from a device with a different channel count", () => {
    const meter = new LevelMeter({
      sampleRateHz: 1_000,
      channelCount: 2,
      intervalMs: 1,
    });
    const frames: MeterFrame[] = [];
    meter.on("frame", (frame) => frames.push(frame));
    meter.process(chunkOf([[0.5, 0.5, 0.5]]));
    expect(frames).toHaveLength(0);
  });
});
