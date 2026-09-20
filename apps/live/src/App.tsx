import { useEffect, useMemo, useState } from "react";
import type { LiveChannel } from "@a2-monitor/protocol/http";
import { ChannelCard } from "./components/ChannelCard";
import { ChannelDetail } from "./components/ChannelDetail";
import { Player } from "./components/Player";
import { httpSnapshotSource, type SnapshotSource } from "./snapshot";
import { useLiveSnapshot, type SnapshotState } from "./useLiveSnapshot";

type Filter = "all" | "needs-someone" | "wireless" | "wired";
type Theme = "system" | "light" | "dark";

const filterLabels: Record<Filter, string> = {
  all: "All channels",
  "needs-someone": "Needs someone",
  wireless: "Wireless",
  wired: "Wired",
};

const emptyChannels: LiveChannel[] = [];

function readTheme(): Theme {
  const saved = window.localStorage.getItem("a2-monitor-theme");
  return saved === "light" || saved === "dark" ? saved : "system";
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
}: {
  snapshotSource?: SnapshotSource;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [dimmed, setDimmed] = useState(false);
  const { state: snapshotState, reconnect } = useLiveSnapshot(snapshotSource);
  const snapshot = snapshotState.snapshot;
  const channels = snapshot?.channels ?? emptyChannels;

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      window.localStorage.removeItem("a2-monitor-theme");
    } else {
      document.documentElement.dataset.theme = theme;
      window.localStorage.setItem("a2-monitor-theme", theme);
    }
  }, [theme]);

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
  }

  return (
    <div className="live-app">
      <header className="app-header">
        <div className="brand" aria-label="A2 Monitor">
          <span aria-hidden="true">▲</span>
          <strong>A2</strong> <b>Monitor</b>
        </div>
        <div className="show-name">
          <strong>{snapshot?.show.name ?? "Show state unavailable"}</strong>
          <span>
            {snapshot
              ? `${snapshot.show.venue} · ${snapshot.show.performanceLabel}`
              : "Waiting for validated data"}
          </span>
        </div>
        <div
          className={`node-state node-${snapshot?.node.status ?? "unknown"}`}
        >
          <span>Node</span>
          <strong>
            {snapshot?.node.status === "ready" &&
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
        {snapshot ? (
          <span className="fabricated-badge">{snapshot.source.label}</span>
        ) : null}
        {snapshot ? (
          <button
            className="alert-count"
            type="button"
            onClick={() => setFilter("needs-someone")}
          >
            {alertCount} to acknowledge
          </button>
        ) : null}
        <label className="theme-picker">
          <span>Theme</span>
          <select
            value={theme}
            onChange={(event) => setTheme(event.target.value as Theme)}
          >
            <option value="system">System</option>
            <option value="light">Paper</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </header>

      <SnapshotNotice state={snapshotState} onReconnect={reconnect} />

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

      {snapshot ? (
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
        {snapshot ? (
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
        onToggleMute={() => setMuted((value) => !value)}
        onToggleDim={() => setDimmed((value) => !value)}
      />

      {detailChannel ? (
        <ChannelDetail
          channel={detailChannel}
          onClose={() => setDetailId(null)}
        />
      ) : null}
    </div>
  );
}
