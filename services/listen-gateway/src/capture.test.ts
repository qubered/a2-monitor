import { Buffer } from "node:buffer";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CaptureManager,
  MAX_FRAMES_PER_CHUNK,
  type CaptureAudioChunk,
  type CaptureProcess,
} from "./capture.js";
import { SIMULATED_DEVICE_NAME } from "./simulated-capture.js";

afterEach(() => {
  vi.useRealTimers();
});

class FakeCaptureProcess implements CaptureProcess {
  readonly stdout = new PassThrough();
  readonly stop = vi.fn();
  private errorListener: ((error: Error) => void) | undefined;
  private exitListener:
    ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;

  onError(listener: (error: Error) => void): void {
    this.errorListener = listener;
  }

  onExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    this.exitListener = listener;
  }

  fail(error: Error): void {
    this.errorListener?.(error);
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitListener?.(code, signal);
  }
}

function encodeSamples(samples: number[]): Buffer {
  const bytes = Buffer.alloc(samples.length * Float32Array.BYTES_PER_ELEMENT);
  samples.forEach((sample, index) => bytes.writeFloatLE(sample, index * 4));
  return bytes;
}

describe("CaptureManager", () => {
  it("does not spawn until an explicit device is configured", () => {
    const factory = vi.fn();
    const capture = new CaptureManager({ processFactory: factory });

    capture.start();

    expect(factory).not.toHaveBeenCalled();
    expect(capture.getState()).toEqual({
      schemaVersion: 0,
      status: "configuration-required",
      detail: "Set A2_AUDIO_DEVICE to an explicit capture device.",
    });
  });

  it("passes the exact configured device and transforms the strict header", () => {
    const child = new FakeCaptureProcess();
    const factory = vi.fn(() => child);
    const capture = new CaptureManager({
      device: "Dante Virtual Soundcard (64x64)",
      captureBinary: "/opt/a2/device-capture",
      processFactory: factory,
    });

    capture.start();
    expect(factory).toHaveBeenCalledWith("/opt/a2/device-capture", [
      "--device",
      "Dante Virtual Soundcard (64x64)",
    ]);

    child.stdout.write(
      '{"schemaVersion":0,"deviceName":"DVS","sampleRateHz":48000,"channelCount":2}\n',
    );

    expect(capture.getState()).toEqual({
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

  it("preserves partial frames and emits bounded interleaved chunks", () => {
    const child = new FakeCaptureProcess();
    const capture = new CaptureManager({
      device: "Test Device",
      processFactory: () => child,
    });
    const chunks: CaptureAudioChunk[] = [];
    capture.on("audio", (chunk: CaptureAudioChunk) => chunks.push(chunk));
    capture.start();
    child.stdout.write(
      '{"schemaVersion":0,"deviceName":"Test","sampleRateHz":48000,"channelCount":2}\n',
    );

    const frames = Array.from(
      { length: (MAX_FRAMES_PER_CHUNK + 1) * 2 },
      (_, index) => index + 0.25,
    );
    const audio = encodeSamples(frames);
    child.stdout.write(audio.subarray(0, 3));
    expect(chunks).toHaveLength(0);
    child.stdout.write(audio.subarray(3));

    expect(chunks.map((chunk) => chunk.frameCount)).toEqual([
      MAX_FRAMES_PER_CHUNK,
      1,
    ]);
    expect(Buffer.concat(chunks.map((chunk) => chunk.interleaved))).toEqual(
      audio,
    );
  });

  it("fails closed on extra header fields", () => {
    const child = new FakeCaptureProcess();
    const capture = new CaptureManager({
      device: "Test Device",
      processFactory: () => child,
      restartDelaysMs: [],
    });
    capture.start();

    child.stdout.write(
      '{"schemaVersion":0,"deviceName":"Test","sampleRateHz":48000,"channelCount":2,"extra":true}\n',
    );

    expect(capture.getState()).toEqual({
      schemaVersion: 0,
      status: "error",
      detail: "Capture header fields do not match schema version 0.",
    });
    expect(child.stop).toHaveBeenCalledOnce();
  });

  it("restarts the same named device with backoff after the process exits", () => {
    vi.useFakeTimers();
    const children = [new FakeCaptureProcess(), new FakeCaptureProcess()];
    const factory = vi.fn(() => children[factory.mock.calls.length - 1]!);
    const capture = new CaptureManager({
      device: "Dante Virtual Soundcard",
      captureBinary: "/opt/a2/device-capture",
      processFactory: factory,
      restartDelaysMs: [1_000, 5_000],
    });

    capture.start();
    children[0]!.exit(1);
    expect(capture.getState()).toEqual({
      schemaVersion: 0,
      status: "error",
      detail: "Capture process exited (1). Retrying the same device in 1 s.",
    });
    expect(children[0]!.stop).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(999);
    expect(factory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenLastCalledWith("/opt/a2/device-capture", [
      "--device",
      "Dante Virtual Soundcard",
    ]);
    expect(capture.getState().status).toBe("starting");

    children[1]!.stdout.write(
      '{"schemaVersion":0,"deviceName":"DVS","sampleRateHz":48000,"channelCount":2}\n',
    );
    expect(capture.getState().status).toBe("ready");

    // A late exit from the replaced process must not fail the new capture.
    children[0]!.exit(1);
    expect(capture.getState().status).toBe("ready");
    capture.stop();
  });

  it("does not restart after an explicit stop", () => {
    vi.useFakeTimers();
    const child = new FakeCaptureProcess();
    const factory = vi.fn(() => child);
    const capture = new CaptureManager({
      device: "Test Device",
      processFactory: factory,
      restartDelaysMs: [1_000],
    });
    capture.start();
    child.exit(1);
    capture.stop();
    vi.advanceTimersByTime(60_000);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("opens the built-in test signal for the reserved device name without spawning", async () => {
    const factory = vi.fn();
    const capture = new CaptureManager({
      device: SIMULATED_DEVICE_NAME,
      processFactory: factory,
      simulatedChannels: 3,
    });
    const chunk = new Promise<CaptureAudioChunk>((resolve) =>
      capture.once("audio", resolve),
    );
    capture.start();
    const audio = await chunk;
    capture.stop();

    expect(factory).not.toHaveBeenCalled();
    expect(capture.simulated).toBe(true);
    expect(capture.getState()).toMatchObject({
      status: "ready",
      device: {
        name: SIMULATED_DEVICE_NAME,
        sampleRateHz: 48_000,
        channelCount: 3,
      },
    });
    expect(audio.channelCount).toBe(3);
    expect(audio.frameCount).toBeGreaterThan(0);
  });
});
