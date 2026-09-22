import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveChannel } from "@rvlt/pulse-protocol/http";
import { ChannelCard } from "./components/ChannelCard";
import { ChannelDetail } from "./components/ChannelDetail";
import { MicCheck } from "./components/MicCheck";
import { Player } from "./components/Player";
import {
  httpAudioDeviceSource,
  resolvePatchedInputIndex,
  synthesizeDeviceChannels,
  type AudioDeviceSource,
} from "./audio-device";
import {
  clampMonitorGainDb,
  DEFAULT_MONITOR_GAIN_DB,
  webAudioPlaybackFactory,
  type PlaybackFactory,
  type PlaybackSession,
  type PlaybackUpdate,
} from "./audio-playback";
import { httpSnapshotSource, type SnapshotSource } from "./snapshot";
import { useAudioDevice } from "./useAudioDevice";
import { useLiveSnapshot, type SnapshotState } from "./useLiveSnapshot";
import { useShowfile } from "./useShowfile";
import { useShureTelemetry } from "./useShureTelemetry";

type Filter = "all" | "needs-someone" | "wireless" | "wired";

const filterLabels: Record<Filter, string> = {
  all: "All channels",
  "needs-someone": "Needs someone",
  wireless: "Wireless",
  wired: "Wired",
};

const emptyChannels: LiveChannel[] = [];

