import { useMemo, useState } from "react";
import type {
  ChannelLevelSample,
  LiveChannel as Channel,
} from "@rvlt/pulse-protocol/http";
import {
  MultiLaneTimeline,
  type TimelineLane,
} from "@rvlt/pulse-ui/visualization";
import type { PlaybackUpdate } from "../audio-playback";
import {
  DIM_ATTENUATION_DB,
  MAX_MONITOR_GAIN_DB,
  MIN_MONITOR_GAIN_DB,
} from "../audio-playback";
import { useChannelHistory } from "../useChannelHistory";

const DEFAULT_TIMELINE_WINDOW_MS = 30 * 60 * 1000;
const AUDIO_RANGE_DBFS = { min: -60, max: 0 };
const RF_RANGE_DBM = { min: -120, max: 0 };
const PERCENT_RANGE = { min: 0, max: 100 };
const NO_SAMPLES: readonly ChannelLevelSample[] = [];

type PlayerProps = {
  channel: Channel | null;
  muted: boolean;
  dimmed: boolean;
  gainDb: number;
  playback: PlaybackUpdate;
  directListeningAvailable: boolean;
  onToggleMute: () => void;
  onToggleDim: () => void;
  onGainChange: (gainDb: number) => void;
};

function formatMeasured(
  value: number | null | undefined,
  unit: string,
  digits = 0,
): string {
  return value === null || value === undefined
    ? "Unknown"
    : `${value.toFixed(digits)}${unit}`;
}

function formatTimeCode(msBehindLive: number): string {
  const totalSeconds = Math.max(0, Math.round(msBehindLive / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `−${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function Player({
  channel,
  muted,
  dimmed,
  gainDb,
  playback,
  directListeningAvailable,
  onToggleMute,
  onToggleDim,
  onGainChange,
}: PlayerProps) {
  const effectiveGainDb = gainDb + (dimmed ? DIM_ATTENUATION_DB : 0);
  const gainLabel = `${effectiveGainDb > 0 ? "+" : ""}${effectiveGainDb}`;

  const [expanded, setExpanded] = useState(false);
  const [windowMs, setWindowMs] = useState(DEFAULT_TIMELINE_WINDOW_MS);
  const [scrubRatio, setScrubRatio] = useState(1);
  const currentChannelId = channel?.id ?? null;
  const [scrubbedChannelId, setScrubbedChannelId] = useState(currentChannelId);
  if (currentChannelId !== scrubbedChannelId) {
    // Selecting a different channel returns the shared playhead to live,
    // rather than replaying whatever position was left on the old one.
    setScrubbedChannelId(currentChannelId);
    setScrubRatio(1);
  }
  const history = useChannelHistory(
    expanded ? currentChannelId : null,
    windowMs,
    1000,
  );

  const samples =
    history.status === "ready" ? history.history.samples : NO_SAMPLES;
  const playheadIndex =
    samples.length > 0 ? Math.round(scrubRatio * (samples.length - 1)) : -1;
  const atPlayhead = playheadIndex >= 0 ? samples[playheadIndex] : undefined;

  const lanes = useMemo<TimelineLane[]>(
    () => [
      {
        key: "audio",
        label: "Audio",
        variant: "bars",
        ...AUDIO_RANGE_DBFS,
        samples: samples.map((sample) => ({
          value: sample.audioDbfs,
          availability: sample.availability,
        })),
        readoutLabel: formatMeasured(atPlayhead?.audioDbfs, " dBFS", 1),
      },
      {
        key: "rf",
        label: "RF level",
        variant: "line",
        ...RF_RANGE_DBM,
        samples: samples.map((sample) => ({
          value: sample.rfLevelDbm,
          availability: sample.availability,
        })),
        readoutLabel: formatMeasured(atPlayhead?.rfLevelDbm, " dBm"),
      },
      {
        key: "quality",
        label: "Link quality",
        variant: "bars",
        ...PERCENT_RANGE,
        samples: samples.map((sample) => ({
          value: sample.linkQualityPercent,
          availability: sample.availability,
        })),
        readoutLabel: formatMeasured(atPlayhead?.linkQualityPercent, " %"),
      },
      {
        key: "battery",
        label: "Battery",
        variant: "line",
        ...PERCENT_RANGE,
        samples: samples.map((sample) => ({
          value: sample.batteryPercent,
          availability: sample.availability,
        })),
        readoutLabel: formatMeasured(atPlayhead?.batteryPercent, " %"),
      },
    ],
    [samples, atPlayhead],
  );

  const timeCodeLabel =
    scrubRatio >= 1 ? "Live" : formatTimeCode((1 - scrubRatio) * windowMs);

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
        />
      ) : null}
      <div className="player-transport">
        <div className="player-selection-rail" aria-hidden="true">
          <span />
        </div>
        <div className="player-source">
          <div className="player-art" aria-hidden="true" />
          <div>
            <strong>{channel?.character ?? "No channel selected"}</strong>
            <span className="player-meta">
              {channel
                ? `${channel.details.receiver} · ${channel.details.input}`
                : "Press a card to select a source"}
            </span>
            <span
              className={channel ? "source-selected-badge" : "waiting-badge"}
            >
              <i aria-hidden="true" /> {channel ? "Selected" : "Waiting"}
            </span>
          </div>
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
            onClick={() => setExpanded((value) => !value)}
            aria-pressed={expanded}
            disabled={!channel}
          >
            {expanded ? "Collapse timeline" : "Expand timeline"}
          </button>
        </div>
      </div>
    </footer>
  );
}
