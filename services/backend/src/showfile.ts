import showfileSchema from "@a2-monitor/protocol/schema/showfile" with { type: "json" };
import type { Showfile } from "@a2-monitor/protocol/http";
import { createStrictAjv2020 } from "@a2-monitor/protocol/validation/strict-ajv";

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
    })),
  };
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
      ? record.channels.map((channel) => {
          if (typeof channel !== "object" || channel === null) return channel;
          const channelRecord = channel as Record<string, unknown>;
          return {
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
