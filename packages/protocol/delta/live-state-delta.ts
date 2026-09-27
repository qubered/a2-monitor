import type {
  LiveState,
  LiveStateChannelPatch,
  LiveStateDelta,
} from "../generated/http-contracts.js";

// Sections a delta may replace; `channels` is patched per channel instead.
const SECTIONS = [
  "revision",
  "show",
  "node",
  "receivers",
  "alerts",
  "reports",
  "rooms",
  "runs",
  "summary",
] as const satisfies readonly (keyof LiveState & keyof LiveStateDelta)[];

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * What changed from `previous` to `next`, as a `delta` event for the live
 * state stream, or `null` when only a full state can say it: the channel list
 * changed shape, or a section or field disappeared (a delta only replaces).
 */
export function diffLiveState(
  previous: LiveState,
  previousSequence: number,
  next: LiveState,
  nextSequence: number,
): LiveStateDelta | null {
  if (previous.schemaVersion !== next.schemaVersion) return null;
  if (
    previous.channels.length !== next.channels.length ||
    previous.channels.some(({ id }, index) => next.channels[index]?.id !== id)
  ) {
    return null;
  }
  const delta: LiveStateDelta = {
    schemaVersion: next.schemaVersion,
    sequence: nextSequence,
    baseSequence: previousSequence,
    generatedAtUtc: next.generatedAtUtc,
  };
  for (const section of SECTIONS) {
    if (next[section] === undefined) {
      if (previous[section] !== undefined) return null;
      continue;
    }
    if (!same(previous[section], next[section])) {
      (delta as Record<string, unknown>)[section] = next[section];
    }
  }
  const patches: LiveStateChannelPatch[] = [];
  for (const [index, channel] of next.channels.entries()) {
    const before = previous.channels[index]! as Record<string, unknown>;
    const after = channel as Record<string, unknown>;
    if (Object.keys(before).some((key) => !(key in after))) return null;
    const patch: Record<string, unknown> = { id: channel.id };
    for (const [key, value] of Object.entries(after)) {
      if (!same(before[key], value)) patch[key] = value;
    }
    if (Object.keys(patch).length > 1) {
      patches.push(patch as LiveStateChannelPatch);
    }
  }
  if (patches.length) delta.channels = patches;
  return delta;
}

/**
 * The state a delta describes, built from the state it was taken against.
 * Unvalidated: the caller parses the result as a LiveState before showing it.
 * Throws when the delta names a channel the base does not have.
 */
export function applyLiveStateDelta(
  base: LiveState,
  delta: LiveStateDelta,
): unknown {
  const next: Record<string, unknown> = {
    ...base,
    generatedAtUtc: delta.generatedAtUtc,
  };
  for (const section of SECTIONS) {
    if (delta[section] !== undefined) next[section] = delta[section];
  }
  if (delta.channels?.length) {
    const byId = new Map(delta.channels.map((patch) => [patch.id, patch]));
    const channels = base.channels.map((channel) => {
      const patch = byId.get(channel.id);
      if (!patch) return channel;
      byId.delete(channel.id);
      return { ...channel, ...patch };
    });
    if (byId.size) throw new Error("Delta names a channel the base lacks.");
    next.channels = channels;
  }
  return next;
}
