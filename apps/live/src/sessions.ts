import {
  parseLiveState,
  type LiveState,
  type LiveStateChannel,
} from "@rvlt/pulse-protocol/http";

/** One room's run of show (the room is null for channels in no room). */
export type SessionState = NonNullable<LiveState["runs"]>[number];
export type SessionSummary = SessionState["sessions"][number];
export type Room = NonNullable<LiveState["rooms"]>[number];

/** Channels outside every room are shown and run under this key. */
export const NO_ROOM = "no-room";

export function roomKeyOf(roomId: string | null | undefined): string {
  return roomId ?? NO_ROOM;
}

/** A scheduled start as local wall-clock time, from minutes after midnight. */
export function formatStartMinute(minute: number | null): string | null {
  if (minute === null) return null;
  const hours = Math.floor(minute / 60);
  return `${String(hours).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function sessionById(
  session: SessionState | undefined,
  id: string | null,
): SessionSummary | null {
  if (!session || id === null) return null;
  return session.sessions.find((entry) => entry.id === id) ?? null;
}

/**
 * How long the next session is scheduled to run: from its start to the start
 * of the one after it. Null when either time is missing, so an unscheduled
 * session never produces a made-up duration.
 */
export function nextSessionMinutes(
  session: SessionState | undefined,
): number | null {
  if (!session || session.nextId === null) return null;
  const position = session.sessions.findIndex(
    ({ id }) => id === session.nextId,
  );
  const start = session.sessions[position]?.startMinute ?? null;
  const end = session.sessions[position + 1]?.startMinute ?? null;
  if (start === null || end === null || end <= start) return null;
  return end - start;
}

export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours ? `${hours} h ` : ""}${minutes} min`;
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

/**
 * Starts a session in its room for every client, or ends that room's run
 * with a null session (room null for channels in no room).
 */
export async function startSession(
  sessionId: string | null,
  roomId: string | null,
  operator: string,
  fetchResponse: typeof fetch = fetch,
): Promise<LiveState> {
  const response = await fetchResponse("/api/v1/live/session", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, roomId, operator }),
  });
  if (response.status === 404) {
    throw new SessionError(
      "That session is no longer in the showfile. Nothing changed.",
    );
  }
  if (!response.ok) {
    throw new SessionError(
      `The session did not change (HTTP ${response.status}).`,
    );
  }
  return parseLiveState(await response.json());
}

export type TurnoverTone = "ready" | "action" | "unknown";

export type TurnoverItem = {
  channel: LiveStateChannel;
  /** The presenter the next session names, when it differs from now. */
  presenterChange: { from: string | null; to: string } | null;
  tone: TurnoverTone;
  /** What to do or what is known, short and specific. */
  readiness: string;
};

function batteryReading(channel: LiveStateChannel): string | null {
  const { percent, bars, runtimeMinutes } = channel.battery;
  const reading =
    percent !== null ? `${percent} %` : bars !== null ? `${bars}/5 bars` : null;
  if (reading === null) return null;
  if (runtimeMinutes === null) return reading;
  return `${reading} · ${formatMinutes(runtimeMinutes)}`;
}

/**
 * What each channel the next session needs is waiting on: a battery swap, a
 * transmitter that is off, a presenter change. Unknown stays unknown; a
 * channel is only "ready" on a current, healthy measurement. When the next
 * session's length is scheduled, a pack whose reported runtime will not last
 * it needs changing even if its charge is above the caution threshold.
 */
export function turnoverItems(
  channels: readonly LiveStateChannel[],
  sessionMinutes: number | null = null,
): TurnoverItem[] {
  return channels
    .filter(({ session }) => session?.nextInUse === true)
    .map((channel) => {
      const to = channel.session?.nextPresenter ?? null;
      const presenterChange =
        to !== null && to !== channel.performer
          ? { from: channel.performer, to }
          : null;
      if (channel.kind === "wired") {
        return {
          channel,
          presenterChange,
          tone: "ready" as const,
          readiness: "Wired · no pack to change",
        };
      }
      const battery = channel.statuses.battery;
      const reading = batteryReading(channel);
      if (channel.rf.transmitterPresent === false) {
        return {
          channel,
          presenterChange,
          tone: "action" as const,
          readiness: "Transmitter off · switch on and check",
        };
      }
      if (battery === "fault" || battery === "caution") {
        return {
          channel,
          presenterChange,
          tone: "action" as const,
          readiness: `Change battery${reading ? ` · ${reading}` : ""}`,
        };
      }
      const runtime = channel.battery.runtimeMinutes;
      if (
        battery === "good" &&
        sessionMinutes !== null &&
        runtime !== null &&
        runtime < sessionMinutes
      ) {
        return {
          channel,
          presenterChange,
          tone: "action" as const,
          readiness: `Change battery · ${formatMinutes(runtime)} left, session runs ${formatMinutes(sessionMinutes)}`,
        };
      }
      if (battery === "good" && reading) {
        return {
          channel,
          presenterChange,
          tone: "ready" as const,
          readiness: `Battery ${reading}`,
        };
      }
      return {
        channel,
        presenterChange,
        tone: "unknown" as const,
        readiness: "Battery unknown · check the pack",
      };
    });
}
