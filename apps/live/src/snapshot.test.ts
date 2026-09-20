// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { LiveSnapshot } from "@a2-monitor/protocol/live-snapshot";
import { initialChannels } from "./dev-data/channels";
import {
  createHttpSnapshotSource,
  SnapshotContractError,
  SnapshotOfflineError,
} from "./snapshot";

const snapshot: LiveSnapshot = {
  schemaVersion: "0",
  generatedAtUtc: "2026-09-20T00:00:00Z",
  source: { kind: "fabricated", label: "Fabricated test data" },
  show: {
    name: "The Winter Circus",
    venue: "Northgate Playhouse",
    performanceLabel: "Preview 3",
  },
  node: { status: "ready", channelCount: 10, sampleRateHz: 48000 },
  channels: initialChannels,
};

describe("Live snapshot HTTP adapter", () => {
  it("accepts the closed version 0 snapshot shape", async () => {
    const source = createHttpSnapshotSource(async () =>
      Response.json(snapshot),
    );

    await expect(source.load(new AbortController().signal)).resolves.toEqual(
      snapshot,
    );
  });

  it("rejects undeclared response fields", async () => {
    const source = createHttpSnapshotSource(async () =>
      Response.json({ ...snapshot, inventedHealth: "good" }),
    );

    await expect(
      source.load(new AbortController().signal),
    ).rejects.toBeInstanceOf(SnapshotContractError);
  });

  it("classifies a transport failure as offline", async () => {
    const source = createHttpSnapshotSource(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      source.load(new AbortController().signal),
    ).rejects.toBeInstanceOf(SnapshotOfflineError);
  });
});
