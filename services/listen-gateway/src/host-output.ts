import { EventEmitter } from "node:events";
import type { HostOutput } from "@rvlt/pulse-protocol/http";
import type { HostOutputState, MonitorCommand } from "./media-worker.js";

export const MIN_MONITOR_GAIN_DB = -60;
export const MAX_MONITOR_GAIN_DB = 12;
export const DIM_ATTENUATION_DB = -12;
/** Unity: the host output carries the captured level unless someone turns it down. */
export const DEFAULT_HOST_GAIN_DB = 0;
const MAX_CHANNEL_ID_LENGTH = 128;
const MAX_CHANGED_BY_LENGTH = 80;

export type HostMonitor = HostOutput["sessions"][number]["monitor"];

/** A host output session as a production defines it (ADR 0031). */
export type HostSessionConfig = {
  id: string;
  name: string;
  outputChannels: number[];
};

/** The node's own single session, used when the production defines none. */
export const DEFAULT_SESSION_ID = "default";
export const DEFAULT_SESSION_NAME = "Host output";

/** A validated partial change from one Live client. */
export type HostMonitorChange = {
  channelId?: string | null;
  input?: number | null;
  muted?: boolean;
  dimmed?: boolean;
  gainDb?: number;
  changedBy?: string | null;
};

const CHANGE_KEYS = new Set([
  "channelId",
  "input",
  "muted",
  "dimmed",
  "gainDb",
  "changedBy",
]);

export class MonitorChangeError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * Validates a `PATCH /audio/v0/output` body. Any non-empty subset of the monitor
 * fields may change; the selected show channel and its input change together so
 * every client agrees on what is playing.
 */
export function parseMonitorChange(
  value: Record<string, unknown>,
  channelCount: number | null,
): HostMonitorChange {
  const keys = Object.keys(value);
  if (
    keys.length === 0 ||
    keys.some((key) => !CHANGE_KEYS.has(key)) ||
    keys.every((key) => key === "changedBy")
  ) {
    throw new MonitorChangeError("invalid-body");
  }
  if ("channelId" in value !== "input" in value) {
    throw new MonitorChangeError("channel-and-input-required");
  }
  const change: HostMonitorChange = {};
  if ("input" in value) {
    const { channelId, input } = value;
    if (input === null) {
      if (channelId !== null) throw new MonitorChangeError("invalid-channel");
      change.channelId = null;
      change.input = null;
    } else {
      if (
        typeof channelId !== "string" ||
        channelId.length === 0 ||
        channelId.length > MAX_CHANNEL_ID_LENGTH ||
        typeof input !== "number" ||
        !Number.isInteger(input) ||
        input < 0 ||
        input > 255
      ) {
        throw new MonitorChangeError("invalid-channel");
      }
      if (channelCount === null)
        throw new MonitorChangeError("audio-not-ready");
      if (input >= channelCount)
        throw new MonitorChangeError("invalid-channel");
      change.channelId = channelId;
      change.input = input;
    }
  }
  for (const key of ["muted", "dimmed"] as const) {
    if (key in value) {
      if (typeof value[key] !== "boolean") {
        throw new MonitorChangeError(`invalid-${key}`);
      }
      change[key] = value[key];
    }
  }
  if ("gainDb" in value) {
    const gainDb = value.gainDb;
    if (
      typeof gainDb !== "number" ||
      !Number.isFinite(gainDb) ||
      gainDb < MIN_MONITOR_GAIN_DB ||
      gainDb > MAX_MONITOR_GAIN_DB
    ) {
      throw new MonitorChangeError("invalid-gainDb");
    }
    change.gainDb = Math.round(gainDb * 10) / 10;
  }
  if ("changedBy" in value) {
    const changedBy = value.changedBy;
    if (
      changedBy !== null &&
      (typeof changedBy !== "string" ||
        changedBy.trim().length === 0 ||
        changedBy.length > MAX_CHANGED_BY_LENGTH)
    ) {
      throw new MonitorChangeError("invalid-changedBy");
    }
    change.changedBy = changedBy === null ? null : changedBy.trim();
  }
  return change;
}

/** The linear gain and input the worker renders for a monitor state. */
export function monitorCommand(monitor: HostMonitor): MonitorCommand {
  if (monitor.input === null) return { channel: null, gain: 0 };
  const gainDb = monitor.gainDb + (monitor.dimmed ? DIM_ATTENUATION_DB : 0);
  return {
    channel: monitor.input,
    gain: monitor.muted ? 0 : 10 ** (gainDb / 20),
  };
}

