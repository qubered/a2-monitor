import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import type { MeterReading } from "./levels.js";

const EVENT_LINE_LIMIT_BYTES = 256 * 1024;
const OPEN_TIMEOUT_MS = 10_000;
/** Frames in one worker block (10 ms at 48 kHz). */
const FRAMES_PER_WORKER_BLOCK = 480;
/**
 * Reserved device name that makes `pulse-device-capture` generate the built-in
 * test signal instead of opening a physical input (ADR 0027). It is always
 * reported as simulated.
 */
export const SIMULATED_DEVICE_NAME = "Pulse test signal";
/** Restart delays for the same explicitly named device. Capture never falls back to another device. */
export const RESTART_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
/** A worker that stays ready this long resets the restart backoff. */
const STABLE_WORKER_MS = 30_000;

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
  /**
   * Host monitor output (ADR 0031): all three are set together or not at all.
   * `outputChannels` are the default single feed's channels, used when the
   * production defines no feeds.
   */
  outputDevice?: string;
  outputChannels?: readonly number[];
  outputBinary?: string;
  processFactory?: WorkerProcessFactory;
  restartDelaysMs?: readonly number[];
  now?: () => number;
};

/** One input in a listener's mix, at the linear gain of its channel trim. */
export type ListenSource = { channel: number; gain: number };

export type OpenSessionRequest = {
  sessionId: string;
  /** What the listener hears: inputs summed on the node; none is silence. */
  sources: ListenSource[];
  offer: string;
  candidateAddress: string;
};

/**
 * Reserved output device name that makes `pulse-device-output` accept and discard the
 * host monitor feed without opening a device (ADR 0031). It is always reported as simulated.
 */
export const SIMULATED_OUTPUT_DEVICE_NAME = "Pulse simulated output";

/** Host monitor output as the worker last reported it. */
export type HostOutputState = {
  status: "starting" | "ready" | "error";
  detail: string;
  deviceName: string;
  /** Output channels the device has, once it has opened. */
  channelCount: number | null;
  /** 1-based channels per feed mix, in mix order. */
  routes: number[][];
  simulated: boolean;
  underruns: number;
  droppedFrames: number;
};

/** One feed's shared mix the worker renders: one input (or none) at one linear gain. */
export type MonitorCommand = { channel: number | null; gain: number };

/** Highest linear monitor gain the worker accepts: +48 dB, a +24 dB trim under a +24 dB level. */
export const MAX_MONITOR_GAIN = 251.188_643;

/** Parses a comma-separated list of distinct 1-based output channel numbers. */
export function parseOutputChannels(value: string): number[] {
  const channels = value.split(",").map((part) => {
    const trimmed = part.trim();
    const number = Number(trimmed);
    if (!/^\d+$/.test(trimmed) || number < 1 || number > 256) {
      throw new Error(
        `Output channel ${JSON.stringify(part)} is not a number from 1 to 256.`,
      );
    }
    return number;
  });
  if (new Set(channels).size !== channels.length) {
    throw new Error("Output channels must be distinct.");
  }
  if (channels.length > 8) {
    throw new Error("At most 8 output channels can carry one feed.");
  }
  return channels;
}

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
  | ({ type: "meters" } & MeterReading)
  | {
      type: "stats";
      sessions: number;
      droppedCaptureBlocks: number;
      droppedCaptureCallbacks: number;
    }
  | {
      type: "output-ready";
      deviceName: string;
      channelCount: number;
      outputRoutes: number[][];
    }
  | {
      type: "output-stats";
      underruns: number;
      skippedFrames: number;
      overflowFrames: number;
      droppedBlocks: number;
    }
  | { type: "output-failed"; detail: string; retryInMs: number };

