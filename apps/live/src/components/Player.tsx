import type { LiveChannel as Channel } from "@a2-monitor/protocol/live-snapshot";

type PlayerProps = {
  channel: Channel | null;
  muted: boolean;
  dimmed: boolean;
  onToggleMute: () => void;
  onToggleDim: () => void;
};

export function Player({
  channel,
  muted,
  dimmed,
  onToggleMute,
  onToggleDim,
}: PlayerProps) {
  return (
    <footer className="player" aria-label="Listening controls">
      <div className="player-live-rail" aria-hidden="true">
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
          <span className={channel ? "live-badge" : "waiting-badge"}>
            <i aria-hidden="true" /> {channel ? "Selected" : "Waiting"}
          </span>
        </div>
      </div>
      <p className="safety-state" aria-live="polite">
        {muted
          ? "Listening is muted"
          : dimmed
            ? "Listening is dimmed"
            : "Listening is active"}
      </p>
      <div className="player-controls">
        <button
          className={`control-button ${muted ? "is-active" : ""}`}
          type="button"
          onClick={onToggleMute}
          aria-pressed={muted}
        >
          Mute
        </button>
        <button
          className={`control-button ${dimmed ? "is-active" : ""}`}
          type="button"
          onClick={onToggleDim}
          aria-pressed={dimmed}
        >
          Dim
        </button>
        <span className="output-level">
          {muted ? "−∞" : dimmed ? "−30" : "−18"} dB
        </span>
      </div>
    </footer>
  );
}
