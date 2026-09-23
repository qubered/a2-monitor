import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  MediaWorkerManager,
  SessionRejectedError,
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
      channel: 1,
      offer: "v=0",
      candidateAddress: "192.168.1.20",
    });
    await flush();
    expect(child.commands).toEqual([
      {
        type: "open",
        sessionId: "s-1",
        channel: 1,
        offer: "v=0",
        candidateAddress: "192.168.1.20",
      },
    ]);
    child.emit({ type: "answer", sessionId: "s-1", answer: "v=0 answer" });
    await expect(answer).resolves.toBe("v=0 answer");

    expect(media.selectChannel("s-1", 0)).toBe(true);
    expect(media.selectChannel("unknown", 0)).toBe(false);
    await flush();
    expect(child.commands.at(-1)).toEqual({
      type: "select",
      sessionId: "s-1",
      channel: 0,
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
      channel: 0,
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
      channel: 0,
      offer: "v=0",
      candidateAddress: "127.0.0.1",
    });

    child.emit({ type: "ready", deviceName: "DVS", sampleRateHz: 44_100 });

    await expect(opened).rejects.toThrow("ready event fields are invalid");
    expect(media.getState()).toMatchObject({ status: "error" });
    expect(child.stop).toHaveBeenCalledOnce();
  });

  it("reports worker exit as an error", () => {
    const child = new FakeWorkerProcess();
    const media = new MediaWorkerManager({
      device: "DVS",
      processFactory: () => child,
    });
    media.start();
    child.exit(2);
    expect(media.getState()).toEqual({
      schemaVersion: 0,
      status: "error",
      detail: "Media worker exited (2).",
    });
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
});
