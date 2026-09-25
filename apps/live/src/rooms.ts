import type { LiveStateChannel } from "@rvlt/pulse-protocol/http";
import { NO_ROOM, type Room } from "./sessions";

/** Every room on this device, or one room's key (a room id or `NO_ROOM`). */
export type RoomChoice = "all" | string;

export type ChannelGroup = {
  key: string;
  /** Heading for the group; null when the show has no rooms at all. */
  title: string | null;
  channels: LiveStateChannel[];
};

/** The rooms a channel belongs to, or none for a channel in no room (ADR 0035). */
export function membershipsOf(
  channel: LiveStateChannel,
): readonly NonNullable<LiveStateChannel["rooms"]>[number][] {
  return channel.rooms ?? [];
}

/** The category a channel has in one specific room; null with no membership there. */
export function categoryIdInRoom(
  channel: LiveStateChannel,
  roomId: string,
): string | null {
  return (
    membershipsOf(channel).find((entry) => entry.roomId === roomId)
      ?.categoryId ?? null
  );
}

/**
 * The room this device shows: the stored choice while the show still has it,
 * otherwise every room. A remembered room from another show never hides
 * channels.
 */
export function effectiveRoom(
  choice: RoomChoice,
  rooms: readonly Room[],
  channels: readonly LiveStateChannel[],
): RoomChoice {
  if (choice === "all") return "all";
  if (choice === NO_ROOM) {
    return rooms.length > 0 &&
      channels.some((channel) => membershipsOf(channel).length === 0)
      ? NO_ROOM
      : "all";
  }
  return rooms.some(({ id }) => id === choice) ? choice : "all";
}

export function inRoom(channel: LiveStateChannel, choice: RoomChoice): boolean {
  if (choice === "all") return true;
  const memberships = membershipsOf(channel);
  return choice === NO_ROOM
    ? memberships.length === 0
    : memberships.some(({ roomId }) => roomId === choice);
}

/**
 * Channels grouped under room and category headings, in showfile order for
 * rooms, categories and the channels inside them. Channels without a category
 * follow their room's categories; channels in no room come last. Showing one
 * room drops its name from the headings.
 */
export function groupChannels(
  channels: readonly LiveStateChannel[],
  rooms: readonly Room[],
  choice: RoomChoice,
): ChannelGroup[] {
  if (rooms.length === 0) {
    return [{ key: "all", title: null, channels: [...channels] }];
  }
  const groups: ChannelGroup[] = [];
  const push = (key: string, title: string, members: LiveStateChannel[]) => {
    if (members.length) groups.push({ key, title, channels: members });
  };
  const withRoom = (room: Room, label: string) =>
    choice === "all" ? `${room.name} · ${label}` : label;

  for (const room of rooms) {
    if (choice !== "all" && choice !== room.id) continue;
    // A channel in several rooms (ADR 0035) appears in each; its category
    // here is this room's own membership, not any other room's.
    const members = channels.flatMap((channel) => {
      const membership = membershipsOf(channel).find(
        ({ roomId }) => roomId === room.id,
      );
      return membership ? [{ channel, categoryId: membership.categoryId }] : [];
    });
    const categoryIds = new Set(room.categories.map(({ id }) => id));
    for (const category of room.categories) {
      push(
        `${room.id}/${category.id}`,
        withRoom(room, category.name),
        members
          .filter(({ categoryId }) => categoryId === category.id)
          .map(({ channel }) => channel),
      );
    }
    push(
      `${room.id}/none`,
      room.categories.length
        ? withRoom(room, "No category")
        : choice === "all"
          ? room.name
          : "All channels",
      members
        .filter(({ categoryId }) => !categoryId || !categoryIds.has(categoryId))
        .map(({ channel }) => channel),
    );
  }
  if (choice === "all" || choice === NO_ROOM) {
    push(
      NO_ROOM,
      "No room",
      channels.filter((channel) => membershipsOf(channel).length === 0),
    );
  }
  return groups;
}

export type RoomOption = {
  key: RoomChoice;
  label: string;
  channelCount: number;
  /** Unacknowledged alerts on this room's channels. */
  outstanding: number;
  critical: number;
  /** Alerts on this room's channels that someone has seen. */
  seen: number;
  /** "Now: Keynote" or "Next: Panel 10:15"; null when the room runs no sessions. */
  session: string | null;
};

export function roomTone(option: RoomOption): "critical" | "caution" | "clear" {
  return option.critical > 0
    ? "critical"
    : option.outstanding > 0
      ? "caution"
      : "clear";
}
