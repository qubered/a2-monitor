import { useEffect, useState } from "react";
import {
  parseRecordingSpans,
  parseRecordingState,
  type RecordingSpan,
  type RecordingState,
} from "@rvlt/pulse-protocol/http";

export type RecordedAudio =
  | { status: "unknown" }
  | { status: "unavailable" }
  | {
      status: "ready";
      recording: RecordingState;
      /** Where the node holds audio for this input, oldest first. */
      spans: readonly RecordingSpan[];
    };

export const RECORDED_AUDIO_REFRESH_MS = 5_000;

/**
 * What the node has recorded for one input, so the history timeline can show
 * where audio exists to listen back to. "Unavailable" is a node that cannot
 * be reached or does not record; it is never read as "nothing was said".
 */
export function useRecordedAudio(
  input: number | null,
  active: boolean,
  refreshMs = RECORDED_AUDIO_REFRESH_MS,
): RecordedAudio {
  const [state, setState] = useState<RecordedAudio>({ status: "unknown" });

  useEffect(() => {
    if (!active || input === null) return;
    let cancelled = false;
    const controller = new AbortController();
    let timer: number | undefined;

    async function poll() {
      try {
        const stateResponse = await fetch("/audio/v0/recording", {
          signal: controller.signal,
        });
        if (cancelled) return;
        const recording = stateResponse.ok
          ? parseRecordingState(await stateResponse.json())
          : null;
        if (!recording?.available) {
          setState({ status: "unavailable" });
          return;
        }
        const spansResponse = await fetch(
          `/audio/v0/recording/spans?channel=${input}`,
          { signal: controller.signal },
        );
        if (cancelled) return;
        setState(
          spansResponse.ok
            ? {
                status: "ready",
                recording,
                spans: parseRecordingSpans(await spansResponse.json()).spans,
              }
            : { status: "unavailable" },
        );
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
  }, [input, active, refreshMs]);

  return active && input !== null ? state : { status: "unknown" };
}

/** The span holding `atMs`, if the node has audio there. */
export function spanAt(
  spans: readonly RecordingSpan[],
  atMs: number,
): RecordingSpan | undefined {
  return spans.find(
    (span) =>
      Date.parse(span.startUtc) <= atMs && atMs < Date.parse(span.endUtc),
  );
}
