import { describe, expect, it } from "vitest";
import type { LiveStateChannel } from "@rvlt/pulse-protocol/http";
import { DEFAULT_ALERT_POLICY } from "./alert-policy.js";
import { evaluate } from "./live-model.js";
import {
  levelsWith,
  observationAt,
  showfileWith,
  telemetryWith,
} from "./monitoring.test-support.js";
import {
  CLOSED_VISIBLE_MS,
  REPORT_UNDO_MS,
  ReportBook,
  ReportError,
} from "./reports.js";

const T0 = Date.parse("2026-09-23T03:00:00Z");

function channels(battery = 90): LiveStateChannel[] {
  return evaluate({
    showfile: showfileWith(),
    policy: DEFAULT_ALERT_POLICY,
    observation: observationAt(
      T0,
      levelsWith([-12, -30]),
      telemetryWith([{ batteryChargePercent: battery }]),
    ),
    trackers: new Map(),
    nowMs: T0,
  }).channels;
}

describe("ReportBook", () => {
  it("files a task with the channel identity captured at report time", () => {
    const book = new ReportBook();
    const report = book.create(
      channels()[0]!,
      ["clothing-noise", "crackling", "crackling"],
      "  worse on the lift  ",
      "Morgan (A1)",
      T0,
    );
    expect(report).toMatchObject({
      id: "report-000001",
      channelId: "ch-marguerite",
      channelNumber: 1,
      channelName: "Marguerite",
      performer: "Eleanor Vance",
      faults: ["crackling", "clothing-noise"],
      note: "worse on the lift",
      urgent: false,
      incident: false,
      incidentReason: null,
      status: "open",
      requestedBy: "Morgan (A1)",
      undoUntilUtc: new Date(T0 + REPORT_UNDO_MS).toISOString(),
    });
    expect(() => book.create(channels()[0]!, [], null, "Morgan", T0)).toThrow(
      ReportError,
    );
  });

  it("starts as an incident when telemetry already shows a fault on that channel", () => {
    const book = new ReportBook();
    const report = book.create(
      channels(5)[0]!,
      ["dropping-out"],
      null,
      "Morgan",
      T0,
    );
    expect(report).toMatchObject({
      incident: true,
      incidentReason: "telemetry",
    });
  });

  it("lets the A1 take a report back only inside the undo window", () => {
    const book = new ReportBook();
    const first = book.create(channels()[0]!, ["popping"], null, "Morgan", T0);
    expect(book.act(first.id, "undo", "Morgan", T0 + 5_000).status).toBe(
      "cancelled",
    );

    const second = book.create(channels()[0]!, ["popping"], null, "Morgan", T0);
    expect(() =>
      book.act(second.id, "undo", "Morgan", T0 + REPORT_UNDO_MS + 1),
    ).toThrow("can no longer be taken back");
  });

  it("closes a task on resolve, but sends a resolved incident back to the A1 to confirm", () => {
    const book = new ReportBook();
    const task = book.create(channels()[0]!, ["too-quiet"], null, "Morgan", T0);
    book.act(task.id, "claim", "Sam (A2)", T0 + 1_000);
    const closed = book.act(task.id, "resolve", "Sam (A2)", T0 + 60_000);
    expect(closed).toMatchObject({
      status: "closed",
      claimedBy: "Sam (A2)",
      resolvedBy: "Sam (A2)",
      closedAtUtc: new Date(T0 + 60_000).toISOString(),
    });

    const incident = book.create(
      channels()[0]!,
      ["distorted"],
      null,
      "Morgan",
      T0,
    );
    const urgent = book.act(incident.id, "urgent", "Morgan", T0 + 2_000);
    expect(urgent).toMatchObject({
      urgent: true,
      incident: true,
      incidentReason: "urgent",
    });
    expect(book.act(incident.id, "resolve", "Sam", T0 + 30_000).status).toBe(
      "awaiting-confirmation",
    );
    expect(
      book.act(incident.id, "reopen", "Morgan", T0 + 40_000),
    ).toMatchObject({
      status: "claimed",
      resolvedBy: null,
    });
    book.act(incident.id, "resolve", "Sam", T0 + 50_000);
    expect(
      book.act(incident.id, "confirm-fixed", "Morgan", T0 + 55_000).status,
    ).toBe("closed");
    expect(() => book.act(incident.id, "claim", "Sam", T0 + 56_000)).toThrow(
      "Only an open report can be claimed.",
    );
  });

  it("promotes an open task when its channel faults, and keeps closed reports visible briefly", () => {
    const book = new ReportBook();
    const report = book.create(
      channels()[0]!,
      ["crackling"],
      null,
      "Morgan",
      T0,
    );
    expect(book.promoteForTelemetry(new Set(["ch-talkback"]))).toBe(false);
    expect(book.promoteForTelemetry(new Set(["ch-marguerite"]))).toBe(true);
    expect(book.visible(T0)[0]).toMatchObject({
      incident: true,
      incidentReason: "telemetry",
    });

    book.act(report.id, "resolve", "Sam", T0);
    book.act(report.id, "confirm-fixed", "Morgan", T0);
    expect(book.visible(T0 + CLOSED_VISIBLE_MS)).toHaveLength(1);
    expect(book.visible(T0 + CLOSED_VISIBLE_MS + 1)).toHaveLength(0);

    const restored = new ReportBook();
    restored.restore(JSON.parse(JSON.stringify(book.snapshot())));
    expect(
      restored.create(
        channels()[0]!,
        ["other"],
        "buzz on wig mic",
        "Morgan",
        T0,
      ).id,
    ).toBe("report-000002");
  });
});
