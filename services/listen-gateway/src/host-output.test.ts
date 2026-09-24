import { describe, expect, it } from "vitest";
import { parseHostOutput } from "@rvlt/pulse-protocol/http";
import {
  HostOutputSessions,
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

  it("produces a contract-valid document with every session", () => {
    const sessions = new HostOutputSessions([1]);
    const document = hostOutputDocument(
      {
        status: "error",
        detail: "",
        deviceName: "DVS",
        channelCount: null,
        routes: [[1]],
        simulated: false,
        underruns: 3,
        droppedFrames: 480,
      },
      sessions,
    );
    expect(parseHostOutput(document)).toEqual(document);
    expect(document.output?.detail).toBe("Host output state is unknown.");
    expect(document.sessions).toMatchObject([
      { id: "default", name: "Host output", outputChannels: [1], revision: 0 },
    ]);
    expect(hostOutputDocument(null, sessions).sessions).toEqual([]);
  });
});

describe("host output sessions", () => {
  const comms = (id: string, outputChannels: number[]) => ({
    id,
    name: `Comms ${id}`,
    outputChannels,
  });

  it("keeps each session's shared state by id across reconfiguration", () => {
    const sessions = new HostOutputSessions([1]);
    const changed: string[] = [];
    sessions.on("sessions", () => changed.push("sessions"));
    sessions.on("monitor", (mix: number) => changed.push(`monitor ${mix}`));

    expect(sessions.configure([comms("a", [1]), comms("b", [2])], [1])).toBe(
      true,
    );
    sessions.find("b")!.monitor.apply({ channelId: "ch", input: 3 });
    expect(changed).toEqual(["sessions", "monitor 1"]);
    expect(sessions.routes()).toEqual([[1], [2]]);

    // Same config: no change. Session b moves to mix 0 and keeps its state.
    expect(sessions.configure([comms("a", [1]), comms("b", [2])], [1])).toBe(
      false,
    );
    sessions.configure([comms("b", [2])], [1]);
    expect(sessions.find("a")).toBeUndefined();
    expect(sessions.find("b")!.monitor.get().input).toBe(3);
    sessions.find("b")!.monitor.apply({ muted: true });
    expect(changed.at(-1)).toBe("monitor 0");

    // No sessions: back to the node's default single session.
    sessions.configure(undefined, [4]);
    expect(sessions.list().map(({ id }) => id)).toEqual(["default"]);
    expect(sessions.routes()).toEqual([[4]]);
  });

  it("clears every session's selection the running device no longer has", () => {
    const sessions = new HostOutputSessions([1]);
    sessions.configure([comms("a", [1]), comms("b", [2])], [1]);
    sessions.find("a")!.monitor.apply({ channelId: "ch-9", input: 9 });
    sessions.find("b")!.monitor.apply({ channelId: "ch-1", input: 1 });
    sessions.constrain(8);
    expect(sessions.find("a")!.monitor.get().input).toBeNull();
    expect(sessions.find("b")!.monitor.get().input).toBe(1);
  });
});
