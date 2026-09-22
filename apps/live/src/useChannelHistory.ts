import { useEffect, useState } from "react";
import {
  parseChannelLevelHistory,
  type ChannelLevelHistory,
} from "@rvlt/pulse-protocol/http";

export type ChannelHistoryState =
  | { status: "waiting" }
  | { status: "ready"; history: ChannelLevelHistory }
  | { status: "unavailable" };

/**
 * Polls the backend's bounded level-history store for one channel — the
 * building block behind both the card's rolling trace and the player's
 * timeline. A missing channel (e.g. a directly observed device input, which
 * the backend's ring buffer does not know about) reads honestly as
 * "unavailable" rather than fabricating a flat line.
 */
export function useChannelHistory(
  channelId: string | null,
  windowMs: number,
  refreshMs = 1000,
): ChannelHistoryState {
  const [state, setState] = useState<ChannelHistoryState>({
    status: "waiting",
  });

  useEffect(() => {
    if (!channelId) return;

    let cancelled = false;
    const controller = new AbortController();
    let timer: number | undefined;

    async function poll() {
      try {
        const response = await fetch(
          `/api/v1/live/history?channelId=${encodeURIComponent(channelId!)}&windowMs=${Math.round(windowMs)}`,
          { signal: controller.signal },
        );
        if (cancelled) return;
        if (response.ok) {
          setState({
            status: "ready",
            history: parseChannelLevelHistory(await response.json()),
          });
        } else {
          setState({ status: "unavailable" });
        }
      } catch {
        if (!cancelled) {
          setState((current) =>
            current.status === "ready" ? current : { status: "unavailable" },
          );
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, refreshMs);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [channelId, windowMs, refreshMs]);

  return channelId ? state : { status: "unavailable" };
}
