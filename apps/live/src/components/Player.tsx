import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChannelLevelSample,
  LiveAlert,
  LiveStateChannel,
  RecordingSpan,
} from "@rvlt/pulse-protocol/http";
import {
  MultiLaneTimeline,
  type TimelineLane,
  type TimelineMark,
} from "@rvlt/pulse-ui/visualization";
import { formatClock } from "../alerts";
import type { PlaybackUpdate, ReplayOutcome } from "../audio-playback";
import {
  DIM_ATTENUATION_DB,
  MAX_MONITOR_GAIN_DB,
  MIN_MONITOR_GAIN_DB,
} from "../audio-playback";
import type { MeterReading, MeterStore } from "../meters";
import { useChannelHistory } from "../useChannelHistory";
import { spanAt, useRecordedAudio } from "../useRecordedAudio";

const DEFAULT_TIMELINE_WINDOW_MS = 30 * 60 * 1000;
const AUDIO_RANGE_DBFS = { min: -60, max: 0 };
const RF_RANGE_DBM = { min: -120, max: 0 };
const PERCENT_RANGE = { min: 0, max: 100 };
const NO_SAMPLES: readonly ChannelLevelSample[] = [];
const NO_SPANS: readonly RecordingSpan[] = [];
const READOUT_REFRESH_MS = 200;
const HISTORY_INTERVAL_MS = 1000;
/** Scrubbing while replaying seeks once the finger or key settles. */
const SEEK_SETTLE_MS = 300;
/** A replay this close to live is just live; the recording trails the present. */
const MIN_REPLAY_OFFSET_MS = 3_000;
/** Replay past the end of the recording would be silence; go back to live. */
const REPLAY_PAST_END_GRACE_MS = 2_000;

const REPLAY_MESSAGES: Record<Exclude<ReplayOutcome, "started">, string> = {
  "nothing-recorded": "Nothing was recorded at that time.",
  "recording-unavailable": "This node is not recording.",
  failed: "Listening back did not start. Live audio is unchanged.",
};

