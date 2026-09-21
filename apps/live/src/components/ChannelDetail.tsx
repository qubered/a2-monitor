import type { LiveChannel as Channel } from "@a2-monitor/protocol/http";

type ChannelDetailProps = {
  channel: Channel;
  onClose: () => void;
  onRunCheck: () => void;
};

function measured(value: string | number | null, unit = "") {
  return value === null ? "Unknown" : `${value}${unit}`;
}

export function ChannelDetail({
  channel,
  onClose,
  onRunCheck,
}: ChannelDetailProps) {
  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="detail-overline">Channel {channel.number}</span>
            <h2 id="detail-title">{channel.character}</h2>
            <p>{channel.performer}</p>
          </div>
          <button
            className="line-button"
            type="button"
            onClick={onClose}
            autoFocus
          >
            Close
          </button>
        </header>
        <div className="detail-grid">
          <section>
            <h3>Signal</h3>
            <dl>
              <dt>Audio</dt>
              <dd>{measured(channel.levelDbfs, " dBFS")}</dd>
              <dt>RF level</dt>
              <dd>{measured(channel.details.rfLevelDbm, " dBm")}</dd>
              <dt>Link quality</dt>
              <dd>{measured(channel.details.linkQualityPercent, " %")}</dd>
              <dt>Freshness</dt>
              <dd>{channel.details.telemetryAge}</dd>
            </dl>
          </section>
          <section>
            <h3>Assignment</h3>
            <dl>
              <dt>Performer</dt>
              <dd>{channel.performer}</dd>
              <dt>Zone</dt>
              <dd>{channel.zone}</dd>
              <dt>Receiver</dt>
              <dd>{channel.details.receiver}</dd>
              <dt>Input</dt>
              <dd>{channel.details.input}</dd>
              <dt>Battery</dt>
              <dd>{measured(channel.details.batteryRemaining)}</dd>
            </dl>
          </section>
        </div>
        <footer className="detail-actions">
          <button className="line-button" type="button" onClick={onRunCheck}>
            Run a check
          </button>
        </footer>
      </section>
    </div>
  );
}