/**
 * The monitor state every Live client in one host output session shares
 * (ADR 0031): whoever changes the selection, mute, dim or level changes it for
 * everyone in the session, and every client sees the change. It is held in
 * memory: a gateway restart starts with nothing selected.
 */
export class SharedHostMonitor extends EventEmitter {
  private monitor: HostMonitor = {
    channelId: null,
    input: null,
    muted: false,
    dimmed: false,
    gainDb: DEFAULT_HOST_GAIN_DB,
    changedBy: null,
    changedAtUtc: null,
  };
  private revision = 0;

  constructor(private readonly now: () => Date = () => new Date()) {
    super();
  }

  get(): HostMonitor {
    return this.monitor;
  }

  getRevision(): number {
    return this.revision;
  }

  apply(change: HostMonitorChange): HostMonitor {
    const { changedBy, ...fields } = change;
    this.monitor = {
      ...this.monitor,
      ...fields,
      changedBy: changedBy ?? null,
      changedAtUtc: this.now().toISOString(),
    };
    this.revision += 1;
    this.emit("change", this.monitor);
    return this.monitor;
  }

  /** Clears a selection whose input no longer exists on the running device. */
  constrain(channelCount: number): void {
    if (this.monitor.input !== null && this.monitor.input >= channelCount) {
      this.apply({ channelId: null, input: null, changedBy: null });
    }
  }
}

type Session = HostSessionConfig & { monitor: SharedHostMonitor };

/**
 * The host output sessions in effect, in mix order. Reconfiguring keeps each
 * surviving session's shared monitor by id, so renaming a session or adding
 * another does not interrupt anyone. Emits `monitor` (mix index) when a
 * session's monitor changes and `sessions` when the list changes.
 */
export class HostOutputSessions extends EventEmitter {
  private sessions: Session[] = [];

  constructor(
    defaultChannels: readonly number[],
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
    this.configure(null, defaultChannels);
  }

  list(): readonly Session[] {
    return this.sessions;
  }

  find(id: string): Session | undefined {
    return this.sessions.find((session) => session.id === id);
  }

  indexOf(id: string): number {
    return this.sessions.findIndex((session) => session.id === id);
  }

  routes(): number[][] {
    return this.sessions.map(({ outputChannels }) => [...outputChannels]);
  }

  /**
   * Applies a production's sessions, or the default single session when it
   * defines none. Returns true when anything changed.
   */
  configure(
    configs: readonly HostSessionConfig[] | null | undefined,
    defaultChannels: readonly number[],
  ): boolean {
    const desired: HostSessionConfig[] = configs?.length
      ? configs.map(({ id, name, outputChannels }) => ({
          id,
          name,
          outputChannels: [...outputChannels],
        }))
      : [
          {
            id: DEFAULT_SESSION_ID,
            name: DEFAULT_SESSION_NAME,
            outputChannels: [...defaultChannels],
          },
        ];
    const current = this.sessions.map(({ id, name, outputChannels }) => ({
      id,
      name,
      outputChannels,
    }));
    if (JSON.stringify(desired) === JSON.stringify(current)) return false;
    const previous = new Map(
      this.sessions.map((session) => [session.id, session]),
    );
    for (const session of this.sessions) {
      if (!desired.some(({ id }) => id === session.id)) {
        session.monitor.removeAllListeners();
      }
    }
    this.sessions = desired.map((config) => {
      const monitor =
        previous.get(config.id)?.monitor ?? new SharedHostMonitor(this.now);
      if (!previous.has(config.id)) {
        monitor.on("change", () => {
          const index = this.indexOf(config.id);
          if (index >= 0) this.emit("monitor", index);
        });
      }
      return { ...config, monitor };
    });
    this.emit("sessions");
    return true;
  }

  /** Clears selections whose input no longer exists on the running device. */
  constrain(channelCount: number): void {
    for (const { monitor } of this.sessions) monitor.constrain(channelCount);
  }
}

/** The `host-output` document: output device state plus every session's shared monitor. */
export function hostOutputDocument(
  output: HostOutputState | null,
  sessions: HostOutputSessions,
): HostOutput {
  return {
    schemaVersion: "0",
    output: output && {
      status: output.status,
      detail: output.detail.slice(0, 240) || "Host output state is unknown.",
      deviceName: output.deviceName.slice(0, 512),
      channelCount: output.channelCount,
      simulated: output.simulated,
      underruns: output.underruns,
      droppedFrames: output.droppedFrames,
    },
    sessions: output
      ? sessions.list().map(({ id, name, outputChannels, monitor }) => ({
          id,
          name,
          outputChannels,
          revision: monitor.getRevision(),
          monitor: monitor.get(),
        }))
      : [],
  };
}
