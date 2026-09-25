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
    ...(candidate.rooms === undefined
      ? {}
      : {
          rooms: candidate.rooms.map((room) => ({
            ...room,
            name: room.name.trim(),
            categories: room.categories.map((category) => ({
              ...category,
              name: category.name.trim(),
            })),
          })),
        }),
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

function mintId(prefix: string, used: Set<string>): string {
  let id = `${prefix}-${randomUUID().slice(0, 8)}`;
  while (used.has(id)) id = `${prefix}-${randomUUID().slice(0, 8)}`;
  used.add(id);
  return id;
}

/**
 * Gives every room and category a stable identity, then clears channel
 * membership the show can no longer honour: a room it does not have, or a
 * category that is not in that membership's room (ADR 0035). A channel keeps
 * its place and patch either way; it just stops claiming the missing rooms
 * or categories. Repeated memberships of the same room collapse to the first.
 */
export function normalizeRooms(candidate: Showfile): Showfile {
  if (candidate.rooms === undefined) {
    return candidate.channels.some(({ rooms }) => rooms && rooms.length > 0)
      ? {
          ...candidate,
          channels: candidate.channels.map((channel) => ({
            ...channel,
            rooms: [],
          })),
        }
      : candidate;
  }
  const used = new Set(
    candidate.rooms.flatMap((room) => [
      ...(room.id === undefined ? [] : [room.id]),
      ...room.categories.flatMap(({ id }) => (id === undefined ? [] : [id])),
    ]),
  );
  const rooms = candidate.rooms.map((room) => ({
    ...room,
    id: room.id ?? mintId("room", used),
    categories: room.categories.map((category) => ({
      ...category,
      id: category.id ?? mintId("cat", used),
    })),
  }));
  const categoriesByRoom = new Map(
    rooms.map(({ id, categories }) => [
      id,
      new Set(categories.map((category) => category.id)),
    ]),
  );
  return {
    ...candidate,
    rooms,
    channels: candidate.channels.map((channel) => {
      if (channel.rooms === undefined) return channel;
      const seen = new Set<string>();
      const cleaned = channel.rooms.flatMap((membership) => {
        const categories = categoriesByRoom.get(membership.roomId);
        if (!categories || seen.has(membership.roomId)) return [];
        seen.add(membership.roomId);
        return [
          {
            roomId: membership.roomId,
            categoryId:
              membership.categoryId && categories.has(membership.categoryId)
                ? membership.categoryId
                : null,
          },
        ];
      });
      return { ...channel, rooms: cleaned };
    }),
  };
}

/**
 * Gives every session a stable identity, the key the running session is held
 * under, clears a room the show no longer has, and drops session entries for
 * channels the show no longer has or that are not in the session's room, so a
 * removed or moved channel cannot linger in a run of show.
 */
export function normalizeSessions(candidate: Showfile): Showfile {
  if (candidate.sessions === undefined) return candidate;
  const roomIds = new Set(
    (candidate.rooms ?? []).flatMap(({ id }) => (id === undefined ? [] : [id])),
  );
  const channelRooms = new Map(
    candidate.channels.flatMap(({ id, rooms }) =>
      id === undefined
        ? []
        : [[id, (rooms ?? []).map(({ roomId }) => roomId)] as const],
    ),
  );
  const used = new Set(
    candidate.sessions.flatMap(({ id }) => (id === undefined ? [] : [id])),
  );
  return {
    ...candidate,
    sessions: candidate.sessions.map((session) => {
      const roomId =
        session.roomId != null && roomIds.has(session.roomId)
          ? session.roomId
          : null;
      return {
        id: session.id ?? mintId("ses", used),
        ...session,
        ...(session.roomId === undefined && roomId === null ? {} : { roomId }),
        channels: session.channels.filter(({ channelId }) => {
          const memberships = channelRooms.get(channelId);
          if (memberships === undefined) return false;
          return roomId === null
            ? memberships.length === 0
            : memberships.includes(roomId);
        }),
      };
    }),
  };
}

/** Room and category ids are unique across the show and no name is blank. */
export function hasCoherentRooms(candidate: Showfile): boolean {
  if (candidate.rooms === undefined) return true;
  const ids = candidate.rooms.flatMap((room) => [
    ...(room.id === undefined ? [] : [room.id]),
    ...room.categories.flatMap(({ id }) => (id === undefined ? [] : [id])),
  ]);
  if (new Set(ids).size !== ids.length) return false;
  return candidate.rooms.every(
    ({ name, categories }) =>
      name.trim().length > 0 &&
      categories.every((category) => category.name.trim().length > 0),
  );
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

/**
 * Unreleased builds saved host output as one list of channels, then as
 * `sessions`; both become `feeds` so a saved output (for example 12) keeps
 * playing.
 */
function migrateHostOutput(hostOutput: unknown): Record<string, unknown> {
  if (
    typeof hostOutput !== "object" ||
    hostOutput === null ||
    "feeds" in hostOutput
  ) {
    return {};
  }
  if ("sessions" in hostOutput) {
    return { hostOutput: { feeds: hostOutput.sessions } };
  }
  if ("outputChannels" in hostOutput) {
    return {
      hostOutput: {
        feeds: [
          {
            id: "default",
            name: "Host output",
            outputChannels: hostOutput.outputChannels,
          },
        ],
      },
    };
  }
  return {};
}

/**
 * Channels saved before ADR 0035 named one `roomId`/`categoryId`; both become
 * a single-entry (or empty) `rooms` array so an old showfile keeps its place.
 */
function migrateChannelRooms(
  channelRecord: Record<string, unknown>,
): Record<string, unknown> {
  if ("rooms" in channelRecord) return channelRecord;
  if (!("roomId" in channelRecord) && !("categoryId" in channelRecord)) {
    return channelRecord;
  }
  const { roomId, categoryId, ...rest } = channelRecord;
  return {
    ...rest,
    rooms:
      typeof roomId === "string"
        ? [
            {
              roomId,
              categoryId: typeof categoryId === "string" ? categoryId : null,
            },
          ]
        : [],
  };
}

export function migrateShowfile(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const needsReceivers = record.shureReceivers === undefined;
  return {
    ...record,
    ...migrateHostOutput(record.hostOutput),
    shureReceivers: needsReceivers ? [] : record.shureReceivers,
    channels: Array.isArray(record.channels)
      ? record.channels.map((channel, position) => {
          if (typeof channel !== "object" || channel === null) return channel;
          const channelRecord = migrateChannelRooms(
            channel as Record<string, unknown>,
          );
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
