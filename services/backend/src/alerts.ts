import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AlertLog, LiveAlert } from "@rvlt/pulse-protocol/http";

export const MAX_ALERT_HISTORY = 1_000;
const MAX_ACTIVE_ALERTS = 512;
const MAX_OPERATOR_LENGTH = 80;

export type AlertKind = LiveAlert["kind"];

/**
 * A finding from one evaluation pass. The alert book turns a condition into
 * an alert only after it has held for `raiseAfterMs`, and clears the alert
 * only after the condition has been absent for `clearAfterMs`, so a value
 * hovering on a limit cannot flood operators.
 */
export type AlertCondition = {
  key: string;
  kind: AlertKind;
  dimension: LiveAlert["dimension"];
  severity: LiveAlert["severity"];
  label: string;
  detail: string;
  channelId: string | null;
  channelNumber: number | null;
  channelName: string | null;
  receiverId: string | null;
  raiseAfterMs: number;
  clearAfterMs: number;
};

type ActiveAlert = { key: string; clearAfterMs: number; alert: LiveAlert };

export type PersistedAlerts = {
  schemaVersion: "0";
  nextId: number;
  active: ActiveAlert[];
  history: LiveAlert[];
};

export interface AlertPersistence {
  load(): Promise<PersistedAlerts | null>;
  save(state: PersistedAlerts): Promise<void>;
}

export class MemoryAlertPersistence implements AlertPersistence {
  saved: PersistedAlerts | null = null;

  async load(): Promise<PersistedAlerts | null> {
    return this.saved ? structuredClone(this.saved) : null;
  }

  async save(state: PersistedAlerts): Promise<void> {
    this.saved = structuredClone(state);
  }
}

/** Atomic JSON file beside the production library, so acknowledgements survive a backend restart. */
export class FileAlertPersistence implements AlertPersistence {
  private readonly path: string;

  constructor(dataDirectory: string) {
    this.path = join(dataDirectory, "alerts.json");
  }

  async load(): Promise<PersistedAlerts | null> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (
        typeof value !== "object" ||
        value === null ||
        (value as { schemaVersion?: unknown }).schemaVersion !== "0"
      ) {
        return null;
      }
      return value as PersistedAlerts;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(state: PersistedAlerts): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}

const SEVERITY_RANK: Record<LiveAlert["severity"], number> = {
  caution: 0,
  critical: 1,
};

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function isAlertRecord(value: unknown): value is LiveAlert {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LiveAlert).id === "string" &&
    typeof (value as LiveAlert).raisedAtUtc === "string"
  );
}

/**
 * The backend-owned alert lifecycle: raise, acknowledge, expire and clear.
 * Acknowledging never clears; a cleared alert leaves the active set whether
 * or not anyone saw it, and remains in bounded history either way.
 */
export class AlertBook {
  private readonly active = new Map<string, ActiveAlert>();
  private readonly pending = new Map<string, number>();
  private readonly clearing = new Map<string, number>();
  private history: LiveAlert[] = [];
  private nextId = 1;

  constructor(private overlayExpiryMs: number) {}

  setOverlayExpiryMs(overlayExpiryMs: number): void {
    this.overlayExpiryMs = overlayExpiryMs;
  }

  restore(state: PersistedAlerts | null): void {
    if (!state) return;
    this.nextId = Number.isSafeInteger(state.nextId) ? state.nextId : 1;
    this.active.clear();
    for (const entry of state.active ?? []) {
      if (typeof entry?.key === "string" && isAlertRecord(entry.alert)) {
        this.active.set(entry.key, entry);
      }
    }
    this.history = (state.history ?? [])
      .filter(isAlertRecord)
      .slice(0, MAX_ALERT_HISTORY);
  }

  snapshot(): PersistedAlerts {
    return {
      schemaVersion: "0",
      nextId: this.nextId,
      active: [...this.active.values()],
      history: this.history,
    };
  }

