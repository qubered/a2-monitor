import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

const EVENT_LINE_LIMIT_BYTES = 256 * 1024;
const OPEN_TIMEOUT_MS = 10_000;

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

export interface WorkerProcess {
  stdin: Writable;
  stdout: Readable;
  onError(listener: (error: Error) => void): void;
  onExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  stop(): void;
}

export type WorkerProcessFactory = (
  binary: string,
  args: readonly string[],
) => WorkerProcess;

export type MediaWorkerOptions = {
  device?: string;
  workerBinary?: string;
  captureBinary?: string;
  processFactory?: WorkerProcessFactory;
};

export type OpenSessionRequest = {
  sessionId: string;
  channel: number;
  offer: string;
  candidateAddress: string;
};

/** The worker refused an offer; `capacity` distinguishes load from a bad request. */
export class SessionRejectedError extends Error {
  readonly capacity: boolean;

  constructor(detail: string) {
    super(detail);
    this.name = "SessionRejectedError";
    this.capacity = detail === "listener capacity reached";
  }
}

type PendingOpen = {
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type WorkerEvent =
  | {
      type: "ready";
      deviceName: string;
      sampleRateHz: number;
      channelCount: number;
    }
  | { type: "answer"; sessionId: string; answer: string }
  | { type: "rejected"; sessionId: string; detail: string }
  | { type: "connected"; sessionId: string }
  | { type: "closed"; sessionId: string; reason: string }
  | { type: "stats"; sessions: number; droppedCaptureBlocks: number };

const EVENT_FIELDS: Readonly<Record<WorkerEvent["type"], readonly string[]>> = {
  ready: ["channelCount", "deviceName", "sampleRateHz", "type"],
  answer: ["answer", "sessionId", "type"],
  rejected: ["detail", "sessionId", "type"],
  connected: ["sessionId", "type"],
  closed: ["reason", "sessionId", "type"],
  stats: ["droppedCaptureBlocks", "sessions", "type"],
};

function defaultProcessFactory(
  binary: string,
  args: readonly string[],
): WorkerProcess {
  const child = spawn(binary, [...args], {
    // Worker and capture diagnostics go to the gateway's own stderr.
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });

  return {
    stdin: child.stdin,
    stdout: child.stdout,
    onError: (listener) => child.once("error", listener),
    onExit: (listener) => child.once("exit", listener),
    stop: () => {
      child.kill("SIGTERM");
    },
  };
}

function isCount(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

export function parseWorkerEvent(line: string): WorkerEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Media worker event is not valid JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Media worker event must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !Object.hasOwn(EVENT_FIELDS, type)) {
    throw new Error("Media worker event type is unsupported.");
  }
  const expected = EVENT_FIELDS[type as WorkerEvent["type"]];
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`Media worker ${type} event fields are invalid.`);
  }
  const text = (key: string) => {
    const field = record[key];
    if (typeof field !== "string" || field.length === 0) {
      throw new Error(`Media worker ${type} event ${key} is invalid.`);
    }
    return field;
  };

  switch (type) {
    case "ready": {
      const deviceName = text("deviceName");
      if (deviceName.length > 512) {
        throw new Error("Media worker ready event deviceName is invalid.");
      }
      if (record.sampleRateHz !== 48_000) {
        throw new Error("Media worker ready event sampleRateHz is invalid.");
      }
      if (!isCount(record.channelCount, 1, 256)) {
        throw new Error("Media worker ready event channelCount is invalid.");
      }
      return {
        type,
        deviceName,
        sampleRateHz: record.sampleRateHz,
        channelCount: record.channelCount,
      };
    }
    case "answer":
      return { type, sessionId: text("sessionId"), answer: text("answer") };
    case "rejected":
      return { type, sessionId: text("sessionId"), detail: text("detail") };
    case "connected":
      return { type, sessionId: text("sessionId") };
    case "closed":
      return { type, sessionId: text("sessionId"), reason: text("reason") };
    default: {
      if (
        !isCount(record.sessions, 0, 1_000) ||
        !isCount(record.droppedCaptureBlocks, 0, Number.MAX_SAFE_INTEGER)
      ) {
        throw new Error("Media worker stats event is invalid.");
      }
      return {
        type: "stats",
        sessions: record.sessions,
        droppedCaptureBlocks: record.droppedCaptureBlocks,
      };
    }
  }
}

/**
 * Supervises `pulse-media-worker`, which owns the capture child, Opus encoding and
 * WebRTC media. Audio never passes through this process: the gateway only relays
 * signaling and control lines.
 */
export class MediaWorkerManager extends EventEmitter {
  private state: DeviceState;
  private readonly device: string | undefined;
  private readonly workerBinary: string;
  private readonly captureBinary: string;
  private readonly processFactory: WorkerProcessFactory;
  private child: WorkerProcess | undefined;
  private lineBytes: Buffer[] = [];
  private lineLength = 0;
  private stopping = false;
  private readonly pending = new Map<string, PendingOpen>();
  private readonly sessions = new Set<string>();
  private droppedCaptureBlocks = 0;

  constructor(options: MediaWorkerOptions) {
    super();
    this.device = options.device;
    this.workerBinary =
      options.workerBinary ?? "target/debug/pulse-media-worker";
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

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
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
      this.child = this.processFactory(this.workerBinary, [
        "--capture-bin",
        this.captureBinary,
        "--device",
        this.device,
      ]);
    } catch {
      this.fail("Media worker could not be started.");
      return;
    }

