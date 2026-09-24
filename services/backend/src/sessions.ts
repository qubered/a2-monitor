import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LiveState, Showfile } from "@rvlt/pulse-protocol/http";

export type ShowSession = NonNullable<Showfile["sessions"]>[number];
type ShowChannel = Showfile["channels"][number];

/** Which session of the active show is running, who started it and when. */
export type SessionRun = {
  activeId: string | null;
  startedAtUtc: string | null;
  startedBy: string | null;
};

type PersistedSessionRun = { schemaVersion: "0" } & SessionRun;

export const NO_SESSION: SessionRun = {
  activeId: null,
  startedAtUtc: null,
  startedBy: null,
};

export interface SessionPersistence {
  load(): Promise<SessionRun | null>;
  save(run: SessionRun): Promise<void>;
}

export class MemorySessionPersistence implements SessionPersistence {
  saved: SessionRun | null = null;

  async load(): Promise<SessionRun | null> {
    return this.saved ? { ...this.saved } : null;
  }

  async save(run: SessionRun): Promise<void> {
    this.saved = { ...run };
  }
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export class FileSessionPersistence implements SessionPersistence {
  private readonly path: string;

  constructor(dataDirectory: string) {
    this.path = join(dataDirectory, "session.json");
  }

  async load(): Promise<SessionRun | null> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (typeof value !== "object" || value === null) return null;
      const record = value as Partial<PersistedSessionRun>;
      if (
        record.schemaVersion !== "0" ||
        !isNullableString(record.activeId) ||
        !isNullableString(record.startedAtUtc) ||
        !isNullableString(record.startedBy)
      ) {
        return null;
      }
      return {
        activeId: record.activeId,
        startedAtUtc: record.startedAtUtc,
        startedBy: record.startedBy,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(run: SessionRun): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    const persisted: PersistedSessionRun = { schemaVersion: "0", ...run };
    await writeFile(temporary, `${JSON.stringify(persisted)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}

export type ResolvedSessions = {
  active: ShowSession | null;
  next: ShowSession | null;
};

/**
 * The running and next session of a show. A run that names a session the show
 * no longer has (removed in Manager, or another production activated) is no
 * run at all. With nothing running, the first session is next.
 */
export function resolveSessions(
  showfile: Showfile,
  run: SessionRun,
): ResolvedSessions {
  const sessions = showfile.sessions ?? [];
  const position =
    run.activeId === null
      ? -1
      : sessions.findIndex(({ id }) => id === run.activeId);
  return {
    active: position === -1 ? null : sessions[position]!,
    next: sessions[position + 1] ?? null,
  };
}

/** The presenter a session names for a channel, else the showfile's performer. */
export function sessionPerformer(
  channel: ShowChannel,
  session: ShowSession | null,
): string | null {
  const entry = session?.channels.find(
    ({ channelId }) => channelId === channel.id,
  );
  return entry?.presenter ?? channel.performer ?? null;
}

export function sessionSummary(
  showfile: Showfile,
  run: SessionRun,
): NonNullable<LiveState["session"]> {
  const { active, next } = resolveSessions(showfile, run);
  return {
    activeId: active?.id ?? null,
    nextId: next?.id ?? null,
    startedAtUtc: active ? run.startedAtUtc : null,
    startedBy: active ? run.startedBy : null,
    sessions: (showfile.sessions ?? []).flatMap((session) =>
      session.id
        ? [
            {
              id: session.id,
              name: session.name,
              startMinute: session.startMinute,
              channelCount: session.channels.length,
            },
          ]
        : [],
    ),
  };
}
