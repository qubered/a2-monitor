import { useEffect, useState } from "react";
import type { LiveSnapshot } from "@a2-monitor/protocol/http";
import { SnapshotOfflineError, type SnapshotSource } from "./snapshot";

export type SnapshotState =
  | { status: "waiting"; snapshot: null }
  | { status: "ready"; snapshot: LiveSnapshot }
  | { status: "reconnecting"; snapshot: LiveSnapshot | null }
  | {
      status: "offline" | "error";
      snapshot: LiveSnapshot | null;
      message: string;
    };

export function useLiveSnapshot(source: SnapshotSource) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SnapshotState>({
    status: "waiting",
    snapshot: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    void source.load(controller.signal).then(
      (snapshot) => setState({ status: "ready", snapshot }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          status: error instanceof SnapshotOfflineError ? "offline" : "error",
          snapshot: current.snapshot,
          message:
            error instanceof Error
              ? error.message
              : "The snapshot request failed without a usable reason.",
        }));
      },
    );

    return () => controller.abort();
  }, [attempt, source]);

  return {
    state,
    reconnect: () => {
      setState((current) => ({
        status: "reconnecting",
        snapshot: current.snapshot,
      }));
      setAttempt((current) => current + 1);
    },
  };
}