    this.child.stdout.on("data", (data: Buffer | Uint8Array | string) => {
      this.consume(typeof data === "string" ? Buffer.from(data) : data);
    });
    this.child.stdin.on("error", () => {
      this.fail("Media worker control pipe closed.");
    });
    this.child.onError(() => {
      this.fail("Media worker could not be started.");
    });
    this.child.onExit((code, signal) => {
      if (this.stopping) return;
      const outcome = signal ?? (code === null ? "unknown" : String(code));
      this.fail(`Media worker exited (${outcome}).`);
    });
  }

  stop(): void {
    this.stopping = true;
    this.clearSessions(new Error("Media worker stopped."));
    this.child?.stdin.end();
    this.child?.stop();
    this.child = undefined;
  }

  openSession(request: OpenSessionRequest): Promise<string> {
    if (this.state.status !== "ready" || !this.child) {
      return Promise.reject(new SessionRejectedError("capture is not ready"));
    }
    if (this.pending.has(request.sessionId)) {
      return Promise.reject(new SessionRejectedError("session already exists"));
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.sessionId);
        this.send({ type: "close", sessionId: request.sessionId });
        reject(new Error("Media worker did not answer the offer in time."));
      }, OPEN_TIMEOUT_MS);
      this.pending.set(request.sessionId, { resolve, reject, timer });
      this.send({ type: "open", ...request });
    });
  }

  selectChannel(sessionId: string, channel: number): boolean {
    if (!this.sessions.has(sessionId)) return false;
    this.send({ type: "select", sessionId, channel });
    return true;
  }

  closeSession(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false;
    this.sessions.delete(sessionId);
    this.send({ type: "close", sessionId });
    return true;
  }

  private send(command: Record<string, unknown>): void {
    this.child?.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private setState(state: DeviceState): void {
    this.state = state;
    this.emit("state", state);
  }

  private clearSessions(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const sessionId of this.sessions)
      this.emit("session-closed", sessionId);
    this.sessions.clear();
  }

  private fail(detail: string): void {
    if (this.state.status === "error" || this.stopping) return;
    this.clearSessions(new Error(detail));
    this.setState({ schemaVersion: 0, status: "error", detail });
    this.child?.stop();
  }

  private consume(bytes: Uint8Array): void {
    let start = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== 0x0a) continue;
      this.lineBytes.push(Buffer.from(bytes.subarray(start, index)));
      const line = Buffer.concat(this.lineBytes).toString("utf8");
      this.lineBytes = [];
      this.lineLength = 0;
      start = index + 1;
      if (!this.handleLine(line)) return;
    }
    if (start < bytes.length) {
      this.lineLength += bytes.length - start;
      if (this.lineLength > EVENT_LINE_LIMIT_BYTES) {
        this.fail("Media worker event exceeds the size limit.");
        return;
      }
      this.lineBytes.push(Buffer.from(bytes.subarray(start)));
    }
  }

  private handleLine(line: string): boolean {
    if (this.state.status === "error" || this.stopping) return false;
    let event: WorkerEvent;
    try {
      event = parseWorkerEvent(line);
    } catch (error) {
      this.fail(
        error instanceof Error ? error.message : "Invalid media worker event.",
      );
      return false;
    }

    switch (event.type) {
      case "ready":
        this.setState({
          schemaVersion: 0,
          status: "ready",
          detail: "Capture is ready.",
          device: {
            name: event.deviceName,
            sampleRateHz: event.sampleRateHz,
            channelCount: event.channelCount,
          },
          channels: Array.from({ length: event.channelCount }, (_, index) => ({
            index,
            label: `Channel ${index + 1}`,
          })),
        });
        break;
      case "answer": {
        const pending = this.pending.get(event.sessionId);
        if (!pending) {
          // The open already timed out; release the worker-side session.
          this.send({ type: "close", sessionId: event.sessionId });
          break;
        }
        clearTimeout(pending.timer);
        this.pending.delete(event.sessionId);
        this.sessions.add(event.sessionId);
        pending.resolve(event.answer);
        break;
      }
      case "rejected": {
        const pending = this.pending.get(event.sessionId);
        if (!pending) break;
        clearTimeout(pending.timer);
        this.pending.delete(event.sessionId);
        pending.reject(new SessionRejectedError(event.detail));
        break;
      }
      case "connected":
        process.stderr.write(
          `a2-listen-gateway: listen session ${event.sessionId} connected\n`,
        );
        this.emit("session-connected", event.sessionId);
        break;
      case "closed":
        process.stderr.write(
          `a2-listen-gateway: listen session ${event.sessionId} closed (${event.reason})\n`,
        );
        if (this.sessions.delete(event.sessionId)) {
          this.emit("session-closed", event.sessionId);
        }
        break;
      case "stats":
        if (event.droppedCaptureBlocks > this.droppedCaptureBlocks) {
          process.stderr.write(
            `a2-listen-gateway: media worker dropped ${event.droppedCaptureBlocks - this.droppedCaptureBlocks} capture block(s)\n`,
          );
        }
        this.droppedCaptureBlocks = event.droppedCaptureBlocks;
        break;
    }
    return true;
  }
}
