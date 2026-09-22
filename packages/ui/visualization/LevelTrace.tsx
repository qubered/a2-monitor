import { useEffect, useRef } from "react";
import {
  drawTrace,
  readTraceTheme,
  type TraceSample,
  type TraceVariant,
} from "./level-trace.js";
import { scheduleTraceRedraw } from "./trace-scheduler.js";

export type LevelTraceProps = {
  samples: readonly TraceSample[];
  min: number;
  max: number;
  variant?: TraceVariant;
  /** Ratio (0..1) across the trace after which values are later than the playhead; omit when there is no shared playhead. */
  playheadRatio?: number | null;
  /** Tints observed values --purple instead of --ok — this trace is showing the past, not the present. */
  replay?: boolean;
  className?: string;
  label?: string;
};

/**
 * A single honesty-grammar-aware level trace, rendered to canvas so a
 * multi-lane timeline at 1 sample/second over an hour (3,600 points) stays
 * cheap to redraw. Redraws are batched onto one shared animation frame
 * across every mounted trace (see trace-scheduler) and only happen when the
 * data changes — traces are not animated (design system §6).
 */
export function LevelTrace({
  samples,
  min,
  max,
  variant = "bars",
  playheadRatio = null,
  replay = false,
  className,
  label,
}: LevelTraceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    function redraw() {
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas!.width !== width || canvas!.height !== height) {
        canvas!.width = width;
        canvas!.height = height;
      }
      drawTrace(ctx, width, height, samples, {
        min,
        max,
        variant,
        theme: readTraceTheme(canvas!),
        playheadRatio,
        replay,
      });
    }

    const cancelScheduled = scheduleTraceRedraw(redraw);
    const resizeObserver = new ResizeObserver(() =>
      scheduleTraceRedraw(redraw),
    );
    resizeObserver.observe(canvas);

    return () => {
      cancelScheduled();
      resizeObserver.disconnect();
    };
  }, [samples, min, max, variant, playheadRatio, replay]);

  return (
    <canvas
      ref={canvasRef}
      className={["pulse-level-trace", className].filter(Boolean).join(" ")}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    />
  );
}
