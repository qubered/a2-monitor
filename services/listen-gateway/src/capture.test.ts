import { Buffer } from "node:buffer";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  CaptureManager,
  MAX_FRAMES_PER_CHUNK,
  type CaptureAudioChunk,
  type CaptureProcess,
} from "./capture.js";

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
});
