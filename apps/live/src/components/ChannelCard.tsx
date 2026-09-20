import type { CSSProperties } from "react";
import type { LiveChannel as Channel } from "@a2-monitor/protocol/live-snapshot";
import { StatusStrip } from "./StatusStrip";

type ChannelCardProps = {
  channel: Channel;
  acknowledged: boolean;
  selected: boolean;
  onAcknowledge: () => void;
  onSelect: () => void;
  onOpenDetail: () => void;
};

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 2H2v4M10 14h4v-4M14 6V2h-4M2 10v4h4" />
    </svg>
  );
}

function AlertIcon({ dimension }: { dimension: "RF" | "Audio" | "Battery" }) {
  if (dimension === "RF") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2.5 9.5a16 16 0 0 1 19 0M5.5 13a11.5 11.5 0 0 1 13 0M8.5 16.4a7 7 0 0 1 7 0" />
        <circle cx="12" cy="20" r="1.1" />
      </svg>
    );
  }
  if (dimension === "Audio") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4V5Zm5 4.5 5 5m0-5-5 5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="7" width="16" height="10" rx="2.5" />
      <path d="M21 10.5v3M5.5 10.5v3" />
    </svg>
  );
}

function MeterTrace({ channel }: { channel: Channel }) {
  const silent = channel.levelDbfs === null;
  const values = Array.from({ length: 32 }, (_, index) => {
    if (silent) return 6;
    return 18 + ((channel.number * 13 + index * 17) % 70);
  });

  return (
    <div
      className={`meter-trace ${silent ? "meter-unknown" : ""}`}
      aria-hidden="true"
    >
      {values.map((height, index) => (
        <i
          key={index}
          style={{ "--meter-value": `${height}%` } as CSSProperties}
        />
      ))}
    </div>
  );
}

export function ChannelCard({
  channel,
  acknowledged,
  selected,
  onAcknowledge,
  onSelect,
  onOpenDetail,
}: ChannelCardProps) {
  const alerting = Boolean(channel.alert && !acknowledged);
  const handlePrimaryAction = alerting ? onAcknowledge : onSelect;
  const primaryAction = alerting ? "Acknowledge" : "Select";

  return (
    <article
      className={`channel-card ${selected ? "is-selected" : ""} ${alerting ? "has-alert" : ""}`}
      data-channel-id={channel.id}
    >
      <button
        className="card-hit-target"
        type="button"
        onClick={handlePrimaryAction}
        aria-label={`${primaryAction} ${channel.character}, channel ${channel.number}`}
        aria-hidden={alerting || undefined}
        tabIndex={alerting ? -1 : 0}
      />

      <div className="channel-tile">
        <div className="photo-placeholder" aria-label="Headshot not added">
          <span className="channel-number">
            {String(channel.number).padStart(2, "0")}
          </span>
          <span className="photo-missing">Photo not added</span>
          {selected ? (
            <span className="selected-badge">
              <i aria-hidden="true" /> Selected
            </span>
          ) : null}
          <button
            className="expand-button"
            type="button"
            onClick={onOpenDetail}
            aria-label={`Open details for ${channel.character}`}
          >
            <ExpandIcon />
          </button>
          <MeterTrace channel={channel} />
        </div>

        <div className="channel-identity">
          <h2>{channel.character}</h2>
          <p>{channel.performer}</p>
        </div>
      </div>

      <StatusStrip statuses={channel.statuses} />

      {alerting && channel.alert ? (
        <button
          className={`alert-overlay alert-${channel.alert.severity}`}
          type="button"
          onClick={onAcknowledge}
          aria-label={`${channel.alert.label} on ${channel.character}, channel ${channel.number}. Press to acknowledge.`}
        >
          <span className="alert-mark">
            <AlertIcon dimension={channel.alert.dimension} />
            <strong>{channel.alert.label}</strong>
            <span>Press to acknowledge</span>
          </span>
        </button>
      ) : null}
    </article>
  );
}