const EVENT_FIELDS: Readonly<Record<WorkerEvent["type"], readonly string[]>> = {
  ready: ["channelCount", "deviceName", "sampleRateHz", "type"],
  answer: ["answer", "sessionId", "type"],
  rejected: ["detail", "sessionId", "type"],
  connected: ["sessionId", "type"],
  closed: ["reason", "sessionId", "type"],
  meters: [
    "clippedSamples",
    "intervalMs",
    "peakDbfs",
    "rmsDbfs",
    "sequence",
    "type",
  ],
  stats: [
    "droppedCaptureBlocks",
    "droppedCaptureCallbacks",
    "sessions",
    "type",
  ],
  "output-ready": ["channelCount", "deviceName", "outputRoutes", "type"],
  "output-stats": [
    "droppedBlocks",
    "overflowFrames",
    "skippedFrames",
    "type",
    "underruns",
  ],
  "output-failed": ["detail", "retryInMs", "type"],
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

function levelArray(value: unknown, field: string): number[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 256 ||
    !value.every(
      (level) => typeof level === "number" && level >= -120 && level <= 0,
    )
  ) {
    throw new Error(`Media worker meters event ${field} is invalid.`);
  }
  return value as number[];
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
    case "meters": {
      const peakDbfs = levelArray(record.peakDbfs, "peakDbfs");
      const rmsDbfs = levelArray(record.rmsDbfs, "rmsDbfs");
      const clippedSamples = record.clippedSamples;
      if (
        !Array.isArray(clippedSamples) ||
        clippedSamples.length !== peakDbfs.length ||
        rmsDbfs.length !== peakDbfs.length ||
        !clippedSamples.every((count) => isCount(count, 0, 4_294_967_295))
      ) {
        throw new Error("Media worker meters event clippedSamples is invalid.");
      }
      if (
        !isCount(record.sequence, 0, Number.MAX_SAFE_INTEGER) ||
        !isCount(record.intervalMs, 10, 1_000)
      ) {
        throw new Error("Media worker meters event is invalid.");
      }
      return {
        type,
        sequence: record.sequence,
        intervalMs: record.intervalMs,
        peakDbfs,
        rmsDbfs,
        clippedSamples: clippedSamples as number[],
      };
    }
    case "output-ready": {
      const deviceName = text("deviceName");
      if (deviceName.length > 512) {
        throw new Error(
          "Media worker output-ready event deviceName is invalid.",
        );
      }
      if (!isCount(record.channelCount, 1, 256)) {
        throw new Error(
          "Media worker output-ready event channelCount is invalid.",
        );
      }
      const channelCount = record.channelCount;
      const outputRoutes = record.outputRoutes;
      if (
        !Array.isArray(outputRoutes) ||
        outputRoutes.length < 1 ||
        outputRoutes.length > 8 ||
        !outputRoutes.every(
          (route) =>
            Array.isArray(route) &&
            route.length >= 1 &&
            route.length <= 8 &&
            route.every((channel) => isCount(channel, 1, channelCount)),
        )
      ) {
        throw new Error(
          "Media worker output-ready event outputRoutes is invalid.",
        );
      }
      return {
        type,
        deviceName,
        channelCount,
        outputRoutes: outputRoutes as number[][],
      };
    }
    case "output-stats": {
      const counters = [
        record.underruns,
        record.skippedFrames,
        record.overflowFrames,
        record.droppedBlocks,
      ];
      if (
        !counters.every((value) => isCount(value, 0, Number.MAX_SAFE_INTEGER))
      ) {
        throw new Error("Media worker output-stats event is invalid.");
      }
      return {
        type,
        underruns: record.underruns as number,
        skippedFrames: record.skippedFrames as number,
        overflowFrames: record.overflowFrames as number,
        droppedBlocks: record.droppedBlocks as number,
      };
    }
    case "output-failed": {
      if (!isCount(record.retryInMs, 0, 3_600_000)) {
        throw new Error("Media worker output-failed event is invalid.");
      }
      return { type, detail: text("detail"), retryInMs: record.retryInMs };
    }
    default: {
      if (
        !isCount(record.sessions, 0, 1_000) ||
        !isCount(record.droppedCaptureBlocks, 0, Number.MAX_SAFE_INTEGER) ||
        !isCount(record.droppedCaptureCallbacks, 0, Number.MAX_SAFE_INTEGER)
      ) {
        throw new Error("Media worker stats event is invalid.");
      }
      return {
        type: "stats",
        sessions: record.sessions,
        droppedCaptureBlocks: record.droppedCaptureBlocks,
        droppedCaptureCallbacks: record.droppedCaptureCallbacks,
      };
    }
  }
}

