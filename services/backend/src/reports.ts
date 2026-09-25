import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  FaultReport,
  LiveStateChannel,
  ReportedFault,
} from "@rvlt/pulse-protocol/http";
import { normalizeOperator } from "./alerts.js";

/** How long the A1 can take a report back before it is anyone else's work. */
export const REPORT_UNDO_MS = 10_000;
/** Closed and cancelled reports stay visible this long so the A1 sees the outcome. */
export const CLOSED_VISIBLE_MS = 5 * 60_000;
const MAX_RETAINED = 500;
const MAX_NOTE_LENGTH = 200;

export const REPORT_ACTIONS = [
  "undo",
  "urgent",
  "claim",
  "resolve",
  "confirm-fixed",
  "reopen",
  "dismiss",
] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

export const REPORTED_FAULTS: readonly ReportedFault[] = [
  "dropping-out",
  "crackling",
  "distorted",
  "too-quiet",
  "clothing-noise",
  "popping",
  "hum-buzz",
  "nothing-at-all",
  "other",
];

type PersistedReports = {
  schemaVersion: "0";
  nextId: number;
  reports: FaultReport[];
};

export interface ReportPersistence {
  load(): Promise<PersistedReports | null>;
  save(state: PersistedReports): Promise<void>;
}

export class MemoryReportPersistence implements ReportPersistence {
  saved: PersistedReports | null = null;

  async load(): Promise<PersistedReports | null> {
    return this.saved ? structuredClone(this.saved) : null;
  }

  async save(state: PersistedReports): Promise<void> {
    this.saved = structuredClone(state);
  }
}

export class FileReportPersistence implements ReportPersistence {
  private readonly path: string;

  constructor(dataDirectory: string) {
    this.path = join(dataDirectory, "reports.json");
  }

  async load(): Promise<PersistedReports | null> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (
        typeof value !== "object" ||
        value === null ||
        (value as { schemaVersion?: unknown }).schemaVersion !== "0" ||
        !Array.isArray((value as { reports?: unknown }).reports)
      ) {
        return null;
      }
      return value as PersistedReports;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(state: PersistedReports): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}

