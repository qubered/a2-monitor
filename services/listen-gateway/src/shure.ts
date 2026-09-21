import { createConnection, isIP, type Socket } from "node:net";
import {
  parseShowfile,
  type Showfile,
  type ShureTelemetry,
} from "@a2-monitor/protocol/http";

const MAX_BUFFER_BYTES = 64 * 1024;
const STALE_AFTER_MS = 15_000;
const CONFIG_REFRESH_MS = 2_000;

type ReceiverConfig = Showfile["shureReceivers"][number];
type ReceiverState = ShureTelemetry["receivers"][number];

export type ShureFleetOptions = {
  backendOrigin?: string;
  fetch?: typeof fetch;
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

function emptyChannel(index: number): ReceiverState["channels"][number] {
  return {
    index,
    batteryBars: null,
    batteryChargePercent: null,
    observedAtUtc: null,
    availability: "unavailable",
  };
}

class ReceiverMonitor {
  private socket?: Socket;
  private reconnectTimer?: NodeJS.Timeout;
  private staleTimer?: NodeJS.Timeout;
  private closed = false;
  private reconnectDelayMs = 500;
  private state: ReceiverState;

  constructor(readonly config: ReceiverConfig) {
    this.state = {
      id: config.id,
      name: config.name,
      host: config.host,
      model: null,
      firmware: null,
      compatibility: "compatible-read-only",
      status: "connecting",
      detail: "Connecting to this Shure receiver.",
      channels: Array.from({ length: config.channelCount }, (_, index) =>
        emptyChannel(index),
      ),
    };
  }

  start(): void {
    if (this.closed) return;
    if (isIP(this.config.host) === 0) {
      this.state = {
        ...this.state,
        status: "error",
        detail: "Receiver host must be an explicit IP address.",
      };
      return;
    }
    this.connect();
  }

  getState(): ReceiverState {
    return structuredClone(this.state);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.socket?.destroy();
  }

  private connect(): void {
    if (this.closed) return;
    this.state = {
      ...this.state,
      status: "connecting",
      detail: "Connecting to this Shure receiver.",
    };
    const parser = new ShureFrameParser();
    const socket = createConnection({ host: this.config.host, port: 2202 });
    this.socket = socket;
    socket.setKeepAlive(true, 5_000);
    socket.setTimeout(20_000, () =>
      socket.destroy(new Error("Shure receiver timed out.")),
    );
    socket.on("connect", () => {
      this.reconnectDelayMs = 500;
      socket.write("< GET MODEL >\r\n< GET FW_VER >\r\n");
      for (let channel = 1; channel <= this.config.channelCount; channel += 1) {
        socket.write(
          `< GET ${channel} BATT_BARS >\r\n< GET ${channel} BATT_CHARGE >\r\n`,
        );
      }
      this.state = {
        ...this.state,
        status: "ready",
        detail: "Read-only connection is active; waiting for battery reports.",
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
        detail: "Receiver disconnected; retained battery values are stale.",
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
    if (frame.property === "MODEL" || frame.property === "FW_VER") {
      this.state = {
        ...this.state,
        [frame.property === "MODEL" ? "model" : "firmware"]:
          frame.value || null,
      };
      return;
    }
    if (
      frame.channelIndex === undefined ||
      frame.channelIndex >= this.state.channels.length ||
      !["BATT_BARS", "BATT_CHARGE"].includes(frame.property)
    )
      return;
    const numeric = Number(frame.value);
    const valid =
      Number.isInteger(numeric) &&
      (frame.property === "BATT_BARS"
        ? numeric >= 0 && numeric <= 5
        : numeric >= 0 && numeric <= 100);
    if (!valid) return;
    const channels = [...this.state.channels];
    channels[frame.channelIndex] = {
      ...(channels[frame.channelIndex] ?? emptyChannel(frame.channelIndex)),
      ...(frame.property === "BATT_BARS"
        ? { batteryBars: numeric }
        : { batteryChargePercent: numeric }),
      observedAtUtc: new Date().toISOString(),
      availability: "observed",
    };
    this.state = {
      ...this.state,
      status: "ready",
      detail: "Read-only battery telemetry is current.",
      channels,
    };
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => {
      this.state = {
        ...this.state,
        status: "stale",
        detail: "Battery telemetry has not updated for 15 seconds.",
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

export class ShureFleetMonitor {
  private readonly monitors = new Map<string, ReceiverMonitor>();
  private readonly fetcher: typeof fetch;
  private refreshTimer?: NodeJS.Timeout;
  private closed = false;
  private configError?: string;

  constructor(private readonly options: ShureFleetOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
  }

  start(): void {
    if (!this.options.backendOrigin || this.closed) return;
    void this.refresh();
    this.refreshTimer = setInterval(
      () => void this.refresh(),
      CONFIG_REFRESH_MS,
    );
    this.refreshTimer.unref();
  }

  getState(): ShureTelemetry {
    const receivers = [...this.monitors.values()].map((monitor) =>
      monitor.getState(),
    );
    if (receivers.length === 0)
      return {
        schemaVersion: "0",
        status: this.configError ? "error" : "unconfigured",
        detail:
          this.configError ?? "No Shure receivers are configured in Manager.",
        receivers: [],
      };
    const statuses = receivers.map(({ status }) => status);
    const allReady = statuses.every((status) => status === "ready");
    const allSame = statuses.every((status) => status === statuses[0]);
    return {
      schemaVersion: "0",
      status: allReady ? "ready" : allSame ? statuses[0]! : "degraded",
      detail: allReady
        ? "All configured Shure receivers are reporting."
        : "One or more configured Shure receivers are not current.",
      receivers,
    };
  }

  close(): void {
    this.closed = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    for (const monitor of this.monitors.values()) monitor.close();
    this.monitors.clear();
  }

  private async refresh(): Promise<void> {
    try {
      const response = await this.fetcher(
        new URL("/api/v1/showfile", this.options.backendOrigin),
      );
      if (!response.ok)
        throw new Error(
          `Manager configuration returned HTTP ${response.status}.`,
        );
      const showfile = parseShowfile(await response.json());
      this.reconcile(showfile.shureReceivers);
      this.configError = undefined;
    } catch (error) {
      this.configError =
        error instanceof Error
          ? error.message
          : "Receiver configuration is unavailable.";
    }
  }

  private reconcile(configs: ReceiverConfig[]): void {
    const desired = new Set(configs.map(({ id }) => id));
    for (const [id, monitor] of this.monitors) {
      if (!desired.has(id)) {
        monitor.close();
        this.monitors.delete(id);
      }
    }
    for (const config of configs) {
      const current = this.monitors.get(config.id);
      if (current && JSON.stringify(current.config) === JSON.stringify(config))
        continue;
      current?.close();
      const monitor = new ReceiverMonitor(config);
      this.monitors.set(config.id, monitor);
      monitor.start();
    }
  }
}
