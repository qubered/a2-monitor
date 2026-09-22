import { LevelTrace } from "./LevelTrace.js";
import type { TraceSample, TraceVariant } from "./level-trace.js";

export type TimelineLane = {
  key: string;
  label: string;
  variant: TraceVariant;
  min: number;
  max: number;
  samples: readonly TraceSample[];
  /** The value read at the current playhead, already formatted with its unit ("−18.2 dBFS", "Unknown"). */
  readoutLabel: string;
};

export const TIMELINE_WINDOW_OPTIONS_MS = [
  10 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
] as const;

export type MultiLaneTimelineProps = {
  lanes: readonly TimelineLane[];
  windowMs: number;
  onWindowChange: (windowMs: number) => void;
  /** 0 = the left/oldest edge of the window, 1 = live (the right edge). */
  playheadRatio: number;
  onScrub: (ratio: number) => void;
  onBackToLive: () => void;
  /** Mono time-code label for the current playhead position, e.g. "−10:51" or "Live". */
  timeCodeLabel: string;
};

function formatWindowLabel(windowMs: number): string {
  return `${Math.round(windowMs / 60_000)}m`;
}

/**
 * The player's timeline (design system §10.4): several measurements stacked
 * over one shared time window with a single playhead, so every lane is read
 * at the same instant. Scrubbing the shared rail back is how an operator
 * replays a channel — there is no separate replay mode here, only how far
 * back the shared playhead sits.
 */
export function MultiLaneTimeline({
  lanes,
  windowMs,
  onWindowChange,
  playheadRatio,
  onScrub,
  onBackToLive,
  timeCodeLabel,
}: MultiLaneTimelineProps) {
  const replay = playheadRatio < 1;

  return (
    <section
      className={`pulse-timeline ${replay ? "is-replay" : ""}`}
      aria-label="Level history"
    >
      <div className="pulse-timeline-lanes">
        {lanes.map((lane) => (
          <div className="pulse-timeline-lane" key={lane.key}>
            <span className="pulse-timeline-lane-label">{lane.label}</span>
            <LevelTrace
              samples={lane.samples}
              min={lane.min}
              max={lane.max}
              variant={lane.variant}
              playheadRatio={playheadRatio}
              replay={replay}
              className="pulse-timeline-trace"
            />
            <span className="pulse-timeline-lane-readout">
              {lane.readoutLabel}
            </span>
          </div>
        ))}
      </div>

      <div className="pulse-timeline-controls">
        <div
          className="pulse-timeline-window"
          role="group"
          aria-label="Timeline window"
        >
          {TIMELINE_WINDOW_OPTIONS_MS.map((option) => (
            <button
              key={option}
              type="button"
              className="pulse-timeline-window-button"
              aria-pressed={windowMs === option}
              onClick={() => onWindowChange(option)}
            >
              {formatWindowLabel(option)}
            </button>
          ))}
        </div>

        <input
          className="pulse-timeline-scrub"
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(playheadRatio * 1000)}
          onChange={(event) => onScrub(Number(event.target.value) / 1000)}
          aria-label="Scrub the level history; drag left to replay"
        />

        <span className="pulse-timeline-timecode">{timeCodeLabel}</span>

        {replay ? (
          <button
            type="button"
            className="pulse-timeline-back-to-live"
            onClick={onBackToLive}
          >
            Back to live
          </button>
        ) : null}
      </div>
    </section>
  );
}
