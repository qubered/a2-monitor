import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  MediaWorkerManager,
  SessionRejectedError,
  parseOutputChannels,
  parseWorkerEvent,
  type WorkerProcess,
} from "./media-worker.js";

class FakeWorkerProcess implements WorkerProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stop = vi.fn();
  readonly commands: Array<Record<string, unknown>> = [];
  private exitListener:
    ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;

  constructor() {
    let buffered = "";
    this.stdin.on("data", (data: Buffer) => {
      buffered += data.toString("utf8");
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        this.commands.push(
          JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>,
        );
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
    });
  }

  onError(): void {}

  onExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    this.exitListener = listener;
  }

  exit(code: number | null): void {
    this.exitListener?.(code, null);
  }

  emit(event: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(event)}\n`);
  }

  ready(channelCount = 2): void {
    this.emit({
      type: "ready",
      deviceName: "DVS",
      sampleRateHz: 48_000,
      channelCount,
    });
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("MediaWorkerManager", () => {
  it("does not spawn until an explicit device is configured", () => {
    const factory = vi.fn();
    const media = new MediaWorkerManager({ processFactory: factory });

    media.start();

    expect(factory).not.toHaveBeenCalled();
    expect(media.getState()).toEqual({
      schemaVersion: 0,
      status: "configuration-required",
      detail: "Set A2_AUDIO_DEVICE to an explicit capture device.",
    });
  });

  it("passes the exact device and capture binary, then reports the ready device", () => {
    const child = new FakeWorkerProcess();
    const factory = vi.fn(() => child);
    const media = new MediaWorkerManager({
      device: "Dante Virtual Soundcard (64x64)",
      workerBinary: "/opt/a2/media-worker",
      captureBinary: "/opt/a2/device-capture",
      processFactory: factory,
    });

    media.start();
    expect(factory).toHaveBeenCalledWith("/opt/a2/media-worker", [
      "--capture-bin",
      "/opt/a2/device-capture",
      "--device",
      "Dante Virtual Soundcard (64x64)",
    ]);

    // Split across writes to prove line reassembly.
    const line =
      '{"type":"ready","deviceName":"DVS","sampleRateHz":48000,"channelCount":2}\n';
    child.stdout.write(line.slice(0, 10));
    child.stdout.write(line.slice(10));

    expect(media.getState()).toEqual({
      schemaVersion: 0,
      status: "ready",
      detail: "Capture is ready.",
      device: { name: "DVS", sampleRateHz: 48_000, channelCount: 2 },
      channels: [
        { index: 0, label: "Channel 1" },
        { index: 1, label: "Channel 2" },
      ],
    });
  });

  it("relays an offer and resolves with the worker's answer", async () => {
    const child = new FakeWorkerProcess();
    const media = new MediaWorkerManager({
      device: "DVS",
      processFactory: () => child,
    });
    media.start();
    child.ready();

    const answer = media.openSession({
      sessionId: "s-1",
      sources: [{ channel: 1, gain: 1 }],
      offer: "v=0",
      candidateAddress: "192.168.1.20",
    });
    await flush();
    expect(child.commands).toEqual([
      {
        type: "open",
        sessionId: "s-1",
        sources: [{ channel: 1, gain: 1 }],
        offer: "v=0",
        candidateAddress: "192.168.1.20",
      },
    ]);
    child.emit({ type: "answer", sessionId: "s-1", answer: "v=0 answer" });
    await expect(answer).resolves.toBe("v=0 answer");

    const mix = [
      { channel: 0, gain: 1 },
      { channel: 1, gain: 0.5 },
    ];
    expect(media.selectSources("s-1", mix)).toBe(true);
    expect(media.selectSources("unknown", mix)).toBe(false);
    await flush();
    expect(child.commands.at(-1)).toEqual({
      type: "select",
      sessionId: "s-1",
      sources: mix,
    });

    const closed = vi.fn();
    media.on("session-closed", closed);
    child.emit({ type: "closed", sessionId: "s-1", reason: "disconnected" });
    await flush();
    expect(closed).toHaveBeenCalledWith("s-1");
    expect(media.hasSession("s-1")).toBe(false);
  });

  it("surfaces worker rejections with a capacity flag", async () => {
    const child = new FakeWorkerProcess();
    const media = new MediaWorkerManager({
      device: "DVS",
      processFactory: () => child,
    });
    media.start();
    child.ready();

    const opened = media.openSession({
      sessionId: "s-2",
      sources: [{ channel: 0, gain: 1 }],
      offer: "v=0",
      candidateAddress: "127.0.0.1",
    });
    child.emit({
      type: "rejected",
      sessionId: "s-2",
      detail: "listener capacity reached",
    });
    const error = await opened.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SessionRejectedError);
    expect((error as SessionRejectedError).capacity).toBe(true);
  });

  it("fails closed on malformed events and rejects pending offers", async () => {
    const child = new FakeWorkerProcess();
    const media = new MediaWorkerManager({
      device: "DVS",
      processFactory: () => child,
    });
    media.start();
    child.ready();
    const opened = media.openSession({
      sessionId: "s-3",
      sources: [{ channel: 0, gain: 1 }],
      offer: "v=0",
      candidateAddress: "127.0.0.1",
    });

    child.emit({ type: "ready", deviceName: "DVS", sampleRateHz: 44_100 });

    await expect(opened).rejects.toThrow("ready event fields are invalid");
    expect(media.getState()).toMatchObject({ status: "error" });
    expect(child.stop).toHaveBeenCalledOnce();
    media.stop();
  });

  it("restarts the same named device with bounded backoff after the worker exits", () => {
    vi.useFakeTimers();
    try {
      let clock = 0;
      const children: FakeWorkerProcess[] = [];
      const factory = vi.fn((_binary: string, args: readonly string[]) => {
        const child = new FakeWorkerProcess();
        children.push(child);
        expect(args.at(-1)).toBe("DVS");
        return child;
      });
      const media = new MediaWorkerManager({
        device: "DVS",
        processFactory: factory,
        restartDelaysMs: [1_000, 2_000],
        now: () => clock,
      });
      media.start();
      children[0]!.exit(2);
      expect(media.getState()).toEqual({
        schemaVersion: 0,
        status: "error",
        detail: "Media worker exited (2). Retrying the same device in 1 s.",
      });

      vi.advanceTimersByTime(999);
      expect(factory).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1);
      expect(factory).toHaveBeenCalledTimes(2);
      expect(media.getState()).toMatchObject({ status: "starting" });

      // A second failure before the worker was stable backs off further.
      children[1]!.exit(null);
      expect(media.getState()).toMatchObject({
        detail:
          "Media worker exited (unknown). Retrying the same device in 2 s.",
      });
      vi.advanceTimersByTime(2_000);
      expect(factory).toHaveBeenCalledTimes(3);

      // A worker that stayed ready for 30 s resets the backoff.
      children[2]!.ready();
      clock += 30_000;
      children[2]!.exit(2);
      expect(media.getState()).toMatchObject({
        detail: "Media worker exited (2). Retrying the same device in 1 s.",
      });
      media.stop();
      vi.advanceTimersByTime(60_000);
      expect(factory).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("relays per-input meter readings without the event type", () => {
    const child = new FakeWorkerProcess();
    const media = new MediaWorkerManager({
      device: "DVS",
      processFactory: () => child,
    });
    const readings: unknown[] = [];
    media.on("meters", (reading) => readings.push(reading));
    media.start();
    child.ready();
    child.emit({
      type: "meters",
      sequence: 4,
      intervalMs: 50,
      peakDbfs: [-6, -120],
      rmsDbfs: [-9.1, -120],
      clippedSamples: [0, 0],
    });
    return flush().then(() => {
      expect(readings).toEqual([
        {
          sequence: 4,
          intervalMs: 50,
          peakDbfs: [-6, -120],
          rmsDbfs: [-9.1, -120],
          clippedSamples: [0, 0],
        },
      ]);
      expect(media.simulated).toBe(false);
      media.stop();
    });
  });

  it("marks only the reserved test-signal device as simulated", () => {
    expect(
      new MediaWorkerManager({ device: "Pulse test signal" }).simulated,
    ).toBe(true);
    expect(
      new MediaWorkerManager({ device: "pulse test signal" }).simulated,
    ).toBe(false);
  });
});

describe("parseWorkerEvent", () => {
  it("rejects unknown event types and extra fields", () => {
    expect(() => parseWorkerEvent('{"type":"restart"}')).toThrow();
    expect(() =>
      parseWorkerEvent('{"type":"connected","sessionId":"a","extra":1}'),
    ).toThrow();
    expect(parseWorkerEvent('{"type":"connected","sessionId":"a"}')).toEqual({
      type: "connected",
      sessionId: "a",
    });
  });

  it("accepts only bounded, equal-length meter arrays", () => {
    const meters = (fields: Record<string, unknown>) =>
      JSON.stringify({
        type: "meters",
        sequence: 0,
        intervalMs: 50,
        peakDbfs: [-6],
        rmsDbfs: [-9],
        clippedSamples: [0],
        ...fields,
      });
    expect(parseWorkerEvent(meters({}))).toMatchObject({ peakDbfs: [-6] });
    for (const invalid of [
      { peakDbfs: [0.5] },
      { rmsDbfs: [-121] },
      { peakDbfs: [], rmsDbfs: [], clippedSamples: [] },
      { clippedSamples: [0, 0] },
      { clippedSamples: [-1] },
      { intervalMs: 5 },
      { sequence: -1 },
      { peakDbfs: ["-6"] },
    ]) {
      expect(() => parseWorkerEvent(meters(invalid))).toThrow();
    }
  });

  it("adds the output device to the worker and tracks its state", async () => {
    const child = new FakeWorkerProcess();
    const factory = vi.fn(() => child);
    const media = new MediaWorkerManager({
      device: "DVS",
      workerBinary: "/bin/worker",
      captureBinary: "/bin/capture",
      outputDevice: "DVS",
      outputChannels: [3, 4],
      outputBinary: "/bin/output",
      processFactory: factory,
    });
    media.setMonitor(0, { channel: 1, gain: 0.5 });
    // A mix beyond the routes is ignored.
    media.setMonitor(3, { channel: 1, gain: 0.5 });
    media.start();
    expect(factory).toHaveBeenCalledWith("/bin/worker", [
      "--capture-bin",
      "/bin/capture",
      "--device",
      "DVS",
      "--output-bin",
      "/bin/output",
      "--output-device",
      "DVS",
      "--output-routes",
      "3,4",
    ]);
    expect(media.getOutputState()).toMatchObject({ status: "starting" });

    child.ready();
    child.emit({
      type: "output-ready",
      deviceName: "DVS",
      channelCount: 64,
      outputRoutes: [[3, 4]],
    });
    child.emit({
      type: "output-stats",
      underruns: 2,
      skippedFrames: 10,
      overflowFrames: 0,
      droppedBlocks: 1,
    });
    await flush();
    // The monitor set before the worker was ready is sent once it is.
    expect(child.commands.filter(({ type }) => type === "monitor")).toEqual([
      { type: "monitor", mix: 0, channel: 1, gain: 0.5 },
    ]);
    expect(media.getOutputState()).toMatchObject({
      status: "ready",
      detail: "DVS is open: 1 feed on 2 of 64 outputs.",
      channelCount: 64,
      underruns: 2,
      droppedFrames: 490,
    });

    child.emit({
      type: "output-failed",
      detail: "output device not found",
      retryInMs: 2_000,
    });
    await flush();
    expect(media.getOutputState()).toMatchObject({
      status: "error",
      detail: "output device not found. Retrying in 2 s.",
    });
    media.stop();
  });

  it("reports no output state without an output device", () => {
    const media = new MediaWorkerManager({ device: "DVS" });
    expect(media.getOutputState()).toBeNull();
  });

  it("parses output channel lists strictly", () => {
    expect(parseOutputChannels("1")).toEqual([1]);
    expect(parseOutputChannels(" 3, 4 ")).toEqual([3, 4]);
    for (const invalid of ["", "0", "1,1", "257", "1.5", "a"]) {
      expect(() => parseOutputChannels(invalid), invalid).toThrow();
    }
  });

  it("switches the output to a production's feeds and back to the default", async () => {
    const child = new FakeWorkerProcess();
    const factory = vi.fn(() => child);
    const media = new MediaWorkerManager({
      device: "DVS",
      outputDevice: "DVS",
      outputChannels: [1],
      processFactory: factory,
    });
    // Set before the worker exists: the spawn already uses it.
    media.setOutputRoutes([[12], [13, 14]]);
    media.start();
    const args = factory.mock.calls[0]![1] as string[];
    expect(args[args.indexOf("--output-routes") + 1]).toBe("12;13,14");

    child.ready(64);
    await flush();
    const sent = () =>
      child.commands.filter(({ type }) => type === "output-routes");
    expect(sent().at(-1)).toEqual({
      type: "output-routes",
      routes: [[12], [13, 14]],
    });

    const before = sent().length;
    media.setOutputRoutes([[12], [13, 14]]);
    expect(sent()).toHaveLength(before);

    media.setOutputRoutes(undefined);
    await flush();
    expect(sent().at(-1)).toEqual({ type: "output-routes", routes: [[1]] });
    expect(media.getOutputState()).toMatchObject({
      status: "starting",
      routes: [[1]],
    });

    child.emit({
      type: "output-ready",
      deviceName: "DVS",
      channelCount: 64,
      outputRoutes: [[1]],
    });
    await flush();
    expect(media.getOutputState()).toMatchObject({
      status: "ready",
      routes: [[1]],
    });
    media.stop();
  });

  it("passes the recording directory and relays recording state", async () => {
    const child = new FakeWorkerProcess();
    const factory = vi.fn(() => child);
    const media = new MediaWorkerManager({
      device: "DVS",
      recordingDirectory: "/var/pulse/recordings",
      processFactory: factory,
    });
    expect(media.getRecordingState()).toMatchObject({
      available: true,
      enabled: false,
      active: false,
    });
    expect(media.setRecording(true, 30)).toBe(false);
    media.start();
    expect(factory.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["--recording-dir", "/var/pulse/recordings"]),
    );
    child.ready();

    expect(media.setRecording(true, 30)).toBe(true);
    await flush();
    expect(child.commands.at(-1)).toEqual({
      type: "recording",
      enabled: true,
      retentionMinutes: 30,
    });
    child.emit({
      type: "recording",
      available: true,
      enabled: true,
      retentionMinutes: 30,
      active: true,
      droppedBlocks: 2,
      writeErrors: 0,
    });
    await flush();
    expect(media.getRecordingState()).toEqual({
      schemaVersion: "0",
      available: true,
      enabled: true,
      retentionMinutes: 30,
      active: true,
      droppedBlocks: 2,
      writeErrors: 0,
    });
  });

  it("reports recording unavailable without a directory and rejects bad events", () => {
    const media = new MediaWorkerManager({ device: "DVS" });
    expect(media.getRecordingState().available).toBe(false);
    expect(media.setRecording(true, 30)).toBe(false);
    expect(() =>
      parseWorkerEvent(
        JSON.stringify({
          type: "recording",
          available: true,
          enabled: true,
          retentionMinutes: 61,
          active: true,
          droppedBlocks: 0,
          writeErrors: 0,
        }),
      ),
    ).toThrow("recording event is invalid");
  });

  it("starts replay on a session and relays the node's refusal", async () => {
    const child = new FakeWorkerProcess();
    const media = new MediaWorkerManager({
      device: "DVS",
      recordingDirectory: "/rec",
      processFactory: () => child,
    });
    media.start();
    child.ready();
    const opened = media.openSession({
      sessionId: "s-1",
      sources: [{ channel: 0, gain: 1 }],
      offer: "v=0",
      candidateAddress: "192.168.1.20",
    });
    await flush();
    child.emit({ type: "answer", sessionId: "s-1", answer: "a" });
    await opened;

    const started = media.startReplay("s-1", 1, 0.5, 1_700_000_000_000);
    await flush();
    expect(child.commands.at(-1)).toEqual({
      type: "replay",
      sessionId: "s-1",
      channel: 1,
      gain: 0.5,
      atUtcMs: 1_700_000_000_000,
    });
    child.emit({ type: "replay-started", sessionId: "s-1" });
    await expect(started).resolves.toBeUndefined();

    const refused = media.startReplay("s-1", 1, 0.5, 5);
    await flush();
    child.emit({
      type: "replay-rejected",
      sessionId: "s-1",
      detail: "nothing was recorded at that time",
    });
    await expect(refused).rejects.toThrow("nothing was recorded");
    await expect(media.startReplay("other", 1, 1, 5)).rejects.toThrow(
      "unknown session",
    );

    const ended = vi.fn();
    media.on("replay-ended", ended);
    child.emit({ type: "replay-ended", sessionId: "s-1" });
    await flush();
    expect(ended).toHaveBeenCalledWith("s-1");
  });
});
