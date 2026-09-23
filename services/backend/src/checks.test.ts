import { describe, expect, it } from "vitest";
import {
  checkVerdict,
  CheckNotFoundError,
  CheckStore,
  MIC_CHECK_DIMENSIONS,
  summarizeCheck,
} from "./checks.js";

const T0 = Date.parse("2026-09-23T02:00:00Z");
const subject = {
  inputIndex: 0,
  receiverId: "rack-a",
  receiverChannelIndex: 0,
  performer: "Eleanor Vance",
};

describe("CheckStore", () => {
  it("records attributed verdicts in dimension order and summarizes them", () => {
    const store = new CheckStore();
    store.record(
      "ch-1",
      subject,
      "battery-window",
      "fail",
      " Sam  (A2) ",
      "Pack at 30 %.",
      T0,
    );
    const check = store.record(
      "ch-1",
      subject,
      "physical-identity",
      "pass",
      "Sam (A2)",
      null,
      T0 + 1_000,
    );

    expect(
      check.dimensions.map(({ id, verdict, by }) => [id, verdict, by]),
    ).toEqual([
      ["physical-identity", "pass", "Sam (A2)"],
      ["battery-window", "fail", "Sam (A2)"],
    ]);
    expect(check.dimensions[1]?.reason).toBe("Pack at 30 %.");
    expect(check.startedAtUtc).toBe("2026-09-23T02:00:00.000Z");
    expect(check.updatedAtUtc).toBe("2026-09-23T02:00:01.000Z");

    const summary = summarizeCheck(check, subject);
    expect(summary).toEqual({
      passed: 1,
      failed: 1,
      waiting: 0,
      total: 8,
      stale: false,
      updatedAtUtc: "2026-09-23T02:00:01.000Z",
    });
    expect(checkVerdict(summary)).toBe("fault");
  });

  it("reads caution while in progress or waiting on the A1, and good only when all eight pass", () => {
    const store = new CheckStore();
    store.record("ch-1", subject, "captured-audio", "waiting", "Sam", null, T0);
    expect(checkVerdict(summarizeCheck(store.get("ch-1"), subject))).toBe(
      "caution",
    );
    for (const dimension of MIC_CHECK_DIMENSIONS) {
      store.record("ch-1", subject, dimension, "pass", "Sam", null, T0);
    }
    expect(checkVerdict(summarizeCheck(store.get("ch-1"), subject))).toBe(
      "good",
    );
    expect(checkVerdict(null)).toBe("unknown");
  });

  it("marks a check stale when its subject changes and starts fresh on the next verdict", () => {
    const store = new CheckStore();
    for (const dimension of MIC_CHECK_DIMENSIONS) {
      store.record("ch-1", subject, dimension, "pass", "Sam", null, T0);
    }
    const repatched = { ...subject, receiverChannelIndex: 1 };
    const summary = summarizeCheck(store.get("ch-1"), repatched);
    expect(summary?.stale).toBe(true);
    expect(checkVerdict(summary)).toBe("unknown");

    const fresh = store.record(
      "ch-1",
      repatched,
      "rf-link",
      "pass",
      "Sam",
      null,
      T0 + 5_000,
    );
    expect(fresh.dimensions).toHaveLength(1);
    expect(fresh.subject).toEqual(repatched);
  });

  it("lists only channels still in the show and round-trips through persistence", () => {
    const store = new CheckStore();
    store.record("ch-1", subject, "rf-link", "pass", "Sam", null, T0);
    store.record("ch-gone", subject, "rf-link", "pass", "Sam", null, T0);
    const list = store.list(new Map([["ch-1", subject]]), T0);
    expect(
      list.checks.map(({ channelId, stale }) => [channelId, stale]),
    ).toEqual([["ch-1", false]]);

    const restored = new CheckStore();
    restored.restore(JSON.parse(JSON.stringify(store.snapshot())));
    expect(restored.get("ch-1")?.dimensions[0]?.by).toBe("Sam");
  });

  it("resets one channel or every channel", () => {
    const store = new CheckStore();
    store.record("ch-1", subject, "rf-link", "pass", "Sam", null, T0);
    store.record("ch-2", subject, "rf-link", "pass", "Sam", null, T0);
    store.reset("ch-1");
    expect(store.get("ch-1")).toBeUndefined();
    expect(() => store.reset("ch-1")).toThrow(CheckNotFoundError);
    store.resetAll();
    expect(store.get("ch-2")).toBeUndefined();
  });
});