type PlayerProps = {
  /** The primary channel: the meter, timeline and trim below follow this one. */
  channel: LiveStateChannel | null;
  /** Every channel currently being monitored at once, `channel` among them.
   * A shared host output feed carries only one input, so this is at most
   * one channel there; on this device several can play together. */
  monitoredChannels?: readonly LiveStateChannel[];
  /** Each monitored channel's own connection state, keyed by channel id. */
  playbackByChannel?: Readonly<Record<string, PlaybackUpdate>>;
  /** Makes another monitored channel the primary one. */
  onSelectPrimary?: (channelId: string) => void;
  /** Stops monitoring one channel without touching the rest. */
  onRemoveChannel?: (channelId: string) => void;
  muted: boolean;
  dimmed: boolean;
  gainDb: number;
  playback: PlaybackUpdate;
  /** Set when controls act on the shared host output (ADR 0031), not this device. */
  hostOutput?: {
    /** The joined feed, e.g. "Comms A". */
    feedName: string;
    changedBy: string | null;
    changedAtUtc: string | null;
  } | null;
  directListeningAvailable: boolean;
  meterStore: MeterStore;
  /** Alerts on the selected channel, active and cleared, drawn as rail marks. */
  alertMarks?: readonly LiveAlert[];
  nowMs: number;
  onExpandedChange?: (expanded: boolean) => void;
  /** Opens the followed channel's detail; the glance tile has no expand button. */
  onOpenDetail?: () => void;
  /** Set while the player is playing recorded audio: how far behind live. */
  replay?: {
    offsetMs: number;
    /** The shared feed everyone hears it on, when replay is on a host output. */
    sharedWith?: string;
  } | null;
  /** Plays the primary channel's recording from a UTC time. Absent when this
   * output cannot listen back (shared host output, or nothing connected). */
  onPlayRecorded?: (atUtcMs: number) => Promise<ReplayOutcome>;
  /** Back to the live mix. Always one touch away while replaying. */
  onReturnToLive?: () => void;
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
  monitoredChannels = channel ? [channel] : [],
  playbackByChannel = {},
  onSelectPrimary,
  onRemoveChannel,
  muted,
  dimmed,
  gainDb,
  playback,
  hostOutput = null,
  directListeningAvailable,
  meterStore,
  alertMarks = [],
  nowMs,
  onExpandedChange,
  onOpenDetail,
  replay = null,
  onPlayRecorded,
  onReturnToLive,
  onToggleMute,
  onToggleDim,
  onGainChange,
}: PlayerProps) {
  const effectiveGainDb = gainDb + (dimmed ? DIM_ATTENUATION_DB : 0);
  const outputName = hostOutput ? hostOutput.feedName : "Monitor output";
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

  const recorded = useRecordedAudio(
    channel?.input.index ?? null,
    expanded && onPlayRecorded !== undefined,
  );
  const spans = recorded.status === "ready" ? recorded.spans : NO_SPANS;
  const [replayNotice, setReplayNotice] = useState<string | null>(null);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const seekTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(seekTimer.current), []);
  // Replay trails the present by a fixed offset, so its playhead holds still
  // on the right-anchored timeline while the audio advances.
  const replayRatio = replay
    ? Math.min(1, Math.max(0, 1 - replay.offsetMs / windowMs))
    : null;
  const shownRatio = seekTarget ?? replayRatio ?? scrubRatio;
  const playheadMs = nowMs - (1 - shownRatio) * windowMs;

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
    samples.length > 0 ? Math.round(shownRatio * (samples.length - 1)) : -1;
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
      ...(onPlayRecorded
        ? [
            {
              key: "recorded",
              label: "Recorded audio",
              variant: "bars" as const,
              min: 0,
              max: 1,
              samples: samples.map((_, index) => {
                const at =
                  nowMs - (samples.length - 1 - index) * HISTORY_INTERVAL_MS;
                const held = spanAt(spans, at) !== undefined;
                return {
                  value: held ? 1 : null,
                  availability: held
                    ? ("observed" as const)
                    : ("unknown" as const),
                };
              }),
              readoutLabel:
                recorded.status !== "ready"
                  ? "Unknown"
                  : !recorded.recording.enabled
                    ? "Recording off"
                    : shownRatio >= 1
                      ? "Live"
                      : spanAt(spans, playheadMs)
                        ? "Recorded"
                        : "No recording",
            },
          ]
        : []),
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
    [
      samples,
      atPlayhead,
      wireless,
      onPlayRecorded,
      recorded,
      spans,
      nowMs,
      playheadMs,
    ],
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

  const timeCodeLabel = replay
    ? `Replay ${formatTimeCode(replay.offsetMs)}`
    : shownRatio >= 1
      ? "Now"
      : formatTimeCode((1 - shownRatio) * windowMs);

  async function listenFrom(atMs: number) {
    if (!onPlayRecorded) return;
    setReplayNotice(null);
    const outcome = await onPlayRecorded(atMs);
    setSeekTarget(null);
    if (outcome !== "started") setReplayNotice(REPLAY_MESSAGES[outcome]);
  }

  function scrub(ratio: number) {
    setScrubRatio(ratio);
    if (!replay) return;
    // Scrubbing during replay seeks; wait for the drag to settle.
    setSeekTarget(ratio);
    window.clearTimeout(seekTimer.current);
    seekTimer.current = window.setTimeout(() => {
      const at = nowMs - (1 - ratio) * windowMs;
      if (nowMs - at < MIN_REPLAY_OFFSET_MS) {
        setSeekTarget(null);
        onReturnToLive?.();
      } else void listenFrom(at);
    }, SEEK_SETTLE_MS);
  }

  // Replay carries on only while there is recording to hear.
  const lastRecordedMs = spans.length
    ? Date.parse(spans[spans.length - 1]!.endUtc)
    : null;
  const recordingEnded =
    replay !== null &&
    recorded.status === "ready" &&
    (!recorded.recording.enabled ||
      (lastRecordedMs !== null &&
        nowMs - replay.offsetMs > lastRecordedMs + REPLAY_PAST_END_GRACE_MS));
  const [stoppedByEnd, setStoppedByEnd] = useState(false);
  if (recordingEnded && !stoppedByEnd) setStoppedByEnd(true);
  if (replay && !recordingEnded && stoppedByEnd) setStoppedByEnd(false);
  useEffect(() => {
    if (recordingEnded) onReturnToLive?.();
  }, [recordingEnded, onReturnToLive]);

  const playheadSpan = spanAt(spans, playheadMs);
  const canListenFromHere =
    onPlayRecorded !== undefined &&
    recorded.status === "ready" &&
    recorded.recording.enabled &&
    playheadSpan !== undefined &&
    nowMs - playheadMs >= MIN_REPLAY_OFFSET_MS;
  const listenHint = !onPlayRecorded
    ? "Choose a channel playing on the monitor output to listen back."
    : recorded.status !== "ready"
      ? "The node's recording state is unknown."
      : !recorded.recording.enabled
        ? "Recording is off. Turn it on in Manager to listen back."
        : playheadSpan === undefined
          ? "Nothing was recorded at this time."
          : nowMs - playheadMs < MIN_REPLAY_OFFSET_MS
            ? "Move the playhead further back to listen."
            : null;
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
    <footer
      className="player"
      aria-label={
        hostOutput
          ? `${hostOutput.feedName} shared output controls`
          : "Monitor output controls"
      }
    >
      {expanded && channel ? (
        <MultiLaneTimeline
          lanes={lanes}
          windowMs={windowMs}
          onWindowChange={setWindowMs}
          playheadRatio={shownRatio}
          onScrub={scrub}
          onBackToLive={() => {
            setScrubRatio(1);
            if (replay) onReturnToLive?.();
          }}
          timeCodeLabel={timeCodeLabel}
          marks={marks}
        />
      ) : null}
      {replay ? (
        <div className="replay-bar is-replaying" role="status">
          <strong>
            Listening back to {channel?.name ?? "this channel"},{" "}
            {formatTimeCode(replay.offsetMs)} behind live
          </strong>
          <span>
            {replay.sharedWith
              ? `Everyone on ${replay.sharedWith} hears this.`
              : "Live audio is paused."}
          </span>
          <button
            type="button"
            className="control-button"
            onClick={() => onReturnToLive?.()}
          >
            Back to live
          </button>
        </div>
      ) : expanded && channel && onPlayRecorded && shownRatio < 1 ? (
        <div className="replay-bar">
          <button
            type="button"
            className="control-button"
            disabled={!canListenFromHere}
            onClick={() => void listenFrom(playheadMs)}
          >
            {hostOutput
              ? `Listen from here on ${hostOutput.feedName}`
              : "Listen from here"}{" "}
            ({formatTimeCode(nowMs - playheadMs)})
          </button>
          {listenHint ? <span>{listenHint}</span> : null}
        </div>
      ) : null}
      {replayNotice || (stoppedByEnd && !replay) ? (
        <p className="replay-notice" role="alert">
          {replayNotice ?? "Replay stopped: the recording ended."}
        </p>
      ) : null}
      {monitoredChannels.length > 1 ? (
        <ul className="monitor-list" aria-label="Channels being monitored">
          {monitoredChannels.map((monitored) => {
            const status = playbackByChannel[monitored.id]?.status ?? "idle";
            const isPrimary = monitored.id === channel?.id;
            return (
              <li key={monitored.id}>
                <button
                  type="button"
                  className={`monitor-chip playback-${status} ${
                    isPrimary ? "is-primary" : ""
                  }`}
                  aria-pressed={isPrimary}
                  aria-label={`${monitored.name}, ${status}. Show in the player.`}
                  onClick={() => onSelectPrimary?.(monitored.id)}
                >
                  <i aria-hidden="true" />
                  <span>{monitored.name}</span>
                </button>
                <button
                  type="button"
                  className="monitor-chip-remove"
                  aria-label={`Stop monitoring ${monitored.name}`}
                  onClick={() => onRemoveChannel?.(monitored.id)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="player-transport">
        <div className="player-source">
          <div className="player-art" aria-hidden="true" />
          <div>
            <strong>{channel?.name ?? "No channel selected"}</strong>
            <span className="player-meta">{sourceMeta}</span>
            <span
              className={channel ? "source-selected-badge" : "waiting-badge"}
            >
              <i aria-hidden="true" />{" "}
              {channel
                ? monitoredChannels.length > 1
                  ? `Selected · +${monitoredChannels.length - 1} more`
                  : "Selected"
                : "Waiting"}
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
            {hostOutput
              ? playback.status === "idle"
                ? `${hostOutput.feedName} idle`
                : playback.status === "connecting"
                  ? `${hostOutput.feedName} starting`
                  : playback.status === "listening"
                    ? `Playing on ${hostOutput.feedName}`
                    : `${hostOutput.feedName} error`
              : playback.status === "idle"
                ? "Not listening"
                : playback.status === "connecting"
                  ? "Connecting"
                  : playback.status === "listening"
                    ? "Listening"
                    : "Listening error"}
          </strong>
          {playback.detail ? <span>{playback.detail}</span> : null}
          {muted || dimmed ? (
            <span>
              {outputName} is {muted ? "muted" : "dimmed"}
            </span>
          ) : null}
          {hostOutput?.changedBy && hostOutput.changedAtUtc ? (
            <span>
              Last change: {hostOutput.changedBy},{" "}
              {formatClock(hostOutput.changedAtUtc)}
            </span>
          ) : null}
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
            <span className="sr-only">
              {hostOutput ? `${hostOutput.feedName} level` : "Monitor volume"}
            </span>
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
          {onOpenDetail ? (
            <button
              type="button"
              className="control-button"
              onClick={onOpenDetail}
              aria-label={`Details for ${channel?.name ?? "this channel"}`}
            >
              Details
            </button>
          ) : null}
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
