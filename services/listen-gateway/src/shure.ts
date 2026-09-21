import { createConnection, isIP, type Socket } from "node:net";
import type { ShureTelemetry } from "@a2-monitor/protocol/http";

const MAX_BUFFER_BYTES = 64 * 1024;
const STALE_AFTER_MS = 15_000;

export type ShureMonitorOptions = {
  host?: string;
  port?: number;
  channelCount?: number;
};

export type ShureFrame = {
  channelIndex?: number;
  property: string;
  value: string;
};

export class ShureFrameParser {
  private buffer = "";

  push(chunk: Buffer | string): ShureFrame[] {
    this.buffer += chunk.toString();
    if (Buffer.byteLength(this.buffer) > MAX_BUFFER_BYTES) {
      this.buffer = "";
      throw new Error("Shure command-string buffer exceeded 64 KiB.");
    }
    const frames: ShureFrame[] = [];
    while (true) {
      const start = this.buffer.indexOf("<");
      const end = start < 0 ? -1 : this.buffer.indexOf(">", start + 1);
      if (start < 0 || end < 0) {
        if (start > 0) this.buffer = this.buffer.slice(start);
        break;
      }
      const raw = this.buffer.slice(start, end + 1);
      this.buffer = this.buffer.slice(end + 1);
      const match =
        /^<\s*REP\s+(?:(\d+)\s+)?([A-Z0-9_]+)(?:\s+(.+?))?\s*>$/.exec(raw);
      if (!match?.[2]) continue;
      const oneBased = match[1] === undefined ? undefined : Number(match[1]);
      if (
        oneBased !== undefined &&
        (!Number.isInteger(oneBased) || oneBased < 1)
      )
        continue;
      frames.push({
        ...(oneBased === undefined ? {} : { channelIndex: oneBased - 1 }),
        property: match[2],
        value: (match[3] ?? "")
          .trim()
          .replace(/^\{(.*)\}$/, "$1")
          .trim(),
      });
    }
    return frames;
  }
}

function emptyChannel(index: number): ShureTelemetry["channels"][number] {
  return {
    index,
    batteryBars: null,
    batteryChargePercent: null,
    observedAtUtc: null,
    availability: "unavailable",
  };
}

export class ShureMonitor {
  private readonly host?: string;
  private readonly port: number;
  private readonly channelCount: number;
  private socket?: Socket;
  private reconnectTimer?: NodeJS.Timeout;
  private staleTimer?: NodeJS.Timeout;
  private closed = false;
  private reconnectDelayMs = 500;
  private state: ShureTelemetry;

  constructor(options: ShureMonitorOptions = {}) {
    if (
      options.port !== undefined &&
      (!Number.isInteger(options.port) ||
        options.port < 1 ||
        options.port > 65_535)
    ) {
      throw new Error("A2_SHURE_PORT must be an integer from 1 to 65535.");
    }
    if (
      options.channelCount !== undefined &&
      (!Number.isInteger(options.channelCount) ||
        options.channelCount < 1 ||
        options.channelCount > 128)
    ) {
      throw new Error("A2_SHURE_CHANNELS must be an integer from 1 to 128.");
    }
    this.host = options.host;
    this.port = options.port ?? 2202;
    this.channelCount = options.channelCount ?? 4;
    this.state = {
      schemaVersion: "0",
      status: this.host ? "connecting" : "unconfigured",
      detail: this.host
        ? "Connecting to the configured Shure receiver."
        : "No Shure receiver is configured.",
      receiver: this.host
        ? {
            host: this.host,
            model: null,
            firmware: null,
            compatibility: "compatible-read-only",
          }
        : null,
      channels: this.host
        ? Array.from({ length: this.channelCount }, (_, index) =>
            emptyChannel(index),
          )
        : [],
    };
  }

  start(): void {
    if (!this.host || this.closed) return;
    if (isIP(this.host) === 0) {
      this.state = {
        ...this.state,
        status: "error",
        detail: "Shure host must be an explicit IP address.",
      };
      return;
    }
    this.connect();
  }

  getState(): ShureTelemetry {
    return structuredClone(this.state);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.socket?.destroy();
  }

  private connect(): void {
    if (!this.host || this.closed) return;
    this.state = {
      ...this.state,
      status: "connecting",
      detail: "Connecting to the configured Shure receiver.",
    };
    const parser = new ShureFrameParser();
    const socket = createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setKeepAlive(true, 5_000);
    socket.setTimeout(20_000, () =>
      socket.destroy(new Error("Shure receiver timed out.")),
    );
    socket.on("connect", () => {
      this.reconnectDelayMs = 500;
      socket.write("< GET MODEL >\r\n< GET FW_VER >\r\n");
      for (let channel = 1; channel <= this.channelCount; channel += 1) {
        socket.write(
          `< GET ${channel} BATT_BARS >\r\n< GET ${channel} BATT_CHARGE >\r\n`,
        );
      }
      this.state = {
        ...this.state,
        status: "ready",
        detail:
          "Read-only Shure connection is active; waiting for battery reports.",
      };
    });
    socket.on("data", (chunk) => {
      try {
        for (const frame of parser.push(chunk)) this.apply(frame);
      } catch (error) {
        socket.destroy(error as Error);
      }
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      if (this.closed) return;
      this.state = {
        ...this.state,
        status: "stale",
        detail:
          "Shure receiver disconnected; retained battery values are stale.",
        channels: this.state.channels.map((channel) => ({
          ...channel,
          availability:
            channel.observedAtUtc === null ? "unavailable" : "stale",
        })),
      };
      this.reconnectTimer = setTimeout(
        () => this.connect(),
        this.reconnectDelayMs,
      );
      this.reconnectTimer.unref();
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
    });
  }

  private apply(frame: ShureFrame): void {
    if (frame.property === "MODEL" && this.state.receiver) {
      this.state = {
        ...this.state,
        receiver: { ...this.state.receiver, model: frame.value || null },
      };
      return;
    }
    if (frame.property === "FW_VER" && this.state.receiver) {
      this.state = {
        ...this.state,
        receiver: { ...this.state.receiver, firmware: frame.value || null },
      };
      return;
    }
    if (
      frame.channelIndex === undefined ||
      frame.channelIndex >= this.state.channels.length ||
      (frame.property !== "BATT_BARS" && frame.property !== "BATT_CHARGE")
    ) {
      return;
    }
    const numeric = Number(frame.value);
    const valid =
      Number.isInteger(numeric) &&
      (frame.property === "BATT_BARS"
        ? numeric >= 0 && numeric <= 5
        : numeric >= 0 && numeric <= 100);
    if (!valid) return;
    const observedAtUtc = new Date().toISOString();
    const channels = [...this.state.channels];
    const current =
      channels[frame.channelIndex] ?? emptyChannel(frame.channelIndex);
    channels[frame.channelIndex] = {
      ...current,
      ...(frame.property === "BATT_BARS"
        ? { batteryBars: numeric }
        : { batteryChargePercent: numeric }),
      observedAtUtc,
      availability: "observed",
    };
    this.state = {
      ...this.state,
      status: "ready",
      detail: "Read-only Shure battery telemetry is current.",
      channels,
    };
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => {
      this.state = {
        ...this.state,
        status: "stale",
        detail: "Shure battery telemetry has not updated for 15 seconds.",
        channels: this.state.channels.map((channel) => ({
          ...channel,
          availability:
            channel.observedAtUtc === null ? "unavailable" : "stale",
        })),
      };
    }, STALE_AFTER_MS);
    this.staleTimer.unref();
  }
}