function readStringSet(key: string): Set<string> {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(key) ?? "[]",
    ) as unknown;
    return new Set(
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function readMonitorGainDb(): number {
  const stored = window.localStorage.getItem("pulse-gain-db");
  if (stored === null) return DEFAULT_MONITOR_GAIN_DB;
  const saved = Number(stored);
  return Number.isFinite(saved)
    ? clampMonitorGainDb(saved)
    : DEFAULT_MONITOR_GAIN_DB;
}

function SnapshotNotice({
  state,
  onReconnect,
}: {
  state: SnapshotState;
  onReconnect: () => void;
}) {
  if (state.status === "ready") return null;

  const content = {
    waiting: {
      title: "Waiting for the backend snapshot.",
      detail: "No channel state is shown until a validated snapshot arrives.",
    },
    reconnecting: {
      title: "Reconnecting to the backend.",
      detail: state.snapshot
        ? "Showing the last validated snapshot. It may be stale."
        : "No channel state is available yet.",
    },
    offline: {
      title: "Backend unavailable.",
      detail: state.snapshot
        ? "Showing the last validated snapshot. It may be stale."
        : "Monitoring state is unavailable. Use the console and intercom fallback.",
    },
    error: {
      title: "Snapshot could not be used.",
      detail: state.snapshot
        ? "Showing the last validated snapshot. It may be stale."
        : "Invalid or failed data was not shown.",
    },
  }[state.status];

  return (
    <section
      className={`snapshot-notice snapshot-${state.status}`}
      aria-live={state.status === "error" ? "assertive" : "polite"}
    >
      <div>
        <strong>{content.title}</strong>
        <span>{content.detail}</span>
      </div>
      {state.status === "offline" || state.status === "error" ? (
        <button type="button" className="line-button" onClick={onReconnect}>
          Try again
        </button>
      ) : null}
    </section>
  );
}

export function App({
  snapshotSource = httpSnapshotSource,
  audioDeviceSource = httpAudioDeviceSource,
  playbackFactory = webAudioPlaybackFactory,
}: {
  snapshotSource?: SnapshotSource;
  audioDeviceSource?: AudioDeviceSource;
  playbackFactory?: PlaybackFactory;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() =>
    readStringSet("pulse-acknowledged"),
  );
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    window.localStorage.getItem("pulse-selected-channel"),
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [micCheckId, setMicCheckId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [dimmed, setDimmed] = useState(false);
  const [gainDb, setGainDb] = useState(readMonitorGainDb);
  const [playback, setPlayback] = useState<PlaybackUpdate>({
    status: "idle",
    detail: "Select an observed device input to listen.",
  });
  const playbackSession = useRef<PlaybackSession | null>(null);
  const outputState = useRef({ muted: true, dimmed: false, gainDb });
  const { state: snapshotState, reconnect } = useLiveSnapshot(snapshotSource);
  const audioDeviceState = useAudioDevice(audioDeviceSource);
  const showfile = useShowfile();
  const shure = useShureTelemetry();
  const hasSavedShowfile = (showfile?.revision ?? 0) > 0;
  const snapshot = snapshotState.snapshot;
  const deviceChannels = useMemo(
    () =>
      audioDeviceState.status === "ready"
        ? synthesizeDeviceChannels(audioDeviceState.device, showfile, shure)
        : emptyChannels,
    [audioDeviceState, showfile, shure],
  );
  const usingDeviceChannels = audioDeviceState.status === "ready";
  const device =
    audioDeviceState.status === "ready"
      ? audioDeviceState.device.device
      : undefined;
  const deviceSampleRateHz = device?.sampleRateHz;
  const selectedDeviceIndex =
    audioDeviceState.status === "ready"
      ? resolvePatchedInputIndex(selectedId, audioDeviceState.device, showfile)
      : undefined;
  const channels = usingDeviceChannels
    ? deviceChannels
    : (snapshot?.channels ?? emptyChannels);

  useEffect(() => {
    window.localStorage.setItem(
      "pulse-acknowledged",
      JSON.stringify([...acknowledged]),
    );
  }, [acknowledged]);

  useEffect(() => {
    if (selectedId) {
      window.localStorage.setItem("pulse-selected-channel", selectedId);
    } else {
      window.localStorage.removeItem("pulse-selected-channel");
    }
  }, [selectedId]);

  useEffect(() => {
    if (
      !usingDeviceChannels ||
      selectedDeviceIndex === undefined ||
      deviceSampleRateHz === undefined
    ) {
      return;
    }
    const session: PlaybackSession = playbackFactory({
      channel: selectedDeviceIndex,
      sampleRateHz: deviceSampleRateHz,
      onUpdate: setPlayback,
    });
    session.setGainDb(outputState.current.gainDb);
    session.setDimmed(outputState.current.dimmed);
    void session.setMuted(outputState.current.muted);
    playbackSession.current = session;
    return () => {
      if (playbackSession.current === session) playbackSession.current = null;
      session.close();
    };
  }, [
    deviceSampleRateHz,
    playbackFactory,
    selectedDeviceIndex,
    usingDeviceChannels,
  ]);

  useEffect(() => {
    outputState.current = { muted, dimmed, gainDb };
    window.localStorage.setItem("pulse-gain-db", String(gainDb));
    playbackSession.current?.setGainDb(gainDb);
    playbackSession.current?.setDimmed(dimmed);
    void playbackSession.current?.setMuted(muted);
  }, [dimmed, gainDb, muted]);

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key.toLowerCase() === "m") setMuted((value) => !value);
      if (event.key.toLowerCase() === "d") setDimmed((value) => !value);
      if (event.key === "Escape") setDetailId(null);
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  const visibleChannels = useMemo(() => {
    if (filter === "needs-someone") {
      return channels.filter(
        (channel) =>
          channel.alert || Object.values(channel.statuses).includes("fault"),
      );
    }
    if (filter === "wireless" || filter === "wired") {
      return channels.filter((channel) => channel.kind === filter);
    }
    return channels;
  }, [channels, filter]);

  const selectedChannel =
    channels.find((channel) => channel.id === selectedId) ?? null;
  const detailChannel =
    channels.find((channel) => channel.id === detailId) ?? null;
  const micCheckChannel =
    channels.find((channel) => channel.id === micCheckId) ?? null;
  const alertCount = channels.filter(
    (channel) => channel.alert && !acknowledged.has(channel.id),
  ).length;

  const counts: Record<Filter, number> = {
    all: channels.length,
    "needs-someone": channels.filter(
      (channel) =>
        channel.alert || Object.values(channel.statuses).includes("fault"),
    ).length,
    wireless: channels.filter((channel) => channel.kind === "wireless").length,
    wired: channels.filter((channel) => channel.kind === "wired").length,
  };

  function acknowledge(channel: LiveChannel) {
    setAcknowledged((current) => new Set(current).add(channel.id));
  }

  function selectChannel(channel: LiveChannel) {
    setSelectedId(channel.id);
    if (channel.id.startsWith("device-channel-")) {
      const nextInput =
        audioDeviceState.status === "ready"
          ? resolvePatchedInputIndex(
              channel.id,
              audioDeviceState.device,
              showfile,
            )
          : undefined;
      setPlayback({
        status: nextInput === undefined ? "idle" : "connecting",
        detail:
          channel.details.input === "Audio input not patched"
            ? "This show channel is not patched to an audio input."
            : `Connecting to ${channel.details.input}.`,
      });
    }
  }

  const visiblePlayback =
    usingDeviceChannels && selectedDeviceIndex !== undefined
      ? playback
      : {
          status: "idle" as const,
          detail: usingDeviceChannels
            ? selectedChannel?.details.input === "Audio input not patched"
              ? "This show channel is not patched to an audio input."
              : "Select an observed device input to listen."
            : "Direct audio node listening is unavailable.",
        };

  return (
    <div className="live-app">
      <header className="app-header">
        <div className="brand" aria-label="Pulse">
          <span aria-hidden="true">
            <svg
              viewBox="0 0 100 100"
              width="20"
              height="20"
              fill="currentColor"
            >
              <rect x="8" y="38" width="12" height="24" rx="6" />
              <rect x="27" y="24" width="12" height="52" rx="6" />
              <rect x="46" y="8" width="12" height="84" rx="6" />
              <rect x="65" y="24" width="12" height="52" rx="6" />
              <rect x="84" y="38" width="12" height="24" rx="6" />
            </svg>
          </span>
          <b>Pulse</b>
        </div>
        <div className="show-name">
          <strong>
            {usingDeviceChannels
              ? hasSavedShowfile
                ? showfile?.show.name
                : device?.name
              : (snapshot?.show.name ?? "Show state unavailable")}
          </strong>
          <span>
            {usingDeviceChannels
              ? hasSavedShowfile
                ? `${device?.name ?? "Observed audio device"} · saved names from Manager`
                : "Observed audio device · channel identity unknown"
              : snapshot
                ? `${snapshot.show.venue} · ${snapshot.show.performanceLabel}`
                : "Waiting for validated data"}
          </span>
        </div>
        <div
          className={`node-state node-${usingDeviceChannels ? "ready" : (snapshot?.node.status ?? "unknown")}`}
        >
          <span>Node</span>
          <strong>
            {usingDeviceChannels && device
              ? `${device.channelCount} ch · ${device.sampleRateHz / 1000}k`
              : snapshot?.node.status === "ready" &&
                  snapshot.node.channelCount !== null &&
                  snapshot.node.sampleRateHz !== null
                ? `${snapshot.node.channelCount} ch · ${snapshot.node.sampleRateHz / 1000}k`
                : snapshot?.node.status === "waiting"
                  ? "Waiting"
                  : snapshot?.node.status === "offline"
                    ? "Offline"
                    : "Unknown"}
          </strong>
        </div>
        {usingDeviceChannels ? (
          <span className="observed-badge">Observed device inputs</span>
        ) : snapshot ? (
          <span className="fabricated-badge">{snapshot.source.label}</span>
        ) : null}
        {snapshot && !usingDeviceChannels ? (
          <button
            className="alert-count"
            type="button"
            onClick={() => setFilter("needs-someone")}
          >
            {alertCount} to acknowledge
          </button>
        ) : null}
        <a className="manager-link" href="/manager/">
          Manager
        </a>
      </header>

      <SnapshotNotice state={snapshotState} onReconnect={reconnect} />

      {audioDeviceState.status === "error" ? (
        <section className="snapshot-notice snapshot-error" aria-live="polite">
          <div>
            <strong>Direct listening unavailable.</strong>
            <span>
              {audioDeviceState.message} Showing the existing channel grid.
            </span>
          </div>
        </section>
      ) : null}

      {snapshot?.node.status === "waiting" ? (
        <section
          className="snapshot-notice snapshot-waiting"
          aria-live="polite"
        >
          <div>
            <strong>Waiting for the audio node.</strong>
            <span>The backend has no observed channel state to show.</span>
          </div>
        </section>
      ) : null}

      {snapshot?.node.status === "offline" ? (
        <section
          className="snapshot-notice snapshot-offline"
          aria-live="assertive"
        >
          <div>
            <strong>Audio node offline.</strong>
            <span>
              Monitor output is unavailable. Snapshot values are not current.
            </span>
          </div>
        </section>
      ) : null}

      {snapshot || usingDeviceChannels ? (
        <nav className="filters" aria-label="Channel filters">
          <span className="filter-label">Showing</span>
          {(Object.keys(filterLabels) as Filter[]).map((filterOption) => (
            <button
              type="button"
              className="filter-button"
              aria-pressed={filter === filterOption}
              onClick={() => setFilter(filterOption)}
              key={filterOption}
            >
              {filterLabels[filterOption]} <span>{counts[filterOption]}</span>
            </button>
          ))}
        </nav>
      ) : null}

      <main className="channel-main">
        {snapshot || usingDeviceChannels ? (
          <>
            <div className="grid-heading">
              <h1>{filterLabels[filter]}</h1>
              <p>
                {visibleChannels.length} sources · press a card to select ·
                expand opens detail
              </p>
            </div>
            <div className="channel-grid">
              {visibleChannels.map((channel) => (
                <ChannelCard
                  channel={channel}
                  acknowledged={acknowledged.has(channel.id)}
                  selected={selectedId === channel.id}
                  onAcknowledge={() => acknowledge(channel)}
                  onSelect={() => selectChannel(channel)}
                  onOpenDetail={() => setDetailId(channel.id)}
                  key={channel.id}
                />
              ))}
            </div>
          </>
        ) : null}
      </main>

      <Player
        channel={selectedChannel}
        muted={muted}
        dimmed={dimmed}
        gainDb={gainDb}
        playback={visiblePlayback}
        directListeningAvailable={usingDeviceChannels}
        onToggleMute={() => setMuted((value) => !value)}
        onToggleDim={() => setDimmed((value) => !value)}
        onGainChange={(value) => setGainDb(clampMonitorGainDb(value))}
      />

      {detailChannel ? (
        <ChannelDetail
          channel={detailChannel}
          onClose={() => setDetailId(null)}
          onRunCheck={() => {
            setMicCheckId(detailChannel.id);
            setDetailId(null);
          }}
        />
      ) : null}

      {micCheckChannel && snapshot ? (
        <MicCheck
          channel={micCheckChannel}
          showName={snapshot.show.name}
          onClose={() => setMicCheckId(null)}
        />
      ) : null}
    </div>
  );
}
