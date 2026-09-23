import { parseMeterFrame } from "@rvlt/pulse-protocol/http";

/** The card trace window (design system §10.1). */
export const METER_HISTORY_MS = 10_000;
const MAX_FRAMES = 400;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000];

export type MeterConnection = "connecting" | "live" | "disconnected";

export type MeterReading = {
  peakDbfs: number;
  rmsDbfs: number;
  clipped: boolean;
};

type Frame = {
  atMs: number;
  intervalMs: number;
  peakDbfs: number[];
  rmsDbfs: number[];
  clipped: boolean[];
};

type WebSocketConstructor = new (url: string) => WebSocket;

export function meterUrl(location = window.location): string {
  const url = new URL(location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/audio/v0/meters";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Holds the last ten seconds of meter frames from the audio node's meter
 * stream, outside React state, so sixty-four card traces can redraw at the
 * data rate without re-rendering the grid. Listeners are told a new frame
 * arrived and read what they need.
 */
export class MeterStore {
  private frames: Frame[] = [];
  private readonly listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private reconnectTimer: number | undefined;
  private attempt = 0;
  private stopped = true;
  connection: MeterConnection = "disconnected";

  constructor(
    private readonly WebSocketClass: WebSocketConstructor | null = typeof window !==
    "undefined"
      ? window.WebSocket
      : null,
    private readonly now: () => number = () => performance.now(),
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
    }
    this.socket?.close();
    this.socket = null;
    this.setConnection("disconnected");
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Accepts one frame; exposed for tests and for the offline preview. */
  push(frame: Omit<Frame, "atMs">): void {
    const atMs = this.now();
    this.frames.push({ ...frame, atMs });
    const cutoff = atMs - METER_HISTORY_MS;
    while (
      this.frames.length > MAX_FRAMES ||
      (this.frames[0] && this.frames[0].atMs < cutoff)
    ) {
      this.frames.shift();
    }
    for (const listener of this.listeners) listener();
  }

  /** The latest reading for one input, or null when nothing recent is known. */
  latest(input: number): MeterReading | null {
    const frame = this.frames.at(-1);
    if (!frame || this.now() - frame.atMs > 1_000) return null;
    const peakDbfs = frame.peakDbfs[input];
    const rmsDbfs = frame.rmsDbfs[input];
    if (peakDbfs === undefined || rmsDbfs === undefined) return null;
    return { peakDbfs, rmsDbfs, clipped: frame.clipped[input] ?? false };
  }

  /**
   * Peak per bucket across the trailing window, oldest first. A bucket with
   * no frame is null, which the trace draws as a gap rather than as silence.
   */
  trace(input: number, buckets: number): Array<number | null> {
    const end = this.now();
    const start = end - METER_HISTORY_MS;
    const width = METER_HISTORY_MS / buckets;
    const values: Array<number | null> = Array.from(
      { length: buckets },
      () => null,
    );
    for (const frame of this.frames) {
      if (frame.atMs < start) continue;
      const peak = frame.peakDbfs[input];
      if (peak === undefined) continue;
      const bucket = Math.min(
        buckets - 1,
        Math.floor((frame.atMs - start) / width),
      );
      const current = values[bucket];
      values[bucket] =
        current === null || current === undefined
          ? peak
          : Math.max(current, peak);
    }
    return values;
  }

  private setConnection(connection: MeterConnection): void {
    if (this.connection === connection) return;
    this.connection = connection;
    for (const listener of this.listeners) listener();
  }

  private connect(): void {
    if (this.stopped || !this.WebSocketClass) return;
    this.setConnection("connecting");
    const socket = new this.WebSocketClass(meterUrl());
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const frame = parseMeterFrame(JSON.parse(event.data));
        this.setConnection("live");
        this.push({
          intervalMs: frame.intervalMs,
          peakDbfs: frame.peakDbfs,
          rmsDbfs: frame.rmsDbfs,
          clipped: frame.clipped,
        });
      } catch {
        // A malformed frame is dropped, never drawn.
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setConnection("disconnected");
      if (this.stopped) return;
      const delay =
        RECONNECT_DELAYS_MS[
          Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)
        ]!;
      this.attempt += 1;
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
  }
}
