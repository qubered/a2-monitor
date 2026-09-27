import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseLiveState,
  parseLiveStateDelta,
  ProtocolContractError,
} from "../generated/http-contracts";
import { applyLiveStateDelta, diffLiveState } from "../delta/live-state-delta";

async function fixture(): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL(
        "../fixtures/v0/http/current/live-state.valid.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

const base = {
  schemaVersion: "0",
  sequence: 8,
  baseSequence: 7,
  generatedAtUtc: "2026-09-27T10:00:01.000Z",
};

describe("LiveStateDelta (derived from the live state contract)", () => {
  it("accepts changed sections and channel patches that name only what changed", () => {
    const delta = parseLiveStateDelta({
      ...base,
      summary: {
        active: 1,
        outstanding: 1,
        outstandingCritical: 0,
      },
      channels: [
        {
          id: "ch-1",
          rf: {
            availability: "observed",
            levelDbm: -61,
            linkQualityPercent: 100,
            activeAntenna: "A",
            interference: "none",
            transmitterPresent: true,
          },
        },
      ],
    });
    expect(delta.channels?.[0]?.id).toBe("ch-1");
  });

  it("rejects a patch without an id, an unknown field, and a malformed value", () => {
    for (const bad of [
      { ...base, channels: [{ name: "Elphaba" }] },
      { ...base, channels: [{ id: "ch-1", colour: "red" }] },
      { ...base, channels: [{ id: "ch-1", number: "one" }] },
      { ...base, gossip: true },
      { schemaVersion: "0", sequence: 1, generatedAtUtc: base.generatedAtUtc },
    ]) {
      expect(() => parseLiveStateDelta(bad)).toThrow(ProtocolContractError);
    }
  });
});

describe("diffLiveState / applyLiveStateDelta", () => {
  it("round-trips a telemetry change as a small delta", async () => {
    const previous = parseLiveState(await fixture());
    const next = structuredClone(previous);
    next.revision += 1;
    next.generatedAtUtc = "2026-09-27T10:00:05.000Z";
    const moved = next.channels[0]!;
    moved.rf = { ...moved.rf, levelDbm: -70 };

    const delta = diffLiveState(previous, 7, next, 8)!;
    expect(parseLiveStateDelta(delta)).toEqual(delta);
    expect(delta.channels).toEqual([{ id: moved.id, rf: moved.rf }]);
    expect(delta.revision).toBe(next.revision);
    expect(delta.show).toBeUndefined();
    expect(parseLiveState(applyLiveStateDelta(previous, delta))).toEqual(next);
    expect(JSON.stringify(delta).length).toBeLessThan(
      JSON.stringify(next).length / 3,
    );
  });

  it("asks for a full state when the channel list changes shape", async () => {
    const previous = parseLiveState(await fixture());
    const next = { ...previous, channels: previous.channels.slice(1) };
    expect(diffLiveState(previous, 1, next, 2)).toBeNull();
  });

  it("refuses to patch a channel the base does not have", async () => {
    const previous = parseLiveState(await fixture());
    expect(() =>
      applyLiveStateDelta(previous, {
        ...base,
        channels: [{ id: "not-in-this-show" }],
      }),
    ).toThrow();
  });
});
