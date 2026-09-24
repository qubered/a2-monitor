import { randomUUID } from "node:crypto";
import showfileSchema from "@rvlt/pulse-protocol/schema/showfile" with { type: "json" };
import type { Showfile } from "@rvlt/pulse-protocol/http";
import { createStrictAjv2020 } from "@rvlt/pulse-protocol/validation/strict-ajv";

export const validateShowfile = createStrictAjv2020().compile(showfileSchema);

export function emptyShowfile(): Showfile {
  return {
    schemaVersion: "0",
    revision: 0,
    updatedAtUtc: null,
    show: { name: "Untitled show" },
    device: null,
    shureReceivers: [],
    channels: [],
  };
}

export class ShowfileConflictError extends Error {
  constructor() {
    super("The showfile changed since it was loaded.");
    this.name = "ShowfileConflictError";
  }
}

export function trimShowfile(candidate: Showfile): Showfile {
  return {
    ...candidate,
    show: { name: candidate.show.name.trim() },
    shureReceivers: candidate.shureReceivers.map((receiver) => ({
      ...receiver,
      name: receiver.name.trim(),
      host: receiver.host.trim(),
    })),
    channels: candidate.channels.map((channel) => ({
      ...channel,
      name: channel.name.trim(),
      ...(channel.performer === undefined
        ? {}
        : { performer: channel.performer?.trim() || null }),
    })),
    ...(candidate.sessions === undefined
      ? {}
      : {
          sessions: candidate.sessions.map((session) => ({
            ...session,
            name: session.name.trim(),
            channels: session.channels.map((entry) => ({
              ...entry,
              presenter: entry.presenter?.trim() || null,
            })),
          })),
        }),
  };
}

/**
 * Gives every channel a stable identity. Alerts, level history and future
 * assignment records key on this id, so it must survive renames, repatching
 * and reordering. Existing ids are kept; only missing ones are minted.
 */
export function assignChannelIds(candidate: Showfile): Showfile {
  const used = new Set(
    candidate.channels.flatMap(({ id }) => (id === undefined ? [] : [id])),
  );
  return {
    ...candidate,
    channels: candidate.channels.map((channel) => {
      if (channel.id !== undefined) return channel;
      let id = `ch-${randomUUID().slice(0, 8)}`;
      while (used.has(id)) id = `ch-${randomUUID().slice(0, 8)}`;
      used.add(id);
      return { id, ...channel };
    }),
  };
}

/**
 * Gives every session a stable identity, the key the running session is held
 * under, and drops session entries for channels the show no longer has so a
 * removed channel cannot linger in a run of show.
 */
export function normalizeSessions(candidate: Showfile): Showfile {
  if (candidate.sessions === undefined) return candidate;
  const channelIds = new Set(
    candidate.channels.flatMap(({ id }) => (id === undefined ? [] : [id])),
  );
  const used = new Set(
    candidate.sessions.flatMap(({ id }) => (id === undefined ? [] : [id])),
  );
  return {
    ...candidate,
    sessions: candidate.sessions.map((session) => {
      let id = session.id;
      if (id === undefined) {
        id = `ses-${randomUUID().slice(0, 8)}`;
        while (used.has(id)) id = `ses-${randomUUID().slice(0, 8)}`;
        used.add(id);
      }
      return {
        id,
        ...session,
        channels: session.channels.filter(({ channelId }) =>
          channelIds.has(channelId),
        ),
      };
    }),
  };
}

/** Session ids are unique, names are not blank, and no session lists a channel twice. */
export function hasCoherentSessions(candidate: Showfile): boolean {
  if (candidate.sessions === undefined) return true;
  const ids = candidate.sessions.flatMap(({ id }) =>
    id === undefined ? [] : [id],
  );
  if (new Set(ids).size !== ids.length) return false;
  return candidate.sessions.every(({ name, channels }) => {
    const channelIds = channels.map(({ channelId }) => channelId);
    return (
      name.trim().length > 0 && new Set(channelIds).size === channelIds.length
    );
  });
}

export function hasUniqueChannelIds(candidate: Showfile): boolean {
  const ids = candidate.channels.flatMap(({ id }) =>
    id === undefined ? [] : [id],
  );
  return new Set(ids).size === ids.length;
}

const DEFAULT_MONITOR = { battery: true, rf: true, audio: true };

export function migrateShowfile(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const needsReceivers = record.shureReceivers === undefined;
  return {
    ...record,
    shureReceivers: needsReceivers ? [] : record.shureReceivers,
    channels: Array.isArray(record.channels)
      ? record.channels.map((channel, position) => {
          if (typeof channel !== "object" || channel === null) return channel;
          const channelRecord = channel as Record<string, unknown>;
          return {
            // Channels saved before ids existed get a position-derived id so
            // repeated loads agree; the next save persists it unchanged.
            id: channelRecord.id ?? `legacy-${position + 1}`,
            ...(needsReceivers
              ? {
                  ...channelRecord,
                  shureReceiverId: null,
                  shureChannelIndex: null,
                }
              : channelRecord),
            monitor: channelRecord.monitor ?? DEFAULT_MONITOR,
          };
        })
      : record.channels,
  };
}
