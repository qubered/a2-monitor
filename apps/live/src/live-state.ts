import { parseLiveState, type LiveState } from "@rvlt/pulse-protocol/http";

export type LiveStateConnection =
  "connecting" | "live" | "reconnecting" | "offline";

export type LiveStateListener = {
  onState: (state: LiveState) => void;
  onConnection: (connection: LiveStateConnection) => void;
};

/** A subscription to the backend's shared monitoring state. */
export interface LiveStateSource {
  subscribe(listener: LiveStateListener): () => void;
}

/** After this long without a valid state the backend is treated as offline, not merely reconnecting. */
export const OFFLINE_AFTER_MS = 6_000;

type EventSourceConstructor = new (url: string) => EventSource;

/**
 * Server-sent events from `/api/v1/live/events`. The browser reconnects on
 * its own; this adapter validates every state against the closed contract and
 * reports the connection honestly, so a silent stream reads as offline rather
 * than as a quiet show.
 */
export function createEventSourceLiveState(
  EventSourceClass: EventSourceConstructor = window.EventSource,
): LiveStateSource {
  return {
    subscribe({ onState, onConnection }) {
      const source = new EventSourceClass("/api/v1/live/events");
      let receivedAny = false;
      let offlineTimer: number | undefined;
      const armOffline = () => {
        if (offlineTimer !== undefined) window.clearTimeout(offlineTimer);
        offlineTimer = window.setTimeout(
          () => onConnection("offline"),
          OFFLINE_AFTER_MS,
        );
      };
      onConnection("connecting");
      armOffline();
      source.addEventListener("state", (event) => {
        try {
          const state = parseLiveState(
            JSON.parse((event as MessageEvent<string>).data),
          );
          receivedAny = true;
          armOffline();
          onConnection("live");
          onState(state);
        } catch {
          // A state that fails its contract is never shown.
        }
      });
      source.onerror = () => {
        onConnection(receivedAny ? "reconnecting" : "connecting");
      };
      return () => {
        if (offlineTimer !== undefined) window.clearTimeout(offlineTimer);
        source.close();
      };
    },
  };
}

/** Test and preview double that delivers fixed states on demand. */
export function createManualLiveState(): LiveStateSource & {
  push(state: LiveState): void;
  setConnection(connection: LiveStateConnection): void;
} {
  const listeners = new Set<LiveStateListener>();
  let last: LiveState | null = null;
  let connection: LiveStateConnection = "connecting";
  return {
    subscribe(listener) {
      listeners.add(listener);
      listener.onConnection(connection);
      if (last) listener.onState(last);
      return () => listeners.delete(listener);
    },
    push(state) {
      last = state;
      connection = "live";
      for (const listener of listeners) {
        listener.onConnection("live");
        listener.onState(state);
      }
    },
    setConnection(next) {
      connection = next;
      for (const listener of listeners) listener.onConnection(next);
    },
  };
}

export class AcknowledgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcknowledgeError";
  }
}

/** Clears one channel's alerts and returns it to its default state; returns the updated shared state. */
export async function resetChannel(
  channelId: string,
  fetchResponse: typeof fetch = fetch,
): Promise<LiveState> {
  const response = await fetchResponse(
    `/api/v1/channels/${encodeURIComponent(channelId)}/reset`,
    { method: "POST" },
  );
  if (response.status === 404) {
    throw new AcknowledgeError("That channel is no longer in the show.");
  }
  if (!response.ok) {
    throw new AcknowledgeError(
      `The channel was not reset (HTTP ${response.status}).`,
    );
  }
  return parseLiveState(await response.json());
}

/** Acknowledges one alert as the named operator and returns the updated shared state. */
export async function acknowledgeAlert(
  alertId: string,
  operator: string,
  fetchResponse: typeof fetch = fetch,
): Promise<LiveState> {
  const response = await fetchResponse(
    `/api/v1/alerts/${encodeURIComponent(alertId)}/acknowledge`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator }),
    },
  );
  if (response.status === 404) {
    throw new AcknowledgeError("That alert has already cleared.");
  }
  if (!response.ok) {
    throw new AcknowledgeError(
      `The acknowledgement was not recorded (HTTP ${response.status}).`,
    );
  }
  return parseLiveState(await response.json());
}