export class ReportError extends Error {
  constructor(
    readonly code: "report-not-found" | "action-not-allowed" | "no-faults",
    message: string,
  ) {
    super(message);
    this.name = "ReportError";
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function isOpenStatus(status: FaultReport["status"]): boolean {
  return status === "open" || status === "claimed";
}

/**
 * A1 fault reports (design system §11.2). A report is requested work — a
 * task — until the A1 marks it urgent or telemetry already shows a fault on
 * that channel; then it is an incident, and resolving it goes back to the A1
 * for confirmation that the symptom is gone. Promotion keeps the request
 * history rather than replacing it.
 */
export class ReportBook {
  private reports: FaultReport[] = [];
  private nextId = 1;

  restore(state: PersistedReports | null): void {
    if (!state) return;
    this.nextId = Number.isSafeInteger(state.nextId) ? state.nextId : 1;
    this.reports = state.reports.filter(
      (report) => typeof report?.id === "string",
    );
  }

  snapshot(): PersistedReports {
    return { schemaVersion: "0", nextId: this.nextId, reports: this.reports };
  }

  /** Open work plus anything closed within the last few minutes, oldest first. */
  visible(nowMs: number): FaultReport[] {
    return this.reports.filter(
      (report) =>
        report.closedAtUtc === null ||
        nowMs - Date.parse(report.closedAtUtc) <= CLOSED_VISIBLE_MS,
    );
  }

  create(
    channel: LiveStateChannel,
    faults: readonly ReportedFault[],
    note: string | null,
    requestedBy: string,
    nowMs: number,
  ): FaultReport {
    const unique = REPORTED_FAULTS.filter((fault) => faults.includes(fault));
    const trimmedNote = note?.trim().slice(0, MAX_NOTE_LENGTH) || null;
    if (unique.length === 0) {
      throw new ReportError(
        "no-faults",
        "Choose at least one fault to report.",
      );
    }
    const telemetryFault = Object.values(channel.statuses).includes("fault");
    const report: FaultReport = {
      id: `report-${String(this.nextId).padStart(6, "0")}`,
      channelId: channel.id,
      channelNumber: channel.number,
      channelName: channel.name,
      performer: channel.performer,
      faults: unique,
      note: trimmedNote,
      urgent: false,
      incident: telemetryFault,
      incidentReason: telemetryFault ? "telemetry" : null,
      status: "open",
      requestedBy: normalizeOperator(requestedBy),
      requestedAtUtc: iso(nowMs),
      undoUntilUtc: iso(nowMs + REPORT_UNDO_MS),
      claimedBy: null,
      claimedAtUtc: null,
      resolvedBy: null,
      resolvedAtUtc: null,
      closedAtUtc: null,
      dismissedBy: null,
      dismissedAtUtc: null,
    };
    this.nextId += 1;
    this.reports.push(report);
    this.prune();
    return report;
  }

  act(
    id: string,
    action: ReportAction,
    by: string,
    nowMs: number,
  ): FaultReport {
    const index = this.reports.findIndex((report) => report.id === id);
    const report = this.reports[index];
    if (!report) {
      throw new ReportError("report-not-found", "That report does not exist.");
    }
    const who = normalizeOperator(by);
    const at = iso(nowMs);
    const refuse = (message: string): never => {
      throw new ReportError("action-not-allowed", message);
    };
    let next: FaultReport;
    switch (action) {
      case "undo":
        if (report.status !== "open" || nowMs > Date.parse(report.undoUntilUtc))
          refuse("The report can no longer be taken back.");
        next = { ...report, status: "cancelled", closedAtUtc: at };
        break;
      case "urgent":
        if (
          !isOpenStatus(report.status) &&
          report.status !== "awaiting-confirmation"
        )
          refuse("A closed report cannot be marked urgent.");
        next = {
          ...report,
          urgent: true,
          incident: true,
          incidentReason: report.incidentReason ?? "urgent",
        };
        break;
      case "claim":
        if (!isOpenStatus(report.status))
          refuse("Only an open report can be claimed.");
        next = {
          ...report,
          status: "claimed",
          claimedBy: who,
          claimedAtUtc: at,
        };
        break;
      case "resolve":
        if (!isOpenStatus(report.status))
          refuse("Only an open report can be resolved.");
        next = {
          ...report,
          claimedBy: report.claimedBy ?? who,
          claimedAtUtc: report.claimedAtUtc ?? at,
          resolvedBy: who,
          resolvedAtUtc: at,
          ...(report.incident
            ? { status: "awaiting-confirmation" as const }
            : { status: "closed" as const, closedAtUtc: at }),
        };
        break;
      case "confirm-fixed":
        if (report.status !== "awaiting-confirmation")
          refuse("Only a resolved incident waits for confirmation.");
        next = { ...report, status: "closed", closedAtUtc: at };
        break;
      case "reopen":
        if (report.status !== "awaiting-confirmation")
          refuse("Only a resolved incident can be reopened.");
        next = {
          ...report,
          status: "claimed",
          resolvedBy: null,
          resolvedAtUtc: null,
        };
        break;
      case "dismiss":
        if (report.status !== "open")
          refuse("Only an unclaimed report's banner can be dismissed.");
        next = { ...report, dismissedBy: who, dismissedAtUtc: at };
        break;
    }
    this.reports[index] = next;
    return next;
  }

  /** A task whose channel now shows a measured fault becomes an incident. */
  promoteForTelemetry(faultyChannelIds: ReadonlySet<string>): boolean {
    let changed = false;
    this.reports = this.reports.map((report) => {
      if (
        report.incident ||
        !isOpenStatus(report.status) ||
        !faultyChannelIds.has(report.channelId)
      ) {
        return report;
      }
      changed = true;
      return { ...report, incident: true, incidentReason: "telemetry" };
    });
    return changed;
  }

  private prune(): void {
    while (this.reports.length > MAX_RETAINED) {
      const closedIndex = this.reports.findIndex(
        ({ closedAtUtc }) => closedAtUtc !== null,
      );
      this.reports.splice(closedIndex === -1 ? 0 : closedIndex, 1);
    }
  }
}
