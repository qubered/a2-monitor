import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ChannelMicCheck,
  LiveStateChannel,
  LiveStateVerdict,
  MicCheckDimensionId,
  MicCheckDimensionRecord,
  MicChecks,
  MicCheckSubject,
  Showfile,
} from "@rvlt/pulse-protocol/http";
import { normalizeOperator } from "./alerts.js";

export const MIC_CHECK_DIMENSIONS: readonly MicCheckDimensionId[] = [
  "physical-identity",
  "rf-link",
  "captured-audio",
  "mute-control",
  "primary-spare",
  "battery-window",
  "placement-costume",
  "operator-signoff",
];

const MAX_REASON_LENGTH = 200;
const MAX_CHECKS = 128;

/** A stored check, without the derived `stale` flag. */
export type StoredCheck = Omit<ChannelMicCheck, "stale">;

type PersistedChecks = { schemaVersion: "0"; checks: StoredCheck[] };

export interface CheckPersistence {
  load(): Promise<PersistedChecks | null>;
  save(state: PersistedChecks): Promise<void>;
}

export class MemoryCheckPersistence implements CheckPersistence {
  saved: PersistedChecks | null = null;

  async load(): Promise<PersistedChecks | null> {
    return this.saved ? structuredClone(this.saved) : null;
  }

  async save(state: PersistedChecks): Promise<void> {
    this.saved = structuredClone(state);
  }
}

export class FileCheckPersistence implements CheckPersistence {
  private readonly path: string;

  constructor(dataDirectory: string) {
    this.path = join(dataDirectory, "checks.json");
  }

  async load(): Promise<PersistedChecks | null> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (
        typeof value !== "object" ||
        value === null ||
        (value as { schemaVersion?: unknown }).schemaVersion !== "0" ||
        !Array.isArray((value as { checks?: unknown }).checks)
      ) {
        return null;
      }
      return value as PersistedChecks;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(state: PersistedChecks): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}

/** What a check is about: the patch and performer at the time it was made. */
export function subjectOf(
  channel: Showfile["channels"][number],
): MicCheckSubject {
  return {
    inputIndex: channel.inputIndex,
    receiverId: channel.shureReceiverId ?? null,
    receiverChannelIndex: channel.shureChannelIndex ?? null,
    performer: channel.performer ?? null,
  };
}

function sameSubject(a: MicCheckSubject, b: MicCheckSubject): boolean {
  return (
    a.inputIndex === b.inputIndex &&
    a.receiverId === b.receiverId &&
    a.receiverChannelIndex === b.receiverChannelIndex &&
    a.performer === b.performer
  );
}

export type CheckSummary = NonNullable<LiveStateChannel["check"]>;

/** Counts a check against the channel's current subject; a check made against another subject is stale. */
export function summarizeCheck(
  check: StoredCheck | undefined,
  subject: MicCheckSubject,
): CheckSummary | null {
  if (!check) return null;
  const count = (verdict: MicCheckDimensionRecord["verdict"]) =>
    check.dimensions.filter((dimension) => dimension.verdict === verdict)
      .length;
  return {
    passed: count("pass"),
    failed: count("fail"),
    waiting: count("waiting"),
    total: 8,
    stale: !sameSubject(check.subject, subject),
    updatedAtUtc: check.updatedAtUtc,
  };
}

/** The status-strip Check cell: unknown until checked, fault on any fail, good only when all eight pass. */
export function checkVerdict(summary: CheckSummary | null): LiveStateVerdict {
  if (!summary || summary.stale) return "unknown";
  if (summary.failed > 0) return "fault";
  if (summary.passed === summary.total) return "good";
  return "caution";
}

export class CheckNotFoundError extends Error {
  constructor() {
    super("No check exists for that channel.");
    this.name = "CheckNotFoundError";
  }
}

/**
 * Guided mic checks shared by every client. Verdicts are attributed and
 * timestamped; a verdict recorded against a changed subject starts a fresh
 * check rather than mixing evidence about two different set-ups.
 */
export class CheckStore {
  private readonly checks = new Map<string, StoredCheck>();

  restore(state: PersistedChecks | null): void {
    this.checks.clear();
    for (const check of state?.checks ?? []) {
      if (typeof check?.channelId === "string") {
        this.checks.set(check.channelId, check);
      }
    }
  }

  snapshot(): PersistedChecks {
    return { schemaVersion: "0", checks: [...this.checks.values()] };
  }

  get(channelId: string): StoredCheck | undefined {
    return this.checks.get(channelId);
  }

  list(
    subjects: ReadonlyMap<string, MicCheckSubject>,
    nowMs: number,
  ): MicChecks {
    return {
      schemaVersion: "0",
      generatedAtUtc: new Date(nowMs).toISOString(),
      checks: [...this.checks.values()]
        .filter(({ channelId }) => subjects.has(channelId))
        .map((check) => ({
          ...check,
          stale: !sameSubject(check.subject, subjects.get(check.channelId)!),
        })),
    };
  }

  record(
    channelId: string,
    subject: MicCheckSubject,
    dimensionId: MicCheckDimensionId,
    verdict: MicCheckDimensionRecord["verdict"],
    by: string,
    reason: string | null,
    nowMs: number,
  ): StoredCheck {
    const atUtc = new Date(nowMs).toISOString();
    const existing = this.checks.get(channelId);
    const current =
      existing && sameSubject(existing.subject, subject)
        ? existing
        : {
            channelId,
            subject,
            startedAtUtc: atUtc,
            updatedAtUtc: atUtc,
            dimensions: [],
          };
    if (!existing && this.checks.size >= MAX_CHECKS) {
      throw new Error("The check store is full.");
    }
    const record: MicCheckDimensionRecord = {
      id: dimensionId,
      verdict,
      by: normalizeOperator(by),
      atUtc,
      reason: reason?.trim().slice(0, MAX_REASON_LENGTH) || null,
    };
    const dimensions = [
      ...current.dimensions.filter(({ id }) => id !== dimensionId),
      record,
    ].sort(
      (a, b) =>
        MIC_CHECK_DIMENSIONS.indexOf(a.id) - MIC_CHECK_DIMENSIONS.indexOf(b.id),
    );
    const next: StoredCheck = { ...current, dimensions, updatedAtUtc: atUtc };
    this.checks.set(channelId, next);
    return next;
  }

  /** Drops checks for channels no longer in the active show. */
  prune(activeChannelIds: ReadonlySet<string>): void {
    for (const channelId of [...this.checks.keys()]) {
      if (!activeChannelIds.has(channelId)) this.checks.delete(channelId);
    }
  }

  reset(channelId: string): void {
    if (!this.checks.delete(channelId)) throw new CheckNotFoundError();
  }

  resetAll(): void {
    this.checks.clear();
  }
}
