import { useEffect, useMemo, useState } from "react";
import { ChannelCard } from "./components/ChannelCard";
import { ChannelDetail } from "./components/ChannelDetail";
import { Player } from "./components/Player";
import { initialChannels, type Channel } from "./dev-data/channels";

type Filter = "all" | "needs-someone" | "wireless" | "wired";
type Theme = "system" | "light" | "dark";

const filterLabels: Record<Filter, string> = {
  all: "All channels",
  "needs-someone": "Needs someone",
  wireless: "Wireless",
  wired: "Wired",
};

function readTheme(): Theme {
  const saved = window.localStorage.getItem("a2-monitor-theme");
  return saved === "light" || saved === "dark" ? saved : "system";
}

export function App() {
  const [filter, setFilter] = useState<Filter>("all");
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [dimmed, setDimmed] = useState(false);

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
      return initialChannels.filter(
        (channel) =>
          channel.alert || Object.values(channel.statuses).includes("fault"),
      );
    }
    if (filter === "wireless" || filter === "wired") {
      return initialChannels.filter((channel) => channel.kind === filter);
    }
    return initialChannels;
  }, [filter]);

  const selectedChannel =
    initialChannels.find((channel) => channel.id === selectedId) ?? null;
  const detailChannel =
    initialChannels.find((channel) => channel.id === detailId) ?? null;
  const alertCount = initialChannels.filter(
    (channel) => channel.alert && !acknowledged.has(channel.id),
  ).length;

  const counts: Record<Filter, number> = {
    all: initialChannels.length,
    "needs-someone": initialChannels.filter(
      (channel) =>
        channel.alert || Object.values(channel.statuses).includes("fault"),
    ).length,
    wireless: initialChannels.filter((channel) => channel.kind === "wireless")
      .length,
    wired: initialChannels.filter((channel) => channel.kind === "wired").length,
  };

  function acknowledge(channel: Channel) {
    setAcknowledged((current) => new Set(current).add(channel.id));
  }

  function selectChannel(channel: Channel) {
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
          <strong>The Winter Circus</strong>
          <span>Northgate Playhouse · Preview 3</span>
        </div>
        <div className="node-state">
          <span>Node</span>
          <strong>10 ch · 48k</strong>
        </div>
        <span className="fabricated-badge">Fabricated local data</span>
        <button
          className="alert-count"
          type="button"
          onClick={() => setFilter("needs-someone")}
        >
          {alertCount} to acknowledge
        </button>
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

      <main className="channel-main">
        <div className="grid-heading">
          <h1>{filterLabels[filter]}</h1>
          <p>
            {visibleChannels.length} sources · press a card to listen · expand
            opens detail
          </p>
        </div>
        <div className="channel-grid">
          {visibleChannels.map((channel) => (
            <ChannelCard
              channel={channel}
              acknowledged={acknowledged.has(channel.id)}
              listening={selectedId === channel.id}
              onAcknowledge={() => acknowledge(channel)}
              onListen={() => selectChannel(channel)}
              onOpenDetail={() => setDetailId(channel.id)}
              key={channel.id}
            />
          ))}
        </div>
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