/**
 * Supervises `pulse-media-worker`, which owns the capture child, metering, Opus
 * encoding and WebRTC media. Audio never passes through this process: the gateway
 * only relays signaling, control lines and meter readings. A failed worker is
 * restarted on the same named device with bounded backoff.
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
  private droppedCaptureCallbacks = 0;
  private readonly restartDelaysMs: readonly number[];
  private readonly now: () => number;
  private restartAttempt = 0;
  private restartTimer: NodeJS.Timeout | undefined;
  private readyAtMs: number | undefined;
  private readonly outputDevice: string | undefined;
  /** The app/env channels of the default single feed. */
  private readonly defaultOutputChannels: readonly number[];
  /** One route per feed in effect: the production's, else the default. */
  private outputRoutes: number[][];
  private readonly outputBinary: string;
  private outputState: HostOutputState | null;
  /** Each feed's mix, by mix index. */
  private monitors: MonitorCommand[] = [];

  constructor(options: MediaWorkerOptions) {
    super();
    this.device = options.device;
    this.workerBinary =
      options.workerBinary ?? "target/debug/pulse-media-worker";
    this.captureBinary =
      options.captureBinary ?? "target/debug/pulse-device-capture";
    this.processFactory = options.processFactory ?? defaultProcessFactory;
    this.restartDelaysMs = options.restartDelaysMs ?? RESTART_DELAYS_MS;
    this.now = options.now ?? Date.now;
    this.outputDevice = options.outputDevice || undefined;
    this.defaultOutputChannels = options.outputChannels ?? [];
    this.outputRoutes = [[...this.defaultOutputChannels]];
    this.outputBinary =
      options.outputBinary ?? "target/debug/pulse-device-output";
    if (
      this.outputDevice !== undefined &&
      this.defaultOutputChannels.length === 0
    ) {
      throw new Error(
        "A host output device needs at least one output channel.",
      );
    }
    this.outputState =
      this.outputDevice === undefined
        ? null
        : {
            status: "starting",
            detail: "Waiting for the audio node.",
            deviceName: this.outputDevice,
            channelCount: null,
            routes: this.outputRoutes.map((route) => [...route]),
            simulated: this.outputDevice === SIMULATED_OUTPUT_DEVICE_NAME,
            underruns: 0,
            droppedFrames: 0,
          };
    this.state = {
      schemaVersion: 0,
      status: "configuration-required",
      detail: "Set A2_AUDIO_DEVICE to an explicit capture device.",
    };
  }

  /** Audio lost since the worker (and its capture) last started. */
  getDropouts(): { callbacks: number; blocks: number } {
    return {
      callbacks: this.droppedCaptureCallbacks,
      blocks: this.droppedCaptureBlocks,
    };
  }

  getState(): DeviceState {
    return this.state;
  }

  /** True when the configured device is the built-in test signal, not a physical input. */
  get simulated(): boolean {
    return this.device === SIMULATED_DEVICE_NAME;
  }

  /** Host monitor output state, or null when no output device is configured. */
  getOutputState(): HostOutputState | null {
    return this.outputState;
  }

  /**
   * Sets one feed's shared mix. It is remembered and re-sent whenever the
   * worker or its output restarts, so the output resumes the shared state
   * rather than silence.
   */
  setMonitor(mix: number, command: MonitorCommand): void {
    if (mix < 0 || mix >= this.outputRoutes.length) return;
    this.monitors[mix] = {
      channel: command.channel,
      gain: Math.min(MAX_MONITOR_GAIN, Math.max(0, command.gain)),
    };
    if (this.outputState && this.state.status === "ready") {
      this.send({ type: "monitor", mix, ...this.monitors[mix] });
    }
  }

  /** The default single feed's channels (app/env). */
  getDefaultOutputChannels(): number[] {
    return [...this.defaultOutputChannels];
  }

  /** The routes in effect: one list of 1-based channels per feed. */
  getOutputRoutes(): number[][] {
    return this.outputRoutes.map((route) => [...route]);
  }

  /**
   * Applies the active production's host output feeds as routes, one per
   * mix (ADR 0031), or the node's default single feed when it sets none.
   * A change reopens only the output device; capture and listeners carry on.
   * Callers re-send each feed's mix afterwards.
   */
  setOutputRoutes(
    routes: readonly (readonly number[])[] | null | undefined,
  ): void {
    if (!this.outputState) return;
    const next = routes?.length
      ? routes.map((route) => [...route])
      : [[...this.defaultOutputChannels]];
    if (JSON.stringify(next) === JSON.stringify(this.outputRoutes)) return;
    this.outputRoutes = next;
    this.monitors = this.monitors.slice(0, next.length);
    this.setOutputState({
      status: "starting",
      detail: "Reopening the output on the saved feeds.",
      routes: next.map((route) => [...route]),
    });
    if (this.child && this.state.status === "ready") {
      this.send({ type: "output-routes", routes: next });
    }
  }

  /** Sends the routes, then every feed's mix, to a ready worker. */
  private syncOutput(): void {
    if (!this.outputState) return;
    this.send({ type: "output-routes", routes: this.outputRoutes });
    this.monitors.forEach((monitor, mix) => {
      if (monitor) this.send({ type: "monitor", mix, ...monitor });
    });
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  start(): void {
    if (this.child || this.stopping || this.restartTimer) return;
    if (this.device === undefined || this.device.length === 0) return;

    this.setState({
      schemaVersion: 0,
      status: "starting",
      detail: `Opening configured device ${JSON.stringify(this.device)}.`,
    });
    this.lineBytes = [];
    this.lineLength = 0;

    this.setOutputState({
      status: "starting",
      detail: "Waiting for the audio node.",
      underruns: 0,
      droppedFrames: 0,
    });
    let child: WorkerProcess;
    try {
      child = this.processFactory(this.workerBinary, [
        "--capture-bin",
        this.captureBinary,
        "--device",
        this.device,
        ...(this.outputDevice === undefined
          ? []
          : [
              "--output-bin",
              this.outputBinary,
              "--output-device",
              this.outputDevice,
              "--output-routes",
              this.outputRoutes.map((route) => route.join(",")).join(";"),
            ]),
      ]);
    } catch {
      this.fail("Media worker could not be started.");
      return;
    }
    this.child = child;

    child.stdout.on("data", (data: Buffer | Uint8Array | string) => {
      if (this.child !== child) return;
      this.consume(typeof data === "string" ? Buffer.from(data) : data);
    });
    child.stdin.on("error", () => {
      if (this.child !== child) return;
      this.fail("Media worker control pipe closed.");
    });
    child.onError(() => {
      if (this.child !== child) return;
      this.fail("Media worker could not be started.");
    });
    child.onExit((code, signal) => {
      if (this.stopping || this.child !== child) return;
      const outcome = signal ?? (code === null ? "unknown" : String(code));
      this.fail(`Media worker exited (${outcome}).`);
    });
  }

  stop(): void {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
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

  /** Changes what a listener hears; the node crossfades, nothing renegotiates. */
  selectSources(sessionId: string, sources: ListenSource[]): boolean {
    if (!this.sessions.has(sessionId)) return false;
    this.send({ type: "select", sessionId, sources });
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

  private setOutputState(
    change: Partial<
      Pick<
        HostOutputState,
        | "status"
        | "detail"
        | "underruns"
        | "droppedFrames"
        | "routes"
        | "channelCount"
      >
    >,
  ): void {
    if (!this.outputState) return;
    this.outputState = { ...this.outputState, ...change };
    this.emit("output", this.outputState);
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

  /** Stops the failed worker and schedules a bounded restart of the same named device. */
  private fail(detail: string): void {
    if (this.stopping || this.restartTimer) return;
    const child = this.child;
    this.child = undefined;
    this.clearSessions(new Error(detail));
    child?.stop();

    if (
      this.readyAtMs !== undefined &&
      this.now() - this.readyAtMs >= STABLE_WORKER_MS
    ) {
      this.restartAttempt = 0;
    }
    this.readyAtMs = undefined;
    this.setOutputState({
      status: "error",
      detail: "The audio node stopped, so the host output is silent.",
    });
    const delayMs =
      this.restartDelaysMs[
        Math.min(this.restartAttempt, this.restartDelaysMs.length - 1)
      ];
    this.restartAttempt += 1;
    if (delayMs === undefined) {
      this.setState({ schemaVersion: 0, status: "error", detail });
      return;
    }
    this.setState({
      schemaVersion: 0,
      status: "error",
      detail: `${detail} Retrying the same device in ${Math.round(delayMs / 1000)} s.`,
    });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.start();
    }, delayMs);
    this.restartTimer.unref?.();
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
    if (!this.child || this.stopping) return false;
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
        this.readyAtMs = this.now();
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
        // A restarted worker starts silent; give it the routes (a no-op when
        // they did not change while it was starting) and every shared mix.
        this.syncOutput();
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
      case "meters":
        this.emit("meters", {
          sequence: event.sequence,
          intervalMs: event.intervalMs,
          peakDbfs: event.peakDbfs,
          rmsDbfs: event.rmsDbfs,
          clippedSamples: event.clippedSamples,
        } satisfies MeterReading);
        break;
      case "stats":
        if (event.droppedCaptureBlocks > this.droppedCaptureBlocks) {
          process.stderr.write(
            `a2-listen-gateway: media worker dropped ${event.droppedCaptureBlocks - this.droppedCaptureBlocks} capture block(s)\n`,
          );
        }
        if (event.droppedCaptureCallbacks > this.droppedCaptureCallbacks) {
          process.stderr.write(
            `a2-listen-gateway: capture dropped ${event.droppedCaptureCallbacks - this.droppedCaptureCallbacks} device callback(s)\n`,
          );
        }
        this.droppedCaptureBlocks = event.droppedCaptureBlocks;
        this.droppedCaptureCallbacks = event.droppedCaptureCallbacks;
        break;
      case "output-ready":
        this.setOutputState({
          status: "ready",
          detail: `${event.deviceName} is open: ${event.outputRoutes.length} ${event.outputRoutes.length === 1 ? "feed" : "feeds"} on ${event.outputRoutes.flat().length} of ${event.channelCount} outputs.`,
          routes: event.outputRoutes,
          channelCount: event.channelCount,
          underruns: 0,
          droppedFrames: 0,
        });
        break;
      case "output-stats": {
        const droppedFrames =
          event.skippedFrames +
          event.overflowFrames +
          event.droppedBlocks * FRAMES_PER_WORKER_BLOCK;
        if (this.outputState && event.underruns > this.outputState.underruns) {
          process.stderr.write(
            `a2-listen-gateway: host output underran ${event.underruns - this.outputState.underruns} time(s)\n`,
          );
        }
        this.setOutputState({ underruns: event.underruns, droppedFrames });
        break;
      }
      case "output-failed":
        process.stderr.write(
          `a2-listen-gateway: host output failed: ${event.detail}\n`,
        );
        this.setOutputState({
          status: "error",
          detail: `${event.detail.slice(0, 160)}. Retrying in ${Math.max(1, Math.round(event.retryInMs / 1000))} s.`,
        });
        break;
    }
    return true;
  }
}
