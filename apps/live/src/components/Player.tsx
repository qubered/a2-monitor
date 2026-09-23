import { useEffect, useMemo, useState } from "react";
import type {
  ChannelLevelSample,
  LiveAlert,
  LiveStateChannel,
} from "@rvlt/pulse-protocol/http";
import {
  MultiLaneTimeline,
  type TimelineLane,
  type TimelineMark,
} from "@rvlt/pulse-ui/visualization";
import { formatClock } from "../alerts";
import type { PlaybackUpdate } from "../audio-playback";
import {
  DIM_ATTENUATION_DB,
  MAX_MONITOR_GAIN_DB,
  MIN_MONITOR_GAIN_DB,
} from "../audio-playback";
import type { MeterReading, MeterStore } from "../meters";
import { useChannelHistory } from "../useChannelHistory";

const DEFAULT_TIMELINE_WINDOW_MS = 30 * 60 * 1000;
const AUDIO_RANGE_DBFS = { min: -60, max: 0 };
const RF_RANGE_DBM = { min: -120, max: 0 };
const PERCENT_RANGE = { min: 0, max: 100 };
const NO_SAMPLES: readonly ChannelLevelSample[] = [];
const READOUT_REFRESH_MS = 200;

type PlayerProps = {
  channel: LiveStateChannel | null;
  muted: boolean;
  dimmed: boolean;
  gainDb: number;
  playback: PlaybackUpdate;
  directListeningAvailable: boolean;
  meterStore: MeterStore;
  /** Alerts on the selected channel, active and cleared, drawn as rail marks. */
  alertMarks?: readonly LiveAlert[];
  nowMs: number;
  onExpandedChange?: (expanded: boolean) => void;
  onToggleMute: () => void;
  onToggleDim: () => void;
  onGainChange: (gainDb: number) => void;
};

function formatMeasured(
  value: number | null | undefined,
  unit: string,
  digits = 0,
): string {
  if (value === null || value === undefined) return "Unknown";
  const text = Math.abs(value).toFixed(digits);
  return `${value < 0 ? "−" : ""}${text}${unit}`;
}

