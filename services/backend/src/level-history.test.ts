import { describe, expect, it } from "vitest";
import type { LiveStateChannel } from "@rvlt/pulse-protocol/http";
import { DEFAULT_ALERT_POLICY } from "./alert-policy.js";
import { LevelHistoryStore, sampleOf } from "./level-history.js";
import { evaluate } from "./live-model.js";
import {
  levelsWith,
  observationAt,
  showfileWith,
  telemetryWith,
} from "./monitoring.test-support.js";

const T0 = Date.parse("2026-09-23T01:00:00Z");

function channelsAt(
  nowMs: number,
  peak: number | null,
  telemetry = telemetryWith([{}]),
): LiveStateChannel[] {
  return evaluate({
    showfile: showfileWith(),
    policy: DEFAULT_ALERT_POLICY,
    observation: observationAt(nowMs, levelsWith([peak, -30]), telemetry),
    trackers: new Map(),
    nowMs,
  }).channels;
}

describe("sampleOf", () => {
  it("records observed audio, RF, link quality and battery for a wireless channel", () => {
    const [wireless] = channelsAt(T0, -12.5);
    expect(sampleOf(wireless!, "2026-09-23T01:00:00.000Z")).toEqual({
      atUtc: "2026-09-23T01:00:00.000Z",
      audioDbfs: -12.5,
      rfLevelDbm: -58,
      linkQualityPercent: 100,
      batteryPercent: 90,
      availability: "observed",
    });
  });

  it("keeps a wired channel's RF and battery samples null", () => {
    const [, wired] = channelsAt(T0, -12.5);
    expect(sampleOf(wired!, "2026-09-23T01:00:00.000Z")).toMatchObject({
      audioDbfs: -30,
      rfLevelDbm: null,
      batteryPercent: null,
      availability: "observed",
    });
  });

  it("does not write stale receiver values forward as new measurements", () => {
    const [wireless] = channelsAt(
      T0,
      null,
      telemetryWith([{ availability: "stale" }], { status: "stale" }),
    );
    expect(sampleOf(wireless!, "2026-09-23T01:00:00.000Z")).toMatchObject({
      audioDbfs: null,
      rfLevelDbm: null,
      batteryPercent: null,
      availability: "stale",
    });
  });
});

describe("LevelHistoryStore", () => {
  it("returns no samples for a channel it has never recorded", () => {
    expect(new LevelHistoryStore().getWindow("ch-marguerite", 60_000)).toEqual(
      [],
    );
  });

  it("records one sample per interval however often it is called, bounded by capacity", () => {
    const store = new LevelHistoryStore({
      intervalMs: 1_000,
      capacityMs: 3_000,
    });
    store.record(T0, channelsAt(T0, -12));
    store.record(T0 + 200, channelsAt(T0 + 200, -11));
    for (let second = 1; second <= 5; second += 1) {
      store.record(
        T0 + second * 1000,
        channelsAt(T0 + second * 1000, -12 - second),
      );
    }
    const samples = store.getWindow("ch-marguerite", 60_000);
    expect(samples.map(({ audioDbfs }) => audioDbfs)).toEqual([-15, -16, -17]);
    expect(store.getWindow("ch-marguerite", 1_000)).toHaveLength(1);
  });

  it("drops history for channels no longer in the show", () => {
    const store = new LevelHistoryStore();
    store.record(T0, channelsAt(T0, -12));
    expect(store.has("ch-talkback")).toBe(true);
    store.record(T0 + 1_000, channelsAt(T0 + 1_000, -12).slice(0, 1));
    expect(store.has("ch-talkback")).toBe(false);
  });
});
