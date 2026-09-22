import type { LiveChannel as Channel } from "@rvlt/pulse-protocol/http";
import type { PlaybackUpdate } from "../audio-playback";
import {
  DIM_ATTENUATION_DB,
  MAX_MONITOR_GAIN_DB,
  MIN_MONITOR_GAIN_DB,
} from "../audio-playback";

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
  return (
    <footer className="player" aria-label="Monitor output controls">
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
          <span className={channel ? "source-selected-badge" : "waiting-badge"}>
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
      </div>
    </footer>
  );
}