function formatTimeCode(msBehindLive: number): string {
  const totalSeconds = Math.max(0, Math.round(msBehindLive / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `−${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The selected input's latest meter reading, refreshed a few times a second rather than on every frame. */
function useMeterReading(
  store: MeterStore,
  input: number | null,
): MeterReading | null {
  const [reading, setReading] = useState<MeterReading | null>(null);
  useEffect(() => {
    if (input === null) return undefined;
    const update = () => setReading(store.latest(input));
    update();
    const timer = window.setInterval(update, READOUT_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [store, input]);
  return input === null ? null : reading;
}

export function Player({
  channel,
  muted,
  dimmed,
  gainDb,
  playback,
  directListeningAvailable,
  meterStore,
  alertMarks = [],
  nowMs,
  onExpandedChange,
  onToggleMute,
  onToggleDim,
  onGainChange,
}: PlayerProps) {
  const effectiveGainDb = gainDb + (dimmed ? DIM_ATTENUATION_DB : 0);
  const gainLabel = `${effectiveGainDb > 0 ? "+" : ""}${effectiveGainDb}`;
  const reading = useMeterReading(meterStore, channel?.input.index ?? null);

  const [expanded, setExpanded] = useState(false);
  const [windowMs, setWindowMs] = useState(DEFAULT_TIMELINE_WINDOW_MS);
  const [scrubRatio, setScrubRatio] = useState(1);
  const currentChannelId = channel?.id ?? null;
  const [scrubbedChannelId, setScrubbedChannelId] = useState(currentChannelId);
  if (currentChannelId !== scrubbedChannelId) {
    // Selecting a different channel returns the shared cursor to now.
    setScrubbedChannelId(currentChannelId);
    setScrubRatio(1);
  }
  const history = useChannelHistory(
    expanded ? currentChannelId : null,
    windowMs,
    1000,
  );

  const observed =
    history.status === "ready" ? history.history.samples : NO_SAMPLES;
  // Anchor the time axis to the window: samples sit at the right (now) and
  // the time before anything was recorded reads as unknown, never stretched.
  const slots =
    history.status === "ready"
      ? Math.max(
          observed.length,
          Math.round(windowMs / history.history.intervalMs),
        )
      : observed.length;
  const samples = useMemo<ReadonlyArray<ChannelLevelSample | null>>(
    () => [
      ...Array.from({ length: slots - observed.length }, () => null),
      ...observed,
    ],
    [observed, slots],
  );
  const playheadIndex =
    samples.length > 0 ? Math.round(scrubRatio * (samples.length - 1)) : -1;
  const atPlayhead =
    playheadIndex >= 0 ? (samples[playheadIndex] ?? undefined) : undefined;
  const wireless = channel?.receiver !== null && channel !== null;

  const lanes = useMemo<TimelineLane[]>(
    () => [
      {
        key: "audio",
        label: "Audio",
        variant: "bars",
        ...AUDIO_RANGE_DBFS,
        samples: samples.map((sample) => ({
          value: sample?.audioDbfs ?? null,
          availability: sample?.availability ?? "unknown",
        })),
        readoutLabel: formatMeasured(atPlayhead?.audioDbfs, " dBFS", 1),
      },
      ...(wireless
        ? [
            {
              key: "rf",
              label: "RF level",
              variant: "line" as const,
              ...RF_RANGE_DBM,
              samples: samples.map((sample) => ({
                value: sample?.rfLevelDbm ?? null,
                availability: sample?.availability ?? "unknown",
              })),
              readoutLabel: formatMeasured(atPlayhead?.rfLevelDbm, " dBm"),
            },
            {
              key: "quality",
              label: "Link quality",
              variant: "bars" as const,
              ...PERCENT_RANGE,
              samples: samples.map((sample) => ({
                value: sample?.linkQualityPercent ?? null,
                availability: sample?.availability ?? "unknown",
              })),
              readoutLabel: formatMeasured(
                atPlayhead?.linkQualityPercent,
                " %",
              ),
            },
            {
              key: "battery",
              label: "Battery",
              variant: "line" as const,
              ...PERCENT_RANGE,
              samples: samples.map((sample) => ({
                value: sample?.batteryPercent ?? null,
                availability: sample?.availability ?? "unknown",
              })),
              readoutLabel: formatMeasured(atPlayhead?.batteryPercent, " %"),
            },
          ]
        : []),
    ],
    [samples, atPlayhead, wireless],
  );

  const marks = useMemo<TimelineMark[]>(() => {
    const windowStart = nowMs - windowMs;
    return alertMarks
      .map((alert) => ({
        key: alert.id,
        ratio: (Date.parse(alert.raisedAtUtc) - windowStart) / windowMs,
        severity: alert.severity,
        label: `${alert.label} at ${formatClock(alert.raisedAtUtc)}`,
      }))
      .filter(({ ratio }) => ratio >= 0 && ratio <= 1);
  }, [alertMarks, nowMs, windowMs]);

  const timeCodeLabel =
    scrubRatio >= 1 ? "Now" : formatTimeCode((1 - scrubRatio) * windowMs);
  const sourceMeta = channel
    ? [
        channel.receiver
          ? `${channel.receiver.name} · channel ${channel.receiver.channelIndex + 1}`
          : null,
        channel.input.label,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Press a card to select a source";

  return (
    <footer className="player" aria-label="Monitor output controls">
      {expanded && channel ? (
        <MultiLaneTimeline
          lanes={lanes}
          windowMs={windowMs}
          onWindowChange={setWindowMs}
          playheadRatio={scrubRatio}
          onScrub={setScrubRatio}
          onBackToLive={() => setScrubRatio(1)}
          timeCodeLabel={timeCodeLabel}
          marks={marks}
        />
      ) : null}
      <div className="player-transport">
        <div className="player-selection-rail" aria-hidden="true">
          <span />
        </div>
        <div className="player-source">
          <div className="player-art" aria-hidden="true" />
          <div>
            <strong>{channel?.name ?? "No channel selected"}</strong>
            <span className="player-meta">{sourceMeta}</span>
            <span
              className={channel ? "source-selected-badge" : "waiting-badge"}
            >
              <i aria-hidden="true" /> {channel ? "Selected" : "Waiting"}
            </span>
          </div>
        </div>
        <div
          className={`player-level ${reading ? "" : "is-unknown"}`}
          aria-hidden={channel ? undefined : true}
        >
          <span>Input</span>
          <strong className="mono">
            {reading
              ? `${formatMeasured(reading.peakDbfs, "", 1)} dBFS`
              : "— dBFS"}
          </strong>
          <span className={reading?.clipped ? "is-clipping" : undefined}>
            {reading ? (reading.clipped ? "Clipping" : "Peak") : "Unknown"}
          </span>
        </div>
        <p className="safety-state" aria-live="polite">
          <strong className={`playback-${playback.status}`}>
            {playback.status === "idle"
              ? "Not listening"
              : playback.status === "connecting"
                ? "Connecting"
                : playback.status === "listening"
                  ? "Listening"
                  : "Listening error"}
          </strong>
          <span>{playback.detail}</span>
          <span>
            {muted
              ? "Monitor output is muted"
              : dimmed
                ? "Monitor output is dimmed"
                : "Monitor output is unmuted"}
          </span>
        </p>
        <div className="player-controls">
          <button
            className={`control-button ${muted ? "is-active" : ""}`}
            type="button"
            onClick={onToggleMute}
            aria-pressed={muted}
            disabled={!directListeningAvailable || !channel}
          >
            Mute
          </button>
          <button
            className={`control-button ${dimmed ? "is-active" : ""}`}
            type="button"
            onClick={onToggleDim}
            aria-pressed={dimmed}
            disabled={!directListeningAvailable || !channel}
          >
            Dim
          </button>
          <label className="volume-control">
            <span className="sr-only">Monitor volume</span>
            <input
              type="range"
              min={MIN_MONITOR_GAIN_DB}
              max={MAX_MONITOR_GAIN_DB}
              step="1"
              value={gainDb}
              disabled={!directListeningAvailable}
              onChange={(event) => onGainChange(Number(event.target.value))}
            />
          </label>
          <span className="output-level">
            {muted ? "−∞" : gainLabel.replace("-", "−")} dB
          </span>
          <button
            type="button"
            className={`control-button ${expanded ? "is-active" : ""}`}
            onClick={() => {
              const next = !expanded;
              setExpanded(next);
              onExpandedChange?.(next);
            }}
            aria-pressed={expanded}
            disabled={!channel}
          >
            {expanded ? "Hide history" : "History"}
          </button>
        </div>
      </div>
    </footer>
  );
}