  /** Applies one evaluation pass. Returns true when any alert changed. */
  apply(conditions: readonly AlertCondition[], nowMs: number): boolean {
    let changed = false;
    const present = new Set<string>();

    for (const condition of conditions) {
      present.add(condition.key);
      const existing = this.active.get(condition.key);
      if (existing) {
        this.clearing.delete(condition.key);
        changed = this.update(existing, condition, nowMs) || changed;
        continue;
      }
      const since = this.pending.get(condition.key) ?? nowMs;
      this.pending.set(condition.key, since);
      if (
        nowMs - since >= condition.raiseAfterMs &&
        this.active.size < MAX_ACTIVE_ALERTS
      ) {
        this.pending.delete(condition.key);
        this.raise(condition, nowMs);
        changed = true;
      }
    }

    for (const key of [...this.pending.keys()]) {
      if (!present.has(key)) this.pending.delete(key);
    }

    for (const [key, entry] of [...this.active]) {
      if (present.has(key)) continue;
      const since = this.clearing.get(key) ?? nowMs;
      this.clearing.set(key, since);
      if (nowMs - since >= entry.clearAfterMs) {
        this.clearing.delete(key);
        this.active.delete(key);
        this.history.unshift({ ...entry.alert, clearedAtUtc: iso(nowMs) });
        if (this.history.length > MAX_ALERT_HISTORY) this.history.pop();
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Clears every active alert on one channel into history, and forgets findings
   * still counting toward a raise or clear. Returns how many alerts cleared.
   */
  clearChannel(channelId: string, nowMs: number): number {
    let cleared = 0;
    for (const [key, entry] of [...this.active]) {
      if (entry.alert.channelId !== channelId) continue;
      this.active.delete(key);
      this.history.unshift({ ...entry.alert, clearedAtUtc: iso(nowMs) });
      cleared += 1;
    }
    if (this.history.length > MAX_ALERT_HISTORY) {
      this.history.length = MAX_ALERT_HISTORY;
    }
    for (const map of [this.pending, this.clearing]) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(`${channelId}:`)) map.delete(key);
      }
    }
    return cleared;
  }

  acknowledge(id: string, operator: string, nowMs: number): LiveAlert | null {
    for (const entry of this.active.values()) {
      if (entry.alert.id !== id) continue;
      if (entry.alert.acknowledgedAtUtc === null) {
        entry.alert = {
          ...entry.alert,
          acknowledgedAtUtc: iso(nowMs),
          acknowledgedBy: normalizeOperator(operator),
        };
      }
      return entry.alert;
    }
    return null;
  }

  activeAlerts(): LiveAlert[] {
    return [...this.active.values()]
      .map(({ alert }) => alert)
      .sort(
        (a, b) =>
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
          a.raisedAtUtc.localeCompare(b.raisedAtUtc) ||
          a.id.localeCompare(b.id),
      );
  }

  log(nowMs: number): AlertLog {
    return {
      schemaVersion: "0",
      generatedAtUtc: iso(nowMs),
      active: this.activeAlerts(),
      history: [...this.history],
    };
  }

  private raise(condition: AlertCondition, nowMs: number): void {
    const id = `alert-${String(this.nextId).padStart(6, "0")}`;
    this.nextId += 1;
    this.active.set(condition.key, {
      key: condition.key,
      clearAfterMs: condition.clearAfterMs,
      alert: {
        id,
        kind: condition.kind,
        dimension: condition.dimension,
        severity: condition.severity,
        label: condition.label,
        detail: condition.detail,
        channelId: condition.channelId,
        channelNumber: condition.channelNumber,
        channelName: condition.channelName,
        receiverId: condition.receiverId,
        raisedAtUtc: iso(nowMs),
        acknowledgedAtUtc: null,
        acknowledgedBy: null,
        clearedAtUtc: null,
        overlayExpiresAtUtc:
          condition.severity === "critical"
            ? null
            : iso(nowMs + this.overlayExpiryMs),
      },
    });
  }

  /** Keeps the alert's identity; an escalation re-arms it so it must be seen again. */
  private update(
    entry: ActiveAlert,
    condition: AlertCondition,
    nowMs: number,
  ): boolean {
    const previous = entry.alert;
    const escalated =
      SEVERITY_RANK[condition.severity] > SEVERITY_RANK[previous.severity];
    const next: LiveAlert = {
      ...previous,
      severity: condition.severity,
      label: condition.label,
      detail: condition.detail,
      ...(escalated
        ? {
            acknowledgedAtUtc: null,
            acknowledgedBy: null,
            overlayExpiresAtUtc: null,
          }
        : {}),
      ...(!escalated &&
      condition.severity === "caution" &&
      previous.severity === "critical"
        ? { overlayExpiresAtUtc: iso(nowMs + this.overlayExpiryMs) }
        : {}),
    };
    entry.clearAfterMs = condition.clearAfterMs;
    if (JSON.stringify(next) === JSON.stringify(previous)) return false;
    entry.alert = next;
    return true;
  }
}

export function normalizeOperator(operator: string): string {
  const trimmed = operator.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Unnamed operator";
  return trimmed.length > MAX_OPERATOR_LENGTH
    ? trimmed.slice(0, MAX_OPERATOR_LENGTH)
    : trimmed;
}
