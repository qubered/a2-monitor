import { describe, expect, it } from "vitest";
import type { LiveStateChannel } from "@rvlt/pulse-protocol/http";
import {
  formatStartMinute,
  nextSessionMinutes,
  turnoverItems,
  type SessionState,
} from "./sessions";

function wireless(
  overrides: Partial<Omit<LiveStateChannel, "battery">> & {
    battery?: Partial<LiveStateChannel["battery"]>;
  } = {},
): LiveStateChannel {
  const { battery, ...rest } = overrides;
  return {
    id: "ch-1",
    number: 1,
    name: "Podium",
    performer: "Dana Lee",
    kind: "wireless",
    micType: "handheld",
    hasImage: false,
    input: { index: 0, label: "input 1" },
    receiver: null,
    monitor: { battery: true, rf: true, audio: true },
    statuses: { rf: "good", audio: "good", battery: "good", check: "unknown" },
    audio: {
      availability: "observed",
      peakDbfs: -12,
      rmsDbfs: -30,
      silentForMs: 0,
      clipping: false,
    },
    rf: {
      availability: "observed",
      levelDbm: -58,
      linkQualityPercent: 100,
      activeAntenna: "A",
      interference: "none",
      transmitterPresent: true,
    },
    battery: {
      availability: "observed",
      percent: 80,
      bars: 4,
      runtimeMinutes: 200,
      type: "LION",
      ...battery,
    },
    transmitter: { type: null, name: null, muted: false, observedAtUtc: null },
    check: null,
    session: { inUse: false, nextInUse: true, nextPresenter: "Priya Shah" },
    ...rest,
  };
}

const RUN: SessionState = {
  roomId: null,
  activeId: "a",
  nextId: "b",
  startedAtUtc: null,
  startedBy: null,
  sessions: [
    { id: "a", name: "Keynote", startMinute: 540, channelCount: 1 },
    { id: "b", name: "Panel", startMinute: 615, channelCount: 2 },
    { id: "c", name: "Close", startMinute: 690, channelCount: 1 },
  ],
};

describe("session helpers", () => {
  it("formats a scheduled start as local wall-clock time", () => {
    expect(formatStartMinute(9 * 60 + 5)).toBe("09:05");
    expect(formatStartMinute(null)).toBeNull();
  });

  it("measures the next session only when both ends are scheduled", () => {
    expect(nextSessionMinutes(RUN)).toBe(75);
    expect(nextSessionMinutes({ ...RUN, nextId: "c" })).toBeNull();
    expect(
      nextSessionMinutes({
        ...RUN,
        sessions: RUN.sessions.map((entry) =>
          entry.id === "c" ? { ...entry, startMinute: null } : entry,
        ),
      }),
    ).toBeNull();
  });
});

describe("turnoverItems", () => {
  it("lists only channels the next session uses, with presenter changes", () => {
    const items = turnoverItems([
      wireless(),
      wireless({
        id: "ch-2",
        session: { inUse: true, nextInUse: false, nextPresenter: null },
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      tone: "ready",
      readiness: "Battery 80 % · 3 h 20 min",
      presenterChange: { from: "Dana Lee", to: "Priya Shah" },
    });
  });

  it("asks for a battery change when the pack will not last the session", () => {
    const [item] = turnoverItems(
      [wireless({ battery: { percent: 35, runtimeMinutes: 60 } })],
      75,
    );
    expect(item).toMatchObject({
      tone: "action",
      readiness: "Change battery · 1 h 0 min left, session runs 1 h 15 min",
    });
  });

  it("never calls an unmeasured pack ready, and flags a switched-off transmitter", () => {
    const [unknown, off] = turnoverItems([
      wireless({
        statuses: {
          rf: "unknown",
          audio: "unknown",
          battery: "unknown",
          check: "unknown",
        },
        battery: { percent: null, bars: null, runtimeMinutes: null },
      }),
      wireless({
        id: "ch-2",
        rf: {
          availability: "observed",
          levelDbm: null,
          linkQualityPercent: null,
          activeAntenna: null,
          interference: "none",
          transmitterPresent: false,
        },
      }),
    ]);
    expect(unknown).toMatchObject({
      tone: "unknown",
      readiness: "Battery unknown · check the pack",
    });
    expect(off).toMatchObject({
      tone: "action",
      readiness: "Transmitter off · switch on and check",
    });
  });
});
