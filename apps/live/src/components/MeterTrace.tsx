import { useEffect, useRef } from "react";
import {
  drawTrace,
  readTraceTheme,
  scheduleTraceRedraw,
  type TraceSample,
} from "@rvlt/pulse-ui/visualization";
import type { MeterStore } from "../meters";

const BUCKETS = 40;
const DISPLAY_FLOOR_DBFS = -60;
/** Below this the bar is drawn as silence (a flat --ink-2 rule), not as a small green bar. */
const SILENT_BELOW_DBFS = -60;
const MIN_REDRAW_MS = 100;

type MeterTraceProps = {
  store: MeterStore;
  input: number | null;
  /** True when the node is not ready: every bar is hatched as stale. */
  stale: boolean;
  className?: string;
};

/**
 * A card's 10-second rolling trace (design system §10.1), drawn straight from
 * the node's meter stream at its data rate. Present signal is --ok, silence
 * is a flat rule, a gap is unknown and a lost stream is hatched stale.
 */
export function MeterTrace({
  store,
  input,
  stale,
  className,
}: MeterTraceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let lastDrawMs = 0;
    let cancelScheduled: (() => void) | null = null;
    let delayTimer: number | undefined;

    function redraw() {
      cancelScheduled = null;
      lastDrawMs = performance.now();
      const context = canvas!.getContext("2d");
      if (!context) return;
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas!.width !== width || canvas!.height !== height) {
        canvas!.width = width;
        canvas!.height = height;
      }
      const live = store.connection === "live" && !stale;
      const samples: TraceSample[] =
        input === null
          ? Array.from({ length: BUCKETS }, () => ({
              value: null,
              availability: "unknown" as const,
            }))
          : store.trace(input, BUCKETS).map((value) => {
              if (!live) return { value: null, availability: "stale" as const };
              if (value === null)
                return { value: null, availability: "unknown" as const };
              if (value <= SILENT_BELOW_DBFS)
                return { value: null, availability: "observed" as const };
              return { value, availability: "observed" as const };
            });
      drawTrace(context, width, height, samples, {
        min: DISPLAY_FLOOR_DBFS,
        max: 0,
        variant: "bars",
        theme: readTraceTheme(canvas!),
        playheadRatio: null,
        replay: false,
      });
    }

    function request() {
      if (cancelScheduled || delayTimer !== undefined) return;
      const wait = MIN_REDRAW_MS - (performance.now() - lastDrawMs);
      if (wait > 0) {
        delayTimer = window.setTimeout(() => {
          delayTimer = undefined;
          cancelScheduled = scheduleTraceRedraw(redraw);
        }, wait);
        return;
      }
      cancelScheduled = scheduleTraceRedraw(redraw);
    }

    request();
    const unsubscribe = store.subscribe(request);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(request);
    resizeObserver?.observe(canvas);
    return () => {
      unsubscribe();
      resizeObserver?.disconnect();
      cancelScheduled?.();
      if (delayTimer !== undefined) window.clearTimeout(delayTimer);
    };
  }, [store, input, stale]);

  return (
    <canvas
      ref={canvasRef}
      className={["meter-trace", className].filter(Boolean).join(" ")}
      aria-hidden="true"
    />
  );
}
