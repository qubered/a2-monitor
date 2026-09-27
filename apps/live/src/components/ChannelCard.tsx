import type { CSSProperties, MouseEvent } from "react";
import type { LiveAlert, LiveStateChannel } from "@rvlt/pulse-protocol/http";
import { overlayRemaining } from "../alerts";
import type { MeterStore } from "../meters";
import { formatTrim } from "../trim";
import { MeterTrace } from "./MeterTrace";
import { StatusStrip } from "./StatusStrip";
import { useLongPress } from "./useLongPress";

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
  /** A press or click. Its `shiftKey`/`ctrlKey`/`metaKey` drive multi-select
   * on a computer; Shift and Ctrl also reach here from a keyboard Enter or
   * Space held with the same key (DESIGN.md §8.3). */
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Present only where a long-press may start multi-select by touch; omit
   * to leave the card's one hit target a plain press with no held gesture. */
  onLongPressSelect?: () => void;
  onOpenDetail: () => void;
};

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 2H2v4M10 14h4v-4M14 6V2h-4M2 10v4h4" />
    </svg>
  );
}

/** The type-derived glyph standing in for a missing photo; DESIGN.md §10.1. */
function MicTypeIcon({ micType }: { micType: LiveStateChannel["micType"] }) {
  if (micType === "handheld") {
    // Phosphor Icons' microphone-stage (MIT), already adapted and shipped as
    // "Microphone" in RVLT Flow; rescaled onto Pulse's 24px grid (ADR 0036).
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="15.75" cy="8.25" r="6" />
        <path d="M19.99 12.49 11.51 4.01" />
        <path d="M9 15l.75-.75" />
        <path d="M9.84 9.33 3.15 18.47a.75.75 0 0 0 .07.97l1.34 1.34a.75.75 0 0 0 .97.07L14.67 14.16" />
      </svg>
    );
  }
  if (micType === "beltpack") {
    // RVLT Flow's own beltpack transmitter glyph, rescaled onto Pulse's
    // 24px grid (ADR 0036); the screen is filled solid rather than
    // outlined-with-a-line to keep the glyph legible at small sizes.
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" strokeWidth={0.5}>
        <path d="M6.94 7.06V4.89q0-1.69-.72-2.89" />
        <path d="M13.45 7.06v-1.93h1.69v1.93" />
        <path d="M16.1 10.19h.72q.96 0 .96.96v6.03q0 .96-.96.96h-.72" />
        <rect x="5.01" y="7.06" width="11.09" height="14.94" rx="1.21" />
        <rect
          x="7.18"
          y="9.47"
          width="6.75"
          height="3.37"
          rx="0.48"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    );
  }
  return null;
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
  if (channel.session?.inUse === false) {
    return channel.session.nextInUse
      ? `Not in this session · next: ${channel.session.nextPresenter ?? "in use"}`
      : "Not in this session";
  }
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
  onLongPressSelect,
  onOpenDetail,
}: ChannelCardProps) {
  const alerting = alert !== null;
  const remaining = alert
    ? overlayRemaining(alert, overlayExpiryMs, nowMs)
    : null;
  const longPress = useLongPress(() => onLongPressSelect?.());
  const classes = [
    "channel-card",
    selected ? "is-selected" : "",
    listening ? "is-listening" : "",
    alerting ? "has-alert" : "",
    alert?.severity === "critical" ? "is-critical-alert" : "",
    report && report.unclaimed > 0 ? "is-reported" : "",
    channel.session?.inUse === false ? "is-idle" : "",
    onLongPressSelect ? "can-multiselect" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={classes} data-channel-id={channel.id}>
      <button
        className="card-hit-target"
        type="button"
        onClick={(event) => {
          // A long-press that already fired still dispatches a click on
          // release; that click is not a second, separate press.
          if (longPress.consumeFired()) return;
          onSelect(event);
        }}
        {...(onLongPressSelect ? longPress.handlers : {})}
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
          ) : channel.micType === "handheld" ||
            channel.micType === "beltpack" ? (
            <span className="photo-fallback">
              <MicTypeIcon micType={channel.micType} />
              <span className="sr-only">
                {channel.micTypeSource === "inferred"
                  ? `Likely ${channel.micType}`
                  : channel.micType === "handheld"
                    ? "Handheld"
                    : "Beltpack"}
              </span>
            </span>
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
          {channel.trimDb ? (
            <span className="trim-badge mono">
              Trim {formatTrim(channel.trimDb)} dB
            </span>
          ) : null}
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
