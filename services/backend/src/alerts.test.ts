import { describe, expect, it } from "vitest";
import {
  AlertBook,
  MAX_ALERT_HISTORY,
  normalizeOperator,
  type AlertCondition,
} from "./alerts.js";

const T0 = Date.parse("2026-09-23T01:00:00Z");
const FIVE_MINUTES = 5 * 60_000;

function condition(overrides: Partial<AlertCondition> = {}): AlertCondition {
  return {
    key: "ch-1:battery-low",
    kind: "battery-low",
    dimension: "Battery",
    severity: "caution",
    label: "Low battery",
    detail: "Battery 22 % on Stage left channel 1. Caution at 25 %.",
    channelId: "ch-1",
    channelNumber: 1,
    channelName: "Marguerite",
    receiverId: "rack-a",
    raiseAfterMs: 5_000,
    clearAfterMs: 10_000,
    ...overrides,
  };
}

describe("AlertBook", () => {
  it("raises only after a condition has held for its raise delay", () => {
    const book = new AlertBook(FIVE_MINUTES);
    expect(book.apply([condition()], T0)).toBe(false);
    expect(book.apply([condition()], T0 + 4_999)).toBe(false);
    expect(book.activeAlerts()).toEqual([]);

    expect(book.apply([condition()], T0 + 5_000)).toBe(true);
    expect(book.activeAlerts()).toEqual([
      {
        id: "alert-000001",
        kind: "battery-low",
        dimension: "Battery",
        severity: "caution",
        label: "Low battery",
        detail: "Battery 22 % on Stage left channel 1. Caution at 25 %.",
        channelId: "ch-1",
        channelNumber: 1,
        channelName: "Marguerite",
        receiverId: "rack-a",
        raisedAtUtc: "2026-09-23T01:00:05.000Z",
        acknowledgedAtUtc: null,
        acknowledgedBy: null,
        clearedAtUtc: null,
        overlayExpiresAtUtc: "2026-09-23T01:05:05.000Z",
      },
    ]);
  });

  it("forgets a condition that disappears before its raise delay", () => {
    const book = new AlertBook(FIVE_MINUTES);
    book.apply([condition()], T0);
    book.apply([], T0 + 1_000);
    book.apply([condition()], T0 + 2_000);
    expect(book.apply([condition()], T0 + 6_000)).toBe(false);
    expect(book.apply([condition()], T0 + 7_000)).toBe(true);
  });

  it("gives critical alerts no overlay expiry", () => {
    const book = new AlertBook(FIVE_MINUTES);
    book.apply([condition({ severity: "critical", raiseAfterMs: 0 })], T0);
    expect(book.activeAlerts()[0]?.overlayExpiresAtUtc).toBeNull();
  });

  it("clears after the condition has been absent for its clear delay and keeps history", () => {
    const book = new AlertBook(FIVE_MINUTES);
    book.apply([condition({ raiseAfterMs: 0 })], T0);
    expect(book.apply([], T0 + 1_000)).toBe(false);
    expect(book.apply([condition({ raiseAfterMs: 0 })], T0 + 2_000)).toBe(
      false,
    );
    expect(book.apply([], T0 + 3_000)).toBe(false);
    expect(book.apply([], T0 + 13_000)).toBe(true);

    expect(book.activeAlerts()).toEqual([]);
    const log = book.log(T0 + 13_000);
    expect(log.history).toHaveLength(1);
    expect(log.history[0]).toMatchObject({
      id: "alert-000001",
      acknowledgedAtUtc: null,
      clearedAtUtc: "2026-09-23T01:00:13.000Z",
    });
  });

  it("clears one channel's alerts into history and forgets its pending findings", () => {
    const book = new AlertBook(FIVE_MINUTES);
    const other = condition({
      key: "ch-2:battery-low",
      channelId: "ch-2",
      channelNumber: 2,
      raiseAfterMs: 0,
    });
    book.apply(
      [
        condition({ raiseAfterMs: 0 }),
        condition({ key: "ch-1:no-audio", kind: "no-audio", raiseAfterMs: 0 }),
        condition({
          key: "ch-1:rf-lost",
          kind: "rf-lost",
          raiseAfterMs: 60_000,
        }),
        other,
      ],
      T0,
    );
    expect(book.activeAlerts()).toHaveLength(3);

    expect(book.clearChannel("ch-1", T0 + 1_000)).toBe(2);
    expect(book.activeAlerts().map(({ channelId }) => channelId)).toEqual([
      "ch-2",
    ]);
    const history = book.log(T0 + 1_000).history;
    expect(history.map(({ kind }) => kind).sort()).toEqual([
      "battery-low",
      "no-audio",
    ]);
    expect(history.every(({ clearedAtUtc }) => clearedAtUtc !== null)).toBe(
      true,
    );

    // The pending rf-lost was forgotten, so it must hold its full delay again.
    book.apply(
      [
        condition({
          key: "ch-1:rf-lost",
          kind: "rf-lost",
          raiseAfterMs: 60_000,
        }),
      ],
      T0 + 61_000,
    );
    expect(book.activeAlerts().map(({ kind }) => kind)).not.toContain(
      "rf-lost",
    );
    expect(book.clearChannel("ch-none", T0 + 62_000)).toBe(0);
  });

  it("acknowledges without clearing and records who saw it", () => {
    const book = new AlertBook(FIVE_MINUTES);
    book.apply([condition({ raiseAfterMs: 0 })], T0);
    const acknowledged = book.acknowledge(
      "alert-000001",
      "  Sam   (A2) ",
      T0 + 3_000,
    );
    expect(acknowledged).toMatchObject({
      acknowledgedAtUtc: "2026-09-23T01:00:03.000Z",
      acknowledgedBy: "Sam (A2)",
      clearedAtUtc: null,
    });
    expect(book.activeAlerts()).toHaveLength(1);

    const again = book.acknowledge("alert-000001", "Someone else", T0 + 9_000);
    expect(again?.acknowledgedBy).toBe("Sam (A2)");
    expect(book.acknowledge("alert-999999", "Sam", T0)).toBeNull();
  });

  it("re-arms an acknowledged alert when it escalates, and keeps the acknowledgement when it eases", () => {
    const book = new AlertBook(FIVE_MINUTES);
    const rf = (severity: AlertCondition["severity"]) =>
      condition({
        key: "ch-1:rf-low",
        kind: "rf-low",
        dimension: "RF",
        severity,
        label: "Low RF",
        raiseAfterMs: 0,
      });
    book.apply([rf("caution")], T0);
    book.acknowledge("alert-000001", "Sam", T0 + 1_000);

    expect(book.apply([rf("critical")], T0 + 2_000)).toBe(true);
    expect(book.activeAlerts()[0]).toMatchObject({
      id: "alert-000001",
      severity: "critical",
      acknowledgedAtUtc: null,
      overlayExpiresAtUtc: null,
    });

    book.acknowledge("alert-000001", "Sam", T0 + 3_000);
    book.apply([rf("caution")], T0 + 4_000);
    expect(book.activeAlerts()[0]).toMatchObject({
      severity: "caution",
      acknowledgedBy: "Sam",
      overlayExpiresAtUtc: "2026-09-23T01:05:04.000Z",
    });
  });

  it("orders active alerts critical first, then oldest first", () => {
    const book = new AlertBook(FIVE_MINUTES);
    book.apply([condition({ key: "a", raiseAfterMs: 0 })], T0);
    book.apply(
      [
        condition({ key: "a", raiseAfterMs: 0 }),
        condition({ key: "b", severity: "critical", raiseAfterMs: 0 }),
      ],
      T0 + 1_000,
    );
    expect(book.activeAlerts().map(({ id }) => id)).toEqual([
      "alert-000002",
      "alert-000001",
    ]);
  });

  it("round-trips its state so acknowledgements and ids survive a restart", () => {
    const book = new AlertBook(FIVE_MINUTES);
    book.apply([condition({ raiseAfterMs: 0 })], T0);
    book.acknowledge("alert-000001", "Sam", T0 + 1_000);

    const restored = new AlertBook(FIVE_MINUTES);
    restored.restore(JSON.parse(JSON.stringify(book.snapshot())));
    expect(restored.activeAlerts()[0]).toMatchObject({
      id: "alert-000001",
      acknowledgedBy: "Sam",
    });
    // The restored alert is still tied to its condition key.
    expect(restored.apply([condition({ raiseAfterMs: 0 })], T0 + 2_000)).toBe(
      false,
    );
    restored.apply([condition({ key: "other", raiseAfterMs: 0 })], T0 + 3_000);
    expect(restored.activeAlerts().map(({ id }) => id)).toContain(
      "alert-000002",
    );
  });

  it("bounds history, newest first", () => {
    const book = new AlertBook(FIVE_MINUTES);
    for (let index = 0; index < MAX_ALERT_HISTORY + 5; index += 1) {
      book.apply(
        [condition({ key: `k${index}`, raiseAfterMs: 0, clearAfterMs: 0 })],
        T0 + index * 2,
      );
      book.apply([], T0 + index * 2 + 1);
    }
    const { history } = book.log(T0);
    expect(history).toHaveLength(MAX_ALERT_HISTORY);
    expect(history[0]?.id).toBe(
      `alert-${String(MAX_ALERT_HISTORY + 5).padStart(6, "0")}`,
    );
  });
});

describe("normalizeOperator", () => {
  it("collapses whitespace, bounds length and never records an empty name", () => {
    expect(normalizeOperator("  ")).toBe("Unnamed operator");
    expect(normalizeOperator("Sam\n Lee")).toBe("Sam Lee");
    expect(normalizeOperator("x".repeat(120))).toHaveLength(80);
  });
});
