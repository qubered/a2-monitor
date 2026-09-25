import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LiveState, Showfile } from "@rvlt/pulse-protocol/http";

export type ShowSession = NonNullable<Showfile["sessions"]>[number];
type ShowChannel = Showfile["channels"][number];

/** Which session of one room is running, who started it and when. */
export type SessionRun = {
  activeId: string | null;
  startedAtUtc: string | null;
  startedBy: string | null;
};

/** Runs by room key: a room's id, or "" for channels and sessions in no room. */
export type SessionRuns = ReadonlyMap<string, SessionRun>;

type PersistedRuns = {
  schemaVersion: "0";
  runs: Array<{ roomId: string | null } & SessionRun>;
};

export const NO_SESSION: SessionRun = {
  activeId: null,
  startedAtUtc: null,
  startedBy: null,
};

/** The key a room's run is held under; channels and sessions in no room share "". */
export function roomKey(roomId: string | null | undefined): string {
  return roomId ?? "";
}

export interface SessionPersistence {
  load(): Promise<Map<string, SessionRun> | null>;
  save(runs: SessionRuns): Promise<void>;
}

export class MemorySessionPersistence implements SessionPersistence {
  saved: Map<string, SessionRun> | null = null;

  async load(): Promise<Map<string, SessionRun> | null> {
    return this.saved ? new Map(this.saved) : null;
  }

  async save(runs: SessionRuns): Promise<void> {
    this.saved = new Map(runs);
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

  async load(): Promise<Map<string, SessionRun> | null> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (typeof value !== "object" || value === null) return null;
      const record = value as Partial<PersistedRuns>;
      if (record.schemaVersion !== "0" || !Array.isArray(record.runs)) {
        return null;
      }
      const runs = new Map<string, SessionRun>();
      for (const run of record.runs as unknown[]) {
        if (typeof run !== "object" || run === null) continue;
        const entry = run as Record<string, unknown>;
        if (
          !isNullableString(entry.roomId) ||
          !isNullableString(entry.activeId) ||
          !isNullableString(entry.startedAtUtc) ||
          !isNullableString(entry.startedBy)
        ) {
          continue;
        }
        runs.set(roomKey(entry.roomId), {
          activeId: entry.activeId,
          startedAtUtc: entry.startedAtUtc,
          startedBy: entry.startedBy,
        });
      }
      return runs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(runs: SessionRuns): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    const persisted: PersistedRuns = {
      schemaVersion: "0",
      runs: [...runs].map(([key, run]) => ({
        roomId: key === "" ? null : key,
        ...run,
      })),
    };
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

/** One room's sessions, in showfile order. */
function roomSessions(showfile: Showfile, key: string): ShowSession[] {
  return (showfile.sessions ?? []).filter(
    ({ roomId }) => roomKey(roomId) === key,
  );
}

/**
 * The running and next session of one room. A run that names a session the
 * room no longer has (removed or moved in Manager, or another production
 * activated) is no run at all. With nothing running, the first is next.
 */
export function resolveRoom(
  showfile: Showfile,
  run: SessionRun | undefined,
  key: string,
): ResolvedSessions {
  const sessions = roomSessions(showfile, key);
  const position =
    !run || run.activeId === null
      ? -1
      : sessions.findIndex(({ id }) => id === run.activeId);
  return {
    active: position === -1 ? null : sessions[position]!,
    next: sessions[position + 1] ?? null,
  };
}

/** Room keys that have sessions: rooms in showfile order, then channels in no room. */
export function sessionRoomKeys(showfile: Showfile): string[] {
  const keys = new Set(
    (showfile.sessions ?? []).map(({ roomId }) => roomKey(roomId)),
  );
  const ordered = (showfile.rooms ?? []).flatMap(({ id }) =>
    id !== undefined && keys.has(id) ? [id] : [],
  );
  return keys.has("") ? [...ordered, ""] : ordered;
}

/** Every room's resolved run, keyed by room key. */
export function resolveSessions(
  showfile: Showfile,
  runs: SessionRuns,
): Map<string, ResolvedSessions> {
  return new Map(
    sessionRoomKeys(showfile).map((key) => [
      key,
      resolveRoom(showfile, runs.get(key), key),
    ]),
  );
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

/** The room keys a channel follows: its own rooms (ADR 0035), or the "no room" bucket with none. */
export function channelRoomKeys(channel: ShowChannel): string[] {
  const rooms = channel.rooms ?? [];
  return rooms.length > 0
    ? rooms.map(({ roomId }) => roomKey(roomId))
    : [roomKey(null)];
}

function inSession(
  session: ShowSession | null,
  channelId: string | undefined,
): boolean | null {
  return session === null
    ? null
    : session.channels.some(({ channelId: id }) => id === channelId);
}

/** True if any value is true, else false if any is false, else null. */
function combineTri(values: readonly (boolean | null)[]): boolean | null {
  if (values.some((value) => value === true)) return true;
  if (values.some((value) => value === false)) return false;
  return null;
}

export type ChannelSessionView = {
  inUse: boolean | null;
  nextInUse: boolean | null;
  activeSession: ShowSession | null;
  nextSession: ShowSession | null;
};

/**
 * A channel's session standing across every room it belongs to (ADR 0035):
 * `inUse` is true if any member room's active session includes the channel,
 * false if some member room runs a session that excludes it, else null.
 * `nextInUse` combines the same way over each room's next session. The
 * governing session for `sessionPerformer` is whichever room resolved true;
 * with none, `sessionPerformer` falls back to the channel's own performer as
 * usual. A channel in exactly one room (or none) resolves exactly as before.
 */
export function resolveChannelSession(
  channel: ShowChannel,
  sessionsByRoom: ReadonlyMap<string, ResolvedSessions>,
): ChannelSessionView {
  const perRoom = channelRoomKeys(channel).map((key) => {
    const resolved = sessionsByRoom.get(key) ?? { active: null, next: null };
    return {
      activeSession: resolved.active,
      nextSession: resolved.next,
      inUse: inSession(resolved.active, channel.id),
      nextInUse: inSession(resolved.next, channel.id),
    };
  });
  return {
    inUse: combineTri(perRoom.map(({ inUse }) => inUse)),
    nextInUse: combineTri(perRoom.map(({ nextInUse }) => nextInUse)),
    activeSession:
      perRoom.find(({ inUse }) => inUse === true)?.activeSession ?? null,
    nextSession:
      perRoom.find(({ nextInUse }) => nextInUse === true)?.nextSession ?? null,
  };
}

export function sessionRunsSummary(
  showfile: Showfile,
  runs: SessionRuns,
): NonNullable<LiveState["runs"]> {
  return sessionRoomKeys(showfile).map((key) => {
    const run = runs.get(key);
    const { active, next } = resolveRoom(showfile, run, key);
    return {
      roomId: key === "" ? null : key,
      activeId: active?.id ?? null,
      nextId: next?.id ?? null,
      startedAtUtc: active ? (run?.startedAtUtc ?? null) : null,
      startedBy: active ? (run?.startedBy ?? null) : null,
      sessions: roomSessions(showfile, key).flatMap((session) =>
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
  });
}

export function roomsSummary(
  showfile: Showfile,
): NonNullable<LiveState["rooms"]> {
  return (showfile.rooms ?? []).flatMap((room) =>
    room.id
      ? [
          {
            id: room.id,
            name: room.name,
            categories: room.categories.flatMap((category) =>
              category.id ? [{ id: category.id, name: category.name }] : [],
            ),
          },
        ]
      : [],
  );
}
