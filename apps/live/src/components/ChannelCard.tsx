import type { CSSProperties } from "react";
import type {
  ChannelLevelSample,
  LiveChannel as Channel,
} from "@rvlt/pulse-protocol/http";
import { deriveAudioVerdict } from "../audio-check";
import { useChannelHistory } from "../useChannelHistory";
import { StatusStrip } from "./StatusStrip";

const CARD_TRACE_WINDOW_MS = 10_000;
const CARD_TRACE_REFRESH_MS = 2_000;
const CARD_TRACE_BAR_COUNT = 10;
const AUDIO_METER_FLOOR_DBFS = -60;
const AUDIO_METER_CEILING_DBFS = -6;

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

function audioMeterHeightPercent(dbfs: number): number {
  const ratio =
    (dbfs - AUDIO_METER_FLOOR_DBFS) /
    (AUDIO_METER_CEILING_DBFS - AUDIO_METER_FLOOR_DBFS);
  return Math.round(Math.max(6, Math.min(100, ratio * 100)));
}

/**
 * The card's 10-second rolling trace (design system §10.1): real per-second
 * samples from the backend's level-history store, not a decorative
 * placeholder. Each bar carries its own honesty-grammar state — a channel
 * can be present for eight seconds and silent for two within the same
 * window.
 */
function MeterTrace({ samples }: { samples: readonly ChannelLevelSample[] }) {
  const bars: Array<ChannelLevelSample | null> =
    samples.length > 0
      ? samples.slice(-CARD_TRACE_BAR_COUNT)
      : Array.from({ length: CARD_TRACE_BAR_COUNT }, () => null);

  return (
    <div className="meter-trace" aria-hidden="true">
      {bars.map((sample, index) => {
        if (!sample) {
          return (
            <i
              key={index}
              data-state="unknown"
              style={{ "--meter-value": "4%" } as CSSProperties}
            />
          );
        }
        const state =
          sample.availability === "stale"
            ? "stale"
            : sample.availability === "unknown"
              ? "unknown"
              : sample.audioDbfs === null
                ? "silent"
                : "observed";
        const height =
          sample.audioDbfs === null
            ? 4
            : audioMeterHeightPercent(sample.audioDbfs);
        return (
          <i
            key={index}
            data-state={state}
            style={{ "--meter-value": `${height}%` } as CSSProperties}
          />
        );
      })}
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
  const observedDeviceInput = channel.id.startsWith("device-channel-");
  const handlePrimaryAction = alerting ? onAcknowledge : onSelect;
  const primaryAction = alerting ? "Acknowledge" : "Select";
  const history = useChannelHistory(
    channel.id,
    CARD_TRACE_WINDOW_MS,
    CARD_TRACE_REFRESH_MS,
  );
  const historySamples =
    history.status === "ready" ? history.history.samples : [];
  const statuses = {
    ...channel.statuses,
    audio: deriveAudioVerdict(channel.statuses.audio, historySamples),
  };

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
        <div
          className="photo-placeholder"
          aria-label={
            observedDeviceInput ? "Identity unknown" : "Headshot not added"
          }
        >
          <span className="channel-number">
            {String(channel.number).padStart(2, "0")}
          </span>
          <span className="photo-missing">
            {observedDeviceInput ? "Identity unknown" : "Photo not added"}
          </span>
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
          <MeterTrace samples={historySamples} />
        </div>

        <div className="channel-identity">
          <h2>{channel.character}</h2>
          <p>{channel.performer}</p>
        </div>
      </div>

      <StatusStrip statuses={statuses} />

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
