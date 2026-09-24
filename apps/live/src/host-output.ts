import { useCallback, useEffect, useState } from "react";
import { parseHostOutput, type HostOutput } from "@rvlt/pulse-protocol/http";

export type HostMonitor = HostOutput["monitor"];

/** A partial change to the shared host monitor. Selection changes carry both fields. */
export type HostMonitorChange = {
  channelId?: string | null;
  input?: number | null;
  muted?: boolean;
  dimmed?: boolean;
  gainDb?: number;
  changedBy?: string;
};

/** Where this device's monitor audio plays (ADR 0029). */
export type OutputDestination = "device" | "host";

export type HostOutputConnection = "connecting" | "live" | "offline";

export type HostOutputListener = {
  onDocument: (document: HostOutput) => void;
  onConnection: (connection: HostOutputConnection) => void;
};

export interface HostOutputSource {
  subscribe(listener: HostOutputListener): () => void;
  /** Applies a change for every host-output client and returns the new document. */
  change(change: HostMonitorChange): Promise<HostOutput>;
}

export const HOST_OUTPUT_PATH = "/audio/v0/output";
/** After this long without a document the node is treated as offline. */
export const HOST_OUTPUT_OFFLINE_AFTER_MS = 6_000;
const DESTINATION_KEY = "pulse-output-destination";

type EventSourceConstructor = new (url: string) => EventSource;

const changeErrors: Record<string, string> = {
  "host-output-not-configured": "The audio node has no host output device.",
  "audio-not-ready": "The audio node is not capturing yet.",
  "invalid-channel": "That input is not on the running device.",
};

export function createHttpHostOutputSource(
  EventSourceClass?: EventSourceConstructor,
  fetchImpl: typeof fetch = (...args) => window.fetch(...args),
): HostOutputSource {
  return {
    subscribe({ onDocument, onConnection }) {
      const source = new (EventSourceClass ?? window.EventSource)(
        `${HOST_OUTPUT_PATH}/events`,
      );
      let offlineTimer: number | undefined;
      const armOffline = () => {
        if (offlineTimer !== undefined) window.clearTimeout(offlineTimer);
        offlineTimer = window.setTimeout(
          () => onConnection("offline"),
          HOST_OUTPUT_OFFLINE_AFTER_MS,
        );
      };
      onConnection("connecting");
      armOffline();
      source.addEventListener("output", (event) => {
        try {
          const document = parseHostOutput(
            JSON.parse((event as MessageEvent<string>).data),
          );
          // The node only sends on change, so a quiet stream is not a lost one;
          // an error event (below) is what reports loss.
          if (offlineTimer !== undefined) window.clearTimeout(offlineTimer);
          offlineTimer = undefined;
          onConnection("live");
          onDocument(document);
        } catch {
          // A document that fails its contract is never shown.
        }
      });
      source.onerror = () => {
        onConnection("connecting");
        armOffline();
      };
      return () => {
        if (offlineTimer !== undefined) window.clearTimeout(offlineTimer);
        source.close();
      };
    },
    async change(change) {
      let response: Response;
      try {
        response = await fetchImpl(HOST_OUTPUT_PATH, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(change),
        });
      } catch {
        throw new Error("The audio node is unreachable.");
      }
      if (!response.ok) {
        let code = "";
        try {
          code = String(((await response.json()) as { error?: unknown }).error);
        } catch {
          // The status alone is reported.
        }
        throw new Error(
          changeErrors[code] ??
            `The audio node refused the change (HTTP ${response.status}).`,
        );
      }
      return parseHostOutput(await response.json());
    },
  };
}

/** Test double: push documents and record changes. */
export function createManualHostOutput(): HostOutputSource & {
  push(document: HostOutput): void;
  setConnection(connection: HostOutputConnection): void;
  changes: HostMonitorChange[];
} {
  const listeners = new Set<HostOutputListener>();
  let last: HostOutput | null = null;
  let connection: HostOutputConnection = "connecting";
  const changes: HostMonitorChange[] = [];
  return {
    changes,
    subscribe(listener) {
      listeners.add(listener);
      listener.onConnection(connection);
      if (last) listener.onDocument(last);
      return () => listeners.delete(listener);
    },
    push(document) {
      last = document;
      connection = "live";
      for (const listener of listeners) {
        listener.onConnection("live");
        listener.onDocument(document);
      }
    },
    setConnection(next) {
      connection = next;
      for (const listener of listeners) listener.onConnection(next);
    },
    async change(change) {
      changes.push(change);
      if (!last) throw new Error("The audio node is unreachable.");
      const { changedBy, ...fields } = change;
      const next: HostOutput = {
        ...last,
        revision: last.revision + 1,
        monitor: {
          ...last.monitor,
          ...fields,
          changedBy: changedBy ?? null,
          changedAtUtc: new Date().toISOString(),
        },
      };
      this.push(next);
      return next;
    },
  };
}

export function useHostOutput(source: HostOutputSource) {
  const [connection, setConnection] =
    useState<HostOutputConnection>("connecting");
  const [document, setDocument] = useState<HostOutput | null>(null);

  useEffect(() => {
    // Stream documents arrive in order and are always taken, including a
    // restarted node's revision 0.
    return source.subscribe({
      onDocument: setDocument,
      onConnection: setConnection,
    });
  }, [source]);

  const change = useCallback(
    async (next: HostMonitorChange) => {
      const updated = await source.change(next);
      // A response must not undo a newer document the stream already delivered.
      setDocument((current) =>
        current && updated.revision < current.revision ? current : updated,
      );
    },
    [source],
  );

  return { connection, document, change };
}

export function readLastDestination(): OutputDestination | null {
  try {
    const stored = window.localStorage.getItem(DESTINATION_KEY);
    return stored === "device" || stored === "host" ? stored : null;
  } catch {
    return null;
  }
}

export function saveLastDestination(destination: OutputDestination): void {
  try {
    window.localStorage.setItem(DESTINATION_KEY, destination);
  } catch {
    // The choice still applies for this session.
  }
}

/** "output 3" or "outputs 1 + 2". */
export function describeOutputChannels(channels: readonly number[]): string {
  return `${channels.length === 1 ? "output" : "outputs"} ${channels.join(" + ")}`;
}
