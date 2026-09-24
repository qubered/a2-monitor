import { describe, expect, it } from "vitest";
import { parseHostOutput } from "@rvlt/pulse-protocol/http";
import {
  hostOutputDocument,
  monitorCommand,
  parseMonitorChange,
  SharedHostMonitor,
} from "./host-output.js";

describe("shared host monitor", () => {
  it("starts unmuted at unity with nothing selected", () => {
    const monitor = new SharedHostMonitor();
    expect(monitor.get()).toMatchObject({
      input: null,
      muted: false,
      dimmed: false,
      gainDb: 0,
    });
    expect(monitorCommand(monitor.get())).toEqual({ channel: null, gain: 0 });
  });

  it("applies partial changes and attributes each one", () => {
    const monitor = new SharedHostMonitor(
      () => new Date("2026-09-24T09:00:00Z"),
    );
    monitor.apply(
      parseMonitorChange(
        { channelId: "ch-1", input: 3, changedBy: " Sam (A2) " },
        8,
      ),
    );
    monitor.apply(parseMonitorChange({ gainDb: -6.04 }, 8));
    expect(monitor.get()).toEqual({
      channelId: "ch-1",
      input: 3,
      muted: false,
      dimmed: false,
      gainDb: -6,
      changedBy: null,
      changedAtUtc: "2026-09-24T09:00:00.000Z",
    });
    expect(monitor.getRevision()).toBe(2);
  });

  it("mutes to zero gain and dims by 12 dB without losing the selection", () => {
    const base = {
      channelId: "ch-1",
      input: 1,
      muted: false,
      dimmed: false,
      gainDb: 0,
      changedBy: null,
      changedAtUtc: null,
    };
    expect(monitorCommand({ ...base, muted: true })).toEqual({
      channel: 1,
      gain: 0,
    });
    expect(monitorCommand({ ...base, dimmed: true }).gain).toBeCloseTo(
      10 ** (-12 / 20),
      9,
    );
  });

  it("refuses a selection while capture is not ready", () => {
    expect(() =>
      parseMonitorChange({ channelId: "ch-1", input: 0 }, null),
    ).toThrow("audio-not-ready");
    expect(parseMonitorChange({ muted: true }, null)).toEqual({ muted: true });
  });

  it("clears a selection the running device no longer has", () => {
    const monitor = new SharedHostMonitor();
    monitor.apply({ channelId: "ch-9", input: 9 });
    monitor.constrain(8);
    expect(monitor.get()).toMatchObject({ channelId: null, input: null });
  });

  it("produces a contract-valid document", () => {
    const monitor = new SharedHostMonitor();
    const document = hostOutputDocument(
      {
        status: "error",
        detail: "",
        deviceName: "DVS",
        outputChannels: [1, 2],
        simulated: false,
        underruns: 3,
        droppedFrames: 480,
      },
      monitor,
    );
    expect(parseHostOutput(document)).toEqual(document);
    expect(document.output?.detail).toBe("Host output state is unknown.");
  });
});
