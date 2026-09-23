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

/** An event on the shared rail, placed at the moment it happened. */
export type TimelineMark = {
  key: string;
  /** 0 = the left/oldest edge of the window, 1 = now. */
  ratio: number;
  severity: "critical" | "caution";
  /** Accessible description, e.g. "Low RF at 21:04:12". */
  label: string;
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
  /**
   * True only when moving the playhead also replays audio. Without audio
   * replay the playhead is a history cursor: it must not take the --purple
   * "you are hearing the past" treatment, because the audio is still live.
   */
  audioReplay?: boolean;
  /** Alert and event marks on the rail; pressing one moves the playhead there. */
  marks?: readonly TimelineMark[];
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
  audioReplay = false,
  marks = [],
}: MultiLaneTimelineProps) {
  const behindLive = playheadRatio < 1;
  const replay = audioReplay && behindLive;

  return (
    <section
      className={`pulse-timeline ${replay ? "is-replay" : behindLive ? "is-cursor" : ""}`}
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

        <div className="pulse-timeline-rail">
          {marks.length ? (
            <div className="pulse-timeline-marks">
              {marks.map((mark) => (
                <button
                  key={mark.key}
                  type="button"
                  className={`pulse-timeline-mark is-${mark.severity}`}
                  style={{
                    left: `${Math.min(1, Math.max(0, mark.ratio)) * 100}%`,
                  }}
                  aria-label={`${mark.label}. Move the cursor here.`}
                  onClick={() => onScrub(Math.min(1, Math.max(0, mark.ratio)))}
                />
              ))}
            </div>
          ) : null}
          <input
            className="pulse-timeline-scrub"
            type="range"
            min={0}
            max={1000}
            step={1}
            value={Math.round(playheadRatio * 1000)}
            onChange={(event) => onScrub(Number(event.target.value) / 1000)}
            aria-label={
              audioReplay
                ? "Scrub the level history; drag left to replay"
                : "Move the history cursor; audio stays live"
            }
          />
        </div>

        <span className="pulse-timeline-timecode">{timeCodeLabel}</span>

        {behindLive ? (
          <button
            type="button"
            className="pulse-timeline-back-to-live"
            onClick={onBackToLive}
          >
            {audioReplay ? "Back to live" : "Cursor to now"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
