import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

const HEADER_LIMIT_BYTES = 16 * 1024;
export const MAX_FRAMES_PER_CHUNK = 480;

export type DeviceChannel = {
  index: number;
  label: string;
};

export type DeviceState =
  | {
      schemaVersion: 0;
      status: "configuration-required" | "starting" | "error";
      detail: string;
    }
  | {
      schemaVersion: 0;
      status: "ready";
      detail: string;
      device: {
        name: string;
        sampleRateHz: number;
        channelCount: number;
      };
      channels: DeviceChannel[];
    };

type CaptureHeader = {
  schemaVersion: 0;
  deviceName: string;
  sampleRateHz: number;
  channelCount: number;
};

export type CaptureAudioChunk = {
  interleaved: Buffer;
  frameCount: number;
  channelCount: number;
};

export interface CaptureProcess {
  stdout: Readable;
  onError(listener: (error: Error) => void): void;
  onExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  stop(): void;
}

export type CaptureProcessFactory = (
  binary: string,
  args: readonly string[],
) => CaptureProcess;

export type CaptureManagerOptions = {
  device?: string;
  captureBinary?: string;
  processFactory?: CaptureProcessFactory;
};

function defaultProcessFactory(
  binary: string,
  args: readonly string[],
): CaptureProcess {
  const child = spawn(binary, [...args], {
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });

  return {
    stdout: child.stdout,
    onError: (listener) => child.once("error", listener),
    onExit: (listener) => child.once("exit", listener),
    stop: () => {
      child.kill("SIGTERM");
    },
  };
}

function parseHeader(line: Buffer): CaptureHeader {
  let value: unknown;
  try {
    value = JSON.parse(line.toString("utf8"));
  } catch {
    throw new Error("Capture header is not valid JSON.");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Capture header must be a JSON object.");
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = [
    "channelCount",
    "deviceName",
    "sampleRateHz",
    "schemaVersion",
  ];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("Capture header fields do not match schema version 0.");
  }
  if (record.schemaVersion !== 0) {
    throw new Error("Capture header schemaVersion must be 0.");
  }
  if (
    typeof record.deviceName !== "string" ||
    record.deviceName.length === 0 ||
    record.deviceName.length > 512
  ) {
    throw new Error("Capture header deviceName is invalid.");
  }
  if (
    !Number.isInteger(record.sampleRateHz) ||
    (record.sampleRateHz as number) < 8_000 ||
    (record.sampleRateHz as number) > 384_000
  ) {
    throw new Error("Capture header sampleRateHz is invalid.");
  }
  if (
    !Number.isInteger(record.channelCount) ||
    (record.channelCount as number) < 1 ||
    (record.channelCount as number) > 256
  ) {
    throw new Error("Capture header channelCount is invalid.");
  }

  return {
    schemaVersion: 0,
    deviceName: record.deviceName,
    sampleRateHz: record.sampleRateHz as number,
    channelCount: record.channelCount as number,
  };
}

export class CaptureManager extends EventEmitter {
  private state: DeviceState;
  private readonly device: string | undefined;
  private readonly captureBinary: string;
  private readonly processFactory: CaptureProcessFactory;
  private child: CaptureProcess | undefined;
  private headerBytes = Buffer.alloc(0);
  private partialFrame = Buffer.alloc(0);
  private header: CaptureHeader | undefined;
  private stopping = false;

  constructor(options: CaptureManagerOptions) {
    super();
    this.device = options.device;
    this.captureBinary =
      options.captureBinary ?? "target/debug/pulse-device-capture";
    this.processFactory = options.processFactory ?? defaultProcessFactory;
    this.state = {
      schemaVersion: 0,
      status: "configuration-required",
      detail: "Set A2_AUDIO_DEVICE to an explicit capture device.",
    };
  }

  getState(): DeviceState {
    return this.state;
  }

  start(): void {
    if (this.child || this.stopping) return;
    if (this.device === undefined || this.device.length === 0) return;

    this.setState({
      schemaVersion: 0,
      status: "starting",
      detail: `Opening configured device ${JSON.stringify(this.device)}.`,
    });

    try {
      this.child = this.processFactory(this.captureBinary, [
        "--device",
        this.device,
      ]);
    } catch {
      this.fail("Capture process could not be started.");
      return;
    }

    this.child.stdout.on("data", (data: Buffer | Uint8Array | string) => {
      const bytes =
        typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
      this.consume(bytes);
    });
    this.child.onError(() => {
      this.fail("Capture process could not be started.");
    });
    this.child.onExit((code, signal) => {
      if (this.stopping) return;
      const outcome = signal ?? (code === null ? "unknown" : String(code));
      this.fail(`Capture process exited (${outcome}).`);
    });
  }

  stop(): void {
    this.stopping = true;
    this.child?.stop();
    this.child = undefined;
  }

  private setState(state: DeviceState): void {
    this.state = state;
    this.emit("state", state);
  }

  private fail(detail: string): void {
    if (this.state.status === "error" || this.stopping) return;
    this.setState({ schemaVersion: 0, status: "error", detail });
    this.child?.stop();
  }

  private consume(bytes: Buffer): void {
    if (this.state.status === "error" || this.stopping) return;

    if (!this.header) {
      const newlineInBytes = bytes.indexOf(0x0a);
      if (newlineInBytes === -1) {
        if (this.headerBytes.length + bytes.length > HEADER_LIMIT_BYTES) {
          this.fail("Capture header exceeds the size limit.");
          return;
        }
        this.headerBytes = Buffer.concat([this.headerBytes, bytes]);
        return;
      }

      if (this.headerBytes.length + newlineInBytes > HEADER_LIMIT_BYTES) {
        this.fail("Capture header exceeds the size limit.");
        return;
      }

      const line = Buffer.concat([
        this.headerBytes,
        bytes.subarray(0, newlineInBytes),
      ]);
      this.headerBytes = Buffer.alloc(0);
      try {
        this.header = parseHeader(line);
      } catch (error) {
        this.fail(
          error instanceof Error ? error.message : "Invalid capture header.",
        );
        return;
      }

      const channels = Array.from(
        { length: this.header.channelCount },
        (_, index) => ({ index, label: `Channel ${index + 1}` }),
      );
      this.setState({
        schemaVersion: 0,
        status: "ready",
        detail: "Capture is ready.",
        device: {
          name: this.header.deviceName,
          sampleRateHz: this.header.sampleRateHz,
          channelCount: this.header.channelCount,
        },
        channels,
      });

      bytes = bytes.subarray(newlineInBytes + 1);
    }

    if (bytes.length > 0) this.consumeAudio(bytes);
  }

  private consumeAudio(bytes: Buffer): void {
    const header = this.header;
    if (!header) return;

    const frameBytes = header.channelCount * Float32Array.BYTES_PER_ELEMENT;
    const available =
      this.partialFrame.length === 0
        ? bytes
        : Buffer.concat([this.partialFrame, bytes]);
    const completeFrames = Math.floor(available.length / frameBytes);

    let frameOffset = 0;
    while (frameOffset < completeFrames) {
      const frameCount = Math.min(
        MAX_FRAMES_PER_CHUNK,
        completeFrames - frameOffset,
      );
      const start = frameOffset * frameBytes;
      const end = start + frameCount * frameBytes;
      const chunk: CaptureAudioChunk = {
        interleaved: available.subarray(start, end),
        frameCount,
        channelCount: header.channelCount,
      };
      this.emit("audio", chunk);
      frameOffset += frameCount;
    }

    const consumedBytes = completeFrames * frameBytes;
    this.partialFrame = Buffer.from(available.subarray(consumedBytes));
  }
}
