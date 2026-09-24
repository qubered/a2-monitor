import type { CSSProperties } from "react";
import type { LiveAlert, LiveStateChannel } from "@rvlt/pulse-protocol/http";
import { overlayRemaining } from "../alerts";
import type { MeterStore } from "../meters";
import { MeterTrace } from "./MeterTrace";
import { StatusStrip } from "./StatusStrip";

export type CardReportState = {
  /** Reports nobody has claimed yet; the card pulses while this is above zero. */
  unclaimed: number;
  claimedBy: string | null;
  awaitingConfirmation: boolean;
};

type ChannelCardProps = {
  channel: LiveStateChannel;
  alert: LiveAlert | null;
  report?: CardReportState | null;
  /** The card's one action: select on the A2 grid, report on the A1 grid. */
  actionLabel?: string;
  overlayExpiryMs: number;
  nowMs: number;
  selected: boolean;
  listening: boolean;
  imageRevision: number;
  meterStore: MeterStore;
  metersStale: boolean;
  onAcknowledge: (alert: LiveAlert) => void;
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

export function AlertIcon({
  dimension,
}: {
  dimension: LiveAlert["dimension"];
}) {
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
  if (dimension === "Battery") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="7" width="16" height="10" rx="2.5" />
        <path d="M21 10.5v3M5.5 10.5v3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4M12 8v3m0 2.5h.01" />
    </svg>
  );
}

/** The secondary caption line: the performer when known, otherwise where the signal comes from. */
function secondaryLine(channel: LiveStateChannel): string {
  if (channel.performer) return channel.performer;
  if (channel.receiver) {
    return `${channel.receiver.name} · channel ${channel.receiver.channelIndex + 1}`;
  }
  return channel.input.label;
}

export function ChannelCard({
  channel,
  alert,
  report = null,
  actionLabel = "Select",
  overlayExpiryMs,
  nowMs,
  selected,
  listening,
  imageRevision,
  meterStore,
  metersStale,
  onAcknowledge,
  onSelect,
  onOpenDetail,
}: ChannelCardProps) {
  const alerting = alert !== null;
  const remaining = alert
    ? overlayRemaining(alert, overlayExpiryMs, nowMs)
    : null;
  const classes = [
    "channel-card",
    selected ? "is-selected" : "",
    listening ? "is-listening" : "",
    alerting ? "has-alert" : "",
    report && report.unclaimed > 0 ? "is-reported" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={classes} data-channel-id={channel.id}>
      <button
        className="card-hit-target"
        type="button"
        onClick={onSelect}
        aria-label={`${actionLabel} ${channel.name}, channel ${channel.number}`}
        aria-hidden={alerting || undefined}
        tabIndex={alerting ? -1 : 0}
      />

      <div className="channel-tile">
        <div className={`channel-photo ${channel.hasImage ? "has-photo" : ""}`}>
          {channel.hasImage ? (
            <img
              src={`/api/v1/channels/${encodeURIComponent(channel.id)}/image?revision=${imageRevision}`}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="photo-missing">Photo not added</span>
          )}
          <span className="channel-number">
            {String(channel.number).padStart(2, "0")}
          </span>
          {report ? (
            <span
              className={`report-badge ${report.unclaimed > 0 ? "is-unclaimed" : ""}`}
            >
              {report.unclaimed > 0
                ? report.unclaimed > 1
                  ? `Reported · ${report.unclaimed}`
                  : "Reported"
                : report.awaitingConfirmation
                  ? "Fixed · A1 to confirm"
                  : `Being worked · ${report.claimedBy ?? "A2"}`}
            </span>
          ) : null}
          {listening ? (
            <span className="listening-badge">
              <i aria-hidden="true" /> Listening
            </span>
          ) : selected ? (
            <span className="selected-badge">
              <i aria-hidden="true" /> Selected
            </span>
          ) : null}
          <button
            className="expand-button"
            type="button"
            onClick={onOpenDetail}
            aria-label={`Open details for ${channel.name}`}
          >
            <ExpandIcon />
          </button>
          <MeterTrace
            store={meterStore}
            input={channel.input.index}
            stale={metersStale}
          />
          {alert ? (
            <span
              className={`alert-band alert-${alert.severity}`}
              aria-hidden="true"
            >
              <AlertIcon dimension={alert.dimension} />
              <strong>{alert.label}</strong>
              <span>Press to acknowledge</span>
              {remaining !== null ? (
                <span
                  className="alert-expiry"
                  style={{ "--expiry-remaining": remaining } as CSSProperties}
                />
              ) : null}
            </span>
          ) : null}
        </div>

        <div className="channel-identity">
          <h2>{channel.name}</h2>
          <p>{secondaryLine(channel)}</p>
        </div>
      </div>

      <StatusStrip statuses={channel.statuses} />

      {alert ? (
        <button
          className={`alert-overlay alert-${alert.severity}`}
          type="button"
          onClick={() => onAcknowledge(alert)}
          aria-label={`${alert.label} on ${channel.name}, channel ${channel.number}. Press to acknowledge.`}
        />
      ) : null}
    </article>
  );
}
