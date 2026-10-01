import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import {
  parseAlertLog,
  type FaultReport,
  type LiveAlert,
  type LiveState,
  type LiveStateChannel,
  type ReportedFault,
} from "@rvlt/pulse-protocol/http";
import {
  alertScope,
  alertsForChannel,
  byUrgency,
  criticalChannelIds,
  formatClock,
  overlayAlert,
} from "./alerts";
import {
  httpAudioDeviceSource,
  type AudioDeviceSource,
  type AudioDeviceState,
} from "./audio-device";
import {
  clampMonitorGainDb,
  DEFAULT_MONITOR_GAIN_DB,
  webRtcPlaybackFactory,
  type PlaybackFactory,
  type PlaybackSession,
  type PlaybackUpdate,
  type ListenSource,
  MAX_LISTEN_SOURCES,
} from "./audio-playback";
import { ChannelCard } from "./components/ChannelCard";
import { ChannelDetail } from "./components/ChannelDetail";
import { ExceptionsSheet } from "./components/ExceptionsSheet";
import { MicCheck } from "./components/MicCheck";
import { OperatorSheet } from "./components/OperatorSheet";
import { FilterBar, type FilterOption } from "./components/FilterBar";
import { HeaderMenu } from "./components/HeaderMenu";
import { OutputSheet } from "./components/OutputSheet";
import { RoomSheet } from "./components/RoomSheet";
import { Player } from "./components/Player";
import { A1Bar, ReportBanner } from "./components/Reports";
import { ReportSheet } from "./components/ReportSheet";
import { SelectionBar } from "./components/SelectionBar";
import { SessionBar } from "./components/SessionBar";
import { SessionSheet } from "./components/SessionSheet";
import type { CardReportState } from "./components/ChannelCard";
import { recordCheck } from "./mic-check";
import {
  actOnReport,
  fileReport,
  isActiveReport,
  type ReportAction,
} from "./reports";
import {
  acknowledgeAlert,
  resetChannel,
  createEventSourceLiveState,
  type LiveStateConnection,
  type LiveStateSource,
} from "./live-state";
import {
  createHttpHostOutputSource,
  describeOutputChannels,
  readLastDestination,
  feedIdOf,
  saveLastDestination,
  useHostOutput,
  type HostMonitorChange,
  type HostOutputSource,
  type OutputDestination,
} from "./host-output";
import { MeterStore } from "./meters";
import { fitGlance } from "./glance-layout";
import {
  categoryIdInRoom,
  effectiveRoom,
  groupChannels,
  inRoom,
  roomTone,
  type RoomChoice,
  type RoomOption,
} from "./rooms";
import {
  NO_ROOM,
  formatStartMinute,
  nextSessionMinutes,
  roomKeyOf,
  sessionById,
  startSession,
  turnoverItems,
  type SessionState,
  type TurnoverItem,
} from "./sessions";
import {
  loadOperator,
  operatorLabel,
  saveOperator,
  type Operator,
} from "./operator";
import { useAudioDevice } from "./useAudioDevice";
import { useLiveState } from "./useLiveState";
import { useNow } from "./useNow";

/**
 * "all", "session", "needs-someone", or a category
 * (`cat:<id>`, `cat:none` for channels without one).
 */
type Filter = string;

const ALERT_LOG_REFRESH_MS = 5_000;
/** How long a fresh capture dropout is called out above the grid. */
const DROPOUT_NOTICE_MS = 60_000;
const defaultLiveStateSource = createEventSourceLiveState();
const defaultHostOutputSource = createHttpHostOutputSource();

function readMonitorGainDb(): number {
  try {
    const stored = window.localStorage.getItem("pulse-gain-db");
    if (stored === null) return DEFAULT_MONITOR_GAIN_DB;
    const saved = Number(stored);
    return Number.isFinite(saved)
      ? clampMonitorGainDb(saved)
      : DEFAULT_MONITOR_GAIN_DB;
  } catch {
    return DEFAULT_MONITOR_GAIN_DB;
  }
}

/** A measured problem the card shows: an alert, or a faulted or cautioned strip cell. */
function needsSomeone(channel: LiveStateChannel, alerts: readonly LiveAlert[]) {
  const { rf, audio, battery } = channel.statuses;
  return (
    alerts.some(({ channelId }) => channelId === channel.id) ||
    [rf, audio, battery].some(
      (verdict) => verdict === "fault" || verdict === "caution",
    )
  );
}

/** Last-known identity with every judgement withdrawn: what Live shows while the backend is away. */
function withdrawnChannel(
  channel: LiveStateChannel,
  inputUsable: boolean,
): LiveStateChannel {
  const unknownUnlessNa = (verdict: LiveStateChannel["statuses"]["rf"]) =>
    verdict === "not-applicable" ? verdict : "unknown";
  return {
    ...channel,
    input: {
      index: inputUsable ? channel.input.index : null,
      label: inputUsable
        ? channel.input.label
        : `${channel.input.label} · not confirmed on the running device`,
    },
    statuses: {
      rf: unknownUnlessNa(channel.statuses.rf),
      audio: "unknown",
      battery: unknownUnlessNa(channel.statuses.battery),
      check: "unknown",
    },
    audio: { ...channel.audio, availability: "unknown" },
    rf: { ...channel.rf, availability: "unknown" },
    battery: { ...channel.battery, availability: "unknown" },
  };
}

/** Observed inputs with no identity, for a backend that has never answered. */
function inputChannels(device: AudioDeviceState): LiveStateChannel[] {
  return (device.channels ?? []).map(({ index, label }) => ({
    id: `input-${index + 1}`,
    number: index + 1,
    name: label || `Input ${index + 1}`,
    performer: null,
    kind: "wired",
    micType: null,
    micTypeSource: null,
    hasImage: false,
    input: {
      index,
      label: `${device.device?.name ?? "Audio device"} · input ${index + 1}`,
    },
    receiver: null,
    monitor: { battery: false, rf: false, audio: false },
    statuses: {
      rf: "not-applicable",
      audio: "unknown",
      battery: "not-applicable",
      check: "unknown",
    },
    audio: {
      availability: "unknown",
      peakDbfs: null,
      rmsDbfs: null,
      silentForMs: null,
      clipping: false,
    },
    rf: {
      availability: "unknown",
      levelDbm: null,
      linkQualityPercent: null,
      activeAntenna: null,
      interference: "unavailable",
      transmitterPresent: null,
    },
    battery: {
      availability: "unknown",
      percent: null,
      bars: null,
      runtimeMinutes: null,
      type: null,
    },
    transmitter: { type: null, name: null, muted: null, observedAtUtc: null },
    check: null,
  }));
}

/** What a card says about the fault reports on its channel. */
function cardReportState(
  reports: readonly FaultReport[],
  channelId: string,
): CardReportState | null {
  const active = reports.filter(
    (report) => report.channelId === channelId && isActiveReport(report),
  );
  if (active.length === 0) return null;
  const claimed = active.find(({ status }) => status === "claimed");
  return {
    unclaimed: active.filter(({ status }) => status === "open").length,
    claimedBy: claimed?.claimedBy ?? null,
    awaitingConfirmation: active.some(
      ({ status }) => status === "awaiting-confirmation",
    ),
  };
}

function NodeNotice({ state }: { state: LiveState }) {
  const { node } = state;
  if (node.status === "ready") return null;
  const content = {
    unreachable: {
      title: "Audio node not answering.",
      detail: `${node.detail} Meters, listening and audio verdicts are unavailable.`,
      tone: "offline",
    },
    starting: {
      title: "Opening the audio device.",
      detail: node.detail,
      tone: "waiting",
    },
    "configuration-required": {
      title: "No audio device is selected.",
      detail: `${node.detail} Choose one in the Pulse app window.`,
      tone: "waiting",
    },
    error: {
      title: "Audio capture failed.",
      detail: node.detail,
      tone: "offline",
    },
  }[node.status];
  return (
    <section
      className={`snapshot-notice snapshot-${content.tone}`}
      aria-live="polite"
    >
      <div>
        <strong>{content.title}</strong>
        <span>{content.detail}</span>
      </div>
    </section>
  );
}

function ReceiverNotice({ state }: { state: LiveState }) {
  const { receivers } = state;
  if (
    receivers.status === "ready" ||
    receivers.status === "unconfigured" ||
    state.node.status === "unreachable"
  ) {
    return null;
  }
  const notCurrent = receivers.units.filter(({ status }) => status !== "ready");
  return (
    <section className="snapshot-notice snapshot-waiting" aria-live="polite">
      <div>
        <strong>Receiver telemetry is not current.</strong>
        <span>
          {notCurrent
            .map(({ name, status }) => `${name}: ${status}`)
            .join(" · ")}
          . RF and battery on those channels read as unknown until it returns.
        </span>
      </div>
    </section>
  );
}

function ConnectionNotice({
  connection,
  state,
  device,
}: {
  connection: LiveStateConnection;
  state: LiveState | null;
  device: AudioDeviceState | null;
}) {
  if (connection === "live") return null;
  if (connection === "offline") {
    return (
      <section
        className="snapshot-notice snapshot-offline"
        aria-live="assertive"
      >
        <div>
          <strong>Backend unavailable.</strong>
          <span>
            {state
              ? `Showing identity last confirmed at ${formatClock(state.generatedAtUtc)}. `
              : "No show identity has been received. "}
            {device
              ? "Listening continues from the audio node. "
              : "The audio node is not answering either. "}
            Alerts, receiver telemetry and acknowledgements are not current.
          </span>
        </div>
      </section>
    );
  }
  return (
    <section className="snapshot-notice snapshot-waiting" aria-live="polite">
      <div>
        <strong>
          {connection === "connecting"
            ? "Waiting for the backend."
            : "Reconnecting to the backend."}
        </strong>
        <span>
          {state
            ? "Showing the last state received. It may be stale."
            : "No channel state is shown until a validated state arrives."}
        </span>
      </div>
    </section>
  );
}

/**
 * What the one listen stream carries: every selected channel with a patched
 * input, at its showfile trim. The node mixes at most MAX_LISTEN_SOURCES, so
 * past that the most recent selections win.
 */
function listenMix(selected: readonly LiveStateChannel[]): {
  ids: string[];
  sources: ListenSource[];
} {
  const patched = selected
    .filter((channel) => channel.input.index !== null)
    .slice(-MAX_LISTEN_SOURCES);
  return {
    ids: patched.map((channel) => channel.id),
    sources: patched.map((channel) => ({
      channel: channel.input.index!,
      trimDb: channel.trimDb ?? 0,
    })),
  };
}

export function App({
  liveStateSource = defaultLiveStateSource,
  audioDeviceSource = httpAudioDeviceSource,
  playbackFactory = webRtcPlaybackFactory,
  hostOutputSource = defaultHostOutputSource,
  meterStore: providedMeterStore,
  fetchAlertLog = fetch,
}: {
  liveStateSource?: LiveStateSource;
  audioDeviceSource?: AudioDeviceSource;
  playbackFactory?: PlaybackFactory;
  hostOutputSource?: HostOutputSource;
  meterStore?: MeterStore;
  fetchAlertLog?: typeof fetch;
}) {
  const [meterStore] = useState(() => providedMeterStore ?? new MeterStore());
  useEffect(() => {
    if (providedMeterStore) return undefined;
    meterStore.start();
    return () => meterStore.stop();
  }, [meterStore, providedMeterStore]);
  const meterConnection = useSyncExternalStore(
    useCallback((listener) => meterStore.subscribe(listener), [meterStore]),
    () => meterStore.connection,
  );

  const { connection, state: liveState, apply } = useLiveState(liveStateSource);
  const audioDeviceState = useAudioDevice(audioDeviceSource);
  const nowMs = useNow(1000);
  const [operator, setOperator] = useState<Operator>(loadOperator);
  const [chosenFilter, setFilter] = useState<Filter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem("pulse-selected-channels");
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed)
          ? parsed.filter((id): id is string => typeof id === "string")
          : [];
      }
      // Migrated from the single-channel key this replaces.
      const legacy = window.localStorage.getItem("pulse-selected-channel");
      return legacy ? [legacy] : [];
    } catch {
      return [];
    }
  });
  /** The channel a Shift-click or Shift-Enter range extends from. */
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
    null,
  );
  /** Touch equivalent of holding Ctrl/Cmd: entered by a long-press, it turns
   * every following tap into a toggle instead of a plain select. */
  const [touchSelecting, setTouchSelecting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  /** Glance fits every channel on one screen; cards are the photo layout. Per device. */
  const [gridView, setGridView] = useState<"glance" | "cards">(() => {
    try {
      return window.localStorage.getItem("pulse-grid-view") === "glance"
        ? "glance"
        : "cards";
    } catch {
      return "cards";
    }
  });
  const chooseGridView = (next: "glance" | "cards") => {
    setGridView(next);
    try {
      window.localStorage.setItem("pulse-grid-view", next);
    } catch {
      // The layout is a per-device convenience.
    }
  };
  const mainRef = useRef<HTMLElement>(null);
  /** The card holding the grid's roving focus: the grid's one Tab stop. */
  const [focusId, setFocusId] = useState<string | null>(null);
  /** Keys typed in quick succession on the grid: a channel number or name. */
  const typeahead = useRef({ text: "", atMs: 0 });
  const [micCheckId, setMicCheckId] = useState<string | null>(null);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  /** Room key of the run whose turnover sheet is open. */
  const [turnoverRoom, setTurnoverRoom] = useState<string | null>(null);
  const [roomChoice, setRoomChoice] = useState<RoomChoice>(() => {
    try {
      return window.localStorage.getItem("pulse-room") ?? "all";
    } catch {
      return "all";
    }
  });
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [alertHistory, setAlertHistory] = useState<LiveAlert[] | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportChannelId, setReportChannelId] = useState<string | null>(null);
  const [filedReportId, setFiledReportId] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** When the node's lost-audio count last went up while this page watched. */
  const [dropoutAtMs, setDropoutAtMs] = useState<number | null>(null);
  const seenDropouts = useRef<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [dimmed, setDimmed] = useState(false);
  const [gainDb, setGainDb] = useState(readMonitorGainDb);
  const [playback, setPlayback] = useState<PlaybackUpdate | null>(null);
  // One WebRTC session carries every selected channel, mixed node-side. It
  // outlives any selection: changing what is monitored retargets it with
  // `setSources`, the same connection throughout.
  const playbackSession = useRef<PlaybackSession | null>(null);
  const outputState = useRef({ muted: false, dimmed: false, gainDb });
  const announcedCritical = useRef<Set<string> | null>(null);

  const offline = connection === "offline";
  const device =
    audioDeviceState.status === "ready" ? audioDeviceState.device : null;

  // Where monitor audio plays (ADR 0031). Live asks once when the node has a
  // host output: this device, or one of its shared feeds. The answer is
  // remembered in this browser and reused on later opens until the joined feed
  // is removed. Without a host output, this device plays.
  const hostOutput = useHostOutput(hostOutputSource);
  const hostDocument = hostOutput.document;
  const hostAvailability: "unknown" | "absent" | "present" = hostDocument
    ? hostDocument.output
      ? "present"
      : "absent"
    : hostOutput.connection === "offline"
      ? "absent"
      : "unknown";
  const [destination, setDestination] = useState<OutputDestination | null>(
    null,
  );
  const [outputSheetOpen, setOutputSheetOpen] = useState(false);
  const [rememberedDestination] = useState(readLastDestination);
  // A remembered feed is only trusted once the node reports its host output, so
  // it can be checked against the feeds the production has now.
  const requestedDestination =
    destination ?? (hostDocument?.output ? rememberedDestination : null);
  const hostFeedId = requestedDestination
    ? feedIdOf(requestedDestination)
    : null;
  const hostFeed =
    hostFeedId === null
      ? null
      : (hostDocument?.feeds.find(({ id }) => id === hostFeedId) ?? null);
  // A joined feed that the production no longer has asks again.
  const feedGone =
    hostFeedId !== null && hostDocument?.output != null && !hostFeed;
  const chosenDestination: OutputDestination | null = feedGone
    ? null
    : (requestedDestination ??
      (hostAvailability === "absent" ? "device" : null));
  const hostMode = chosenDestination !== null && chosenDestination !== "device";
  const deviceMode = chosenDestination === "device";
  const hostMonitor = hostMode ? (hostFeed?.monitor ?? null) : null;

  const channels = useMemo<LiveStateChannel[]>(() => {
    if (liveState && !offline) return liveState.channels;
    if (liveState) {
      const lastDevice = liveState.node.device;
      const sameDevice =
        device?.device !== undefined &&
        lastDevice !== null &&
        device.device.name === lastDevice.name &&
        device.device.channelCount === lastDevice.channelCount;
      return liveState.channels.map((channel) =>
        withdrawnChannel(channel, sameDevice),
      );
    }
    return device ? inputChannels(device) : [];
  }, [device, liveState, offline]);

  const activeAlerts = useMemo(
    () => (liveState && !offline ? liveState.alerts : []),
    [liveState, offline],
  );
  const criticalIds = useMemo(
    () =>
      liveState && !offline ? criticalChannelIds(liveState) : new Set<string>(),
    [liveState, offline],
  );

  // On host output the selection is the shared one, so every client shows it;
  // the shared hardware feed still carries only one input at a time, so it
  // never takes more than one channel.
  const hostSelectedId = hostMonitor
    ? (channels.find(
        ({ id, input }) =>
          id === hostMonitor.channelId && input.index === hostMonitor.input,
      )?.id ??
      channels.find(({ input }) => input.index === hostMonitor.input)?.id ??
      null)
    : null;
  const effectiveSelectedIds = hostMode
    ? hostSelectedId
      ? [hostSelectedId]
      : []
    : selectedIds;
  const selectedChannels = effectiveSelectedIds
    .map((id) => channels.find((channel) => channel.id === id))
    .filter((channel): channel is LiveStateChannel => channel !== undefined);
  // The most recently added channel is the one the player's meter, timeline
  // and trim follow when several are being monitored at once.
  const primarySelectedId =
    effectiveSelectedIds[effectiveSelectedIds.length - 1] ?? null;
  const selectedChannel =
    selectedChannels.find((channel) => channel.id === primarySelectedId) ??
    null;
  const detailChannel =
    channels.find((channel) => channel.id === detailId) ?? null;
  const micCheckChannel =
    channels.find((channel) => channel.id === micCheckId) ?? null;
  const selectedInput = device ? (selectedChannel?.input.index ?? null) : null;

  useEffect(() => {
    try {
      if (selectedIds.length) {
        window.localStorage.setItem(
          "pulse-selected-channels",
          JSON.stringify(selectedIds),
        );
      } else window.localStorage.removeItem("pulse-selected-channels");
      // Migrated on load (above); drop it so stale data never reappears.
      window.localStorage.removeItem("pulse-selected-channel");
    } catch {
      // Selection is per-device convenience only.
    }
  }, [selectedIds]);

  // Every monitored channel plays through one listen session: the node sums
  // them sample-aligned, each at its showfile trim, so a multi-selection is one
  // time-aligned mix rather than several streams drifting against each other.
  // Selecting, deselecting or re-trimming retargets that session in place; it
  // opens with the first patched selection and closes with the last. Mute, dim
  // and gain stay on the one monitor output.
  const { ids: mixedIds, sources: wanted } = listenMix(
    deviceMode && device ? selectedChannels : [],
  );
  useEffect(() => {
    const session = playbackSession.current;
    if (wanted.length === 0) {
      if (session) {
        session.close();
        playbackSession.current = null;
        setPlayback(null);
      }
      return;
    }
    if (session) {
      session.setSources(wanted);
      return;
    }
    const opened = playbackFactory({ sources: wanted, onUpdate: setPlayback });
    playbackSession.current = opened;
    opened.setGainDb(outputState.current.gainDb);
    opened.setDimmed(outputState.current.dimmed);
    void opened.setMuted(outputState.current.muted);
    // `wanted` is rebuilt every render; the session ignores an unchanged mix.
  }, [wanted, playbackFactory]);

  // The session otherwise outlives this effect; only unmounting closes it.
  useEffect(
    () => () => {
      playbackSession.current?.close();
      playbackSession.current = null;
    },
    [],
  );

  useEffect(() => {
    outputState.current = { muted, dimmed, gainDb };
    try {
      window.localStorage.setItem("pulse-gain-db", String(gainDb));
    } catch {
      // Gain still applies for this session.
    }
    const session = playbackSession.current;
    if (session) {
      session.setGainDb(gainDb);
      session.setDimmed(dimmed);
      void session.setMuted(muted);
    }
  }, [dimmed, gainDb, muted]);

  const changeHost = useCallback(
    async (change: Omit<HostMonitorChange, "changedBy">) => {
      setActionError(null);
      if (hostFeedId === null) return;
      try {
        await hostOutput.change(hostFeedId, {
          ...change,
          changedBy: operatorLabel(operator),
        });
      } catch (error) {
        setActionError(
          `Host output did not change. ${
            error instanceof Error ? error.message : ""
          }`.trim(),
        );
      }
    },
    [hostOutput, hostFeedId, operator],
  );

  const shownMuted = hostMode ? (hostMonitor?.muted ?? false) : muted;
  const shownDimmed = hostMode ? (hostMonitor?.dimmed ?? false) : dimmed;
  const shownGainDb = hostMode ? (hostMonitor?.gainDb ?? 0) : gainDb;
  const toggleMute = () =>
    hostMode
      ? void changeHost({ muted: !shownMuted })
      : setMuted((value) => !value);
  const toggleDim = () =>
    hostMode
      ? void changeHost({ dimmed: !shownDimmed })
      : setDimmed((value) => !value);
  const keyboardToggles = useRef({ toggleMute, toggleDim });
  /** Escape closes an open sheet first; with none open it clears the selection. */
  const escapeAction = useRef<() => void>(() => undefined);
  /** Ctrl/Cmd+A selects every visible channel; returns whether it handled the key. */
  const selectAllAction = useRef<() => boolean>(() => false);
  useEffect(() => {
    keyboardToggles.current = { toggleMute, toggleDim };
  });

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "a"
      ) {
        if (selectAllAction.current()) event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() === "m") keyboardToggles.current.toggleMute();
      if (event.key.toLowerCase() === "d") keyboardToggles.current.toggleDim();
      if (event.key === "Escape") escapeAction.current();
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  // Announce each newly raised critical alert once; a meter never announces.
  useEffect(() => {
    if (!liveState || offline) return;
    const critical = liveState.alerts.filter(
      ({ severity, acknowledgedAtUtc }) =>
        severity === "critical" && acknowledgedAtUtc === null,
    );
    if (announcedCritical.current === null) {
      announcedCritical.current = new Set(critical.map(({ id }) => id));
      return;
    }
    const fresh = critical.filter(
      ({ id }) => !announcedCritical.current!.has(id),
    );
    for (const alert of fresh) announcedCritical.current.add(alert.id);
    if (fresh.length) {
      setAnnouncement(
        fresh
          .map((alert) => `Critical: ${alert.label}, ${alertScope(alert)}.`)
          .join(" "),
      );
    }
  }, [liveState, offline]);

  // A rise in the node's count is a fresh loss; the first reading, or a lower
  // one after capture restarts, is only a baseline.
  const nodeDropouts = liveState?.node.dropouts;
  const nodeDropoutTotal = nodeDropouts
    ? nodeDropouts.callbacks + nodeDropouts.blocks
    : null;
  useEffect(() => {
    if (nodeDropoutTotal === null) return;
    const seen = seenDropouts.current;
    seenDropouts.current = nodeDropoutTotal;
    if (seen !== null && nodeDropoutTotal > seen) setDropoutAtMs(Date.now());
  }, [nodeDropoutTotal]);

  const wantsAlertLog = exceptionsOpen || detailId !== null || timelineOpen;
  useEffect(() => {
    if (!wantsAlertLog) return undefined;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetchAlertLog("/api/v1/alerts", {
          signal: controller.signal,
        });
        if (response.ok) {
          setAlertHistory(parseAlertLog(await response.json()).history);
        }
      } catch {
        // The log is supplementary; active alerts come from the live state.
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), ALERT_LOG_REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [fetchAlertLog, wantsAlertLog]);

  const acknowledge = useCallback(
    async (alert: LiveAlert) => {
      setActionError(null);
      try {
        apply(await acknowledgeAlert(alert.id, operatorLabel(operator)));
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : "The acknowledgement was not recorded.",
        );
      }
    },
    [apply, operator],
  );

  const resetChannelAlerts = useCallback(
    async (channelId: string) => {
      setActionError(null);
      try {
        apply(await resetChannel(channelId));
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "The channel was not reset.",
        );
      }
    },
    [apply],
  );

  /** Resets every selected channel in turn; the last reply is the freshest state. */
  const resetChannelsAlerts = useCallback(
    async (channelIds: readonly string[]) => {
      setActionError(null);
      try {
        for (const channelId of channelIds) {
          apply(await resetChannel(channelId));
        }
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : "The channels were not reset.",
        );
      }
    },
    [apply],
  );

  const reports = useMemo(
    () => (liveState && !offline ? liveState.reports : []),
    [liveState, offline],
  );

  const rooms = useMemo(() => liveState?.rooms ?? [], [liveState]);
  const room = effectiveRoom(roomChoice, rooms, channels);
  const roomChannels = useMemo(
    () => channels.filter((channel) => inRoom(channel, room)),
    [channels, room],
  );
  const runs = useMemo(
    () =>
      (liveState?.runs ?? []).filter(
        ({ roomId }) => room === "all" || roomKeyOf(roomId) === room,
      ),
    [liveState, room],
  );
  const sessionRunning = !offline && runs.some(({ activeId }) => activeId);
  const roomName = (roomId: string | null) =>
    roomId === null
      ? "No room"
      : (rooms.find(({ id }) => id === roomId)?.name ?? "Room");

  const [roomSheetOpen, setRoomSheetOpen] = useState(false);
  const roomOptions = useMemo<RoomOption[]>(() => {
    if (!rooms.length) return [];
    // A channel in several rooms (ADR 0035) counts toward each of them.
    const roomKeysByChannel = new Map(
      channels.map((channel) => [
        channel.id,
        (channel.rooms ?? []).length
          ? channel.rooms!.map(({ roomId }) => roomKeyOf(roomId))
          : [NO_ROOM],
      ]),
    );
    const entries = [
      { key: "all", label: "All rooms" },
      ...rooms.map(({ id, name }) => ({ key: id, label: name })),
      ...(channels.some((channel) => !(channel.rooms ?? []).length)
        ? [{ key: NO_ROOM, label: "No room" }]
        : []),
    ];
    return entries.map(({ key, label }) => {
      const scoped = activeAlerts.filter(
        ({ channelId }) =>
          key === "all" ||
          (channelId !== null &&
            (roomKeysByChannel.get(channelId) ?? []).includes(key)),
      );
      const unseen = scoped.filter(
        ({ acknowledgedAtUtc }) => acknowledgedAtUtc === null,
      );
      const run =
        key === "all"
          ? undefined
          : runs.find(({ roomId }) => roomKeyOf(roomId) === key);
      const now = sessionById(run, run?.activeId ?? null);
      const next = sessionById(run, run?.nextId ?? null);
      const start = formatStartMinute(next?.startMinute ?? null);
      return {
        key,
        label,
        channelCount: channels.filter((channel) => inRoom(channel, key)).length,
        outstanding: unseen.length,
        critical: unseen.filter(({ severity }) => severity === "critical")
          .length,
        seen: scoped.length - unseen.length,
        session: now
          ? `Now: ${now.name}`
          : next
            ? `Next: ${next.name}${start ? ` ${start}` : ""}`
            : null,
      };
    });
  }, [activeAlerts, channels, rooms, runs]);
  // A room other than the one shown may still need someone: the header hints at it.
  const otherRoomTone = roomOptions
    .filter(({ key }) => room !== "all" && key !== "all" && key !== room)
    .map(roomTone)
    .reduce<"critical" | "caution" | "clear">(
      (worst, tone) =>
        worst === "critical" || tone === "critical"
          ? "critical"
          : worst === "caution" || tone === "caution"
            ? "caution"
            : "clear",
      "clear",
    );
  const shownRoom = roomOptions.find(({ key }) => key === room);

  function chooseRoom(next: RoomChoice) {
    setRoomChoice(next);
    try {
      window.localStorage.setItem("pulse-room", next);
    } catch {
      // The room is a per-device convenience.
    }
  }

  // Each room's turnover covers only that room's channels.
  const turnovers = useMemo(() => {
    const byRoom = new Map<string, TurnoverItem[]>();
    if (!liveState || offline) return byRoom;
    for (const run of liveState.runs ?? []) {
      const key = roomKeyOf(run.roomId);
      byRoom.set(
        key,
        turnoverItems(
          liveState.channels.filter((channel) => inRoom(channel, key)),
          nextSessionMinutes(run),
        ),
      );
    }
    return byRoom;
  }, [liveState, offline]);
  const turnoverRun: SessionState | null =
    turnoverRoom === null
      ? null
      : ((liveState?.runs ?? []).find(
          ({ roomId }) => roomKeyOf(roomId) === turnoverRoom,
        ) ?? null);

  const changeSession = useCallback(
    async (sessionId: string | null, roomId: string | null) => {
      setSessionBusy(true);
      setSessionError(null);
      try {
        apply(await startSession(sessionId, roomId, operatorLabel(operator)));
        setTurnoverRoom(null);
      } catch (error) {
        setSessionError(
          error instanceof Error
            ? error.message
            : "The session did not change.",
        );
      } finally {
        setSessionBusy(false);
      }
    },
    [apply, operator],
  );
  const isA1 = operator.role === "A1";

  const reportAction = useCallback(
    async (report: FaultReport, action: ReportAction) => {
      setReportBusy(true);
      setReportError(null);
      setActionError(null);
      try {
        apply(await actOnReport(report.id, action, operatorLabel(operator)));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "The report did not change.";
        setReportError(message);
        setActionError(message);
      } finally {
        setReportBusy(false);
      }
    },
    [apply, operator],
  );

  const sendReport = useCallback(
    async (
      channel: LiveStateChannel,
      faults: ReportedFault[],
      note: string | null,
    ) => {
      setReportBusy(true);
      setReportError(null);
      try {
        const next = await fileReport(
          channel.id,
          faults,
          note,
          operatorLabel(operator),
        );
        apply(next);
        const filed = [...next.reports]
          .reverse()
          .find(({ channelId }) => channelId === channel.id);
        setFiledReportId(filed?.id ?? null);
      } catch (error) {
        setReportError(
          error instanceof Error ? error.message : "The report was not sent.",
        );
      } finally {
        setReportBusy(false);
      }
    },
    [apply, operator],
  );

  const audioVerdict = useCallback(
    async (channel: LiveStateChannel, pass: boolean) => {
      setReportBusy(true);
      setActionError(null);
      try {
        await recordCheck(
          channel.id,
          "captured-audio",
          pass ? "pass" : "fail",
          `${operator.name.trim() || "Unnamed"} (A1)`,
        );
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : "The verdict was not recorded.",
        );
      } finally {
        setReportBusy(false);
      }
    },
    [operator],
  );

  // The filter row: everything, what needs someone, then the room's categories.
  const filterOptions = useMemo<FilterOption[]>(() => {
    const count = (matches: (channel: LiveStateChannel) => boolean) =>
      roomChannels.filter(matches).length;
    const categories = rooms.flatMap((entry) =>
      room !== "all" && room !== entry.id
        ? []
        : entry.categories.map((category) => ({
            key: `cat:${category.id}`,
            label:
              room === "all" && rooms.length > 1
                ? `${entry.name} · ${category.name}`
                : category.name,
            count: count(
              (channel) => categoryIdInRoom(channel, entry.id!) === category.id,
            ),
          })),
    );
    const uncategorised =
      room === "all"
        ? 0
        : count((channel) => categoryIdInRoom(channel, room) === null);
    const byCategory: FilterOption[] = [
      ...categories.filter(({ count: members }) => members > 0),
      ...(categories.length && room !== "all" && uncategorised > 0
        ? [{ key: "cat:none", label: "No category", count: uncategorised }]
        : []),
    ];
    return [
      { key: "all", label: "All channels", count: roomChannels.length },
      ...(sessionRunning
        ? [
            {
              key: "session",
              label: "This session",
              count: count(({ session }) => session?.inUse !== false),
            },
          ]
        : []),
      {
        key: "needs-someone",
        label: "Needs someone",
        count: count((channel) => needsSomeone(channel, activeAlerts)),
      },
      ...byCategory,
    ];
  }, [activeAlerts, room, roomChannels, rooms, sessionRunning]);
  // A filter that no longer exists (the run ended, another room) falls back to all.
  const filter: Filter = filterOptions.some(({ key }) => key === chosenFilter)
    ? chosenFilter
    : "all";
  const filterLabel =
    filterOptions.find(({ key }) => key === filter)?.label ?? "All channels";

  const visibleChannels = useMemo(() => {
    const matches = (channel: LiveStateChannel) => {
      if (filter === "session") return channel.session?.inUse !== false;
      if (filter === "needs-someone")
        return needsSomeone(channel, activeAlerts);
      if (filter === "cat:none")
        return categoryIdInRoom(channel, room) === null;
      if (filter.startsWith("cat:")) {
        const categoryId = filter.slice("cat:".length);
        return (channel.rooms ?? []).some(
          (membership) => membership.categoryId === categoryId,
        );
      }
      return true;
    };
    // Showfile order, always: a critical channel stays visible whatever the
    // filter, but in its own place, so no card ever moves.
    // Another room's critical fault counts in the header and the exceptions
    // sheet; this device's grid stays on its own room.
    return roomChannels.filter(
      (channel) => criticalIds.has(channel.id) || matches(channel),
    );
  }, [activeAlerts, roomChannels, criticalIds, filter, room]);
  const groups = useMemo(
    () => groupChannels(visibleChannels, rooms, room),
    [visibleChannels, rooms, room],
  );
  // Glance view: size tiles so every channel in view fits between the top of
  // the grid and the player, never below a touch target (then it scrolls).
  const groupShape = groups
    .map((group) => `${group.title ? 1 : 0}:${group.channels.length}`)
    .join(",");
  const fitGlanceGrid = useRef<() => void>(() => undefined);
  function fitGrid() {
    const main = mainRef.current;
    if (gridView !== "glance" || !main) return;
    const shape = groupShape
      .split(",")
      .filter(Boolean)
      .map((entry) => {
        const [titled, count] = entry.split(":");
        return { titled: titled === "1", count: Number(count) };
      });
    const style = getComputedStyle(main);
    const paddingX =
      Number.parseFloat(style.paddingLeft) +
      Number.parseFloat(style.paddingRight);
    const firstGroup = main.querySelector(".channel-group");
    const top =
      (firstGroup ?? main).getBoundingClientRect().top + window.scrollY;
    const player =
      document.querySelector(".player")?.getBoundingClientRect().height ?? 0;
    const fit = fitGlance({
      width: main.clientWidth - paddingX,
      height:
        window.innerHeight -
        top -
        player -
        Number.parseFloat(style.paddingBottom),
      groups: shape,
    });
    main.style.setProperty("--glance-columns", String(fit.columns));
    main.style.setProperty("--glance-tile-height", `${fit.tileHeight}px`);
    // Tall enough for a second line: the alert's name under the channel's.
    main.toggleAttribute("data-glance-roomy", fit.tileHeight >= 64);
  }
  // After every render: a notice or bar appearing above the grid moves it.
  useLayoutEffect(() => {
    fitGlanceGrid.current = fitGrid;
    fitGrid();
  });
  useEffect(() => {
    const apply = () => fitGlanceGrid.current();
    window.addEventListener("resize", apply);
    const player = document.querySelector(".player");
    const observer =
      typeof ResizeObserver === "undefined" || !player
        ? null
        : new ResizeObserver(apply);
    if (player) observer?.observe(player);
    return () => {
      window.removeEventListener("resize", apply);
      observer?.disconnect();
    };
  }, []);

  /** Every visible channel in on-screen order, for Shift range-select. */
  const orderedChannelIds = useMemo(
    () => groups.flatMap((group) => group.channels.map(({ id }) => id)),
    [groups],
  );

  const gridFocusId =
    focusId !== null && orderedChannelIds.includes(focusId)
      ? focusId
      : (orderedChannelIds[0] ?? null);

  /** Moves the grid's focus to a channel's card and keeps it in the tab order. */
  function focusCard(channelId: string) {
    setFocusId(channelId);
    mainRef.current
      ?.querySelector<HTMLElement>(
        `[data-channel-id="${CSS.escape(channelId)}"] [data-card-target]`,
      )
      ?.focus();
  }

  /**
   * Keyboard on the grid (DESIGN.md §8.3): arrows move between cards as they
   * sit on screen, Home and End go to the ends, and typing a channel number
   * or the start of a name jumps to it. Space and Enter press the focused
   * card like a tap; Escape, M and D are handled for the whole page.
   */
  /** Whether a number or name is still being typed (keys under 800 ms apart). */
  const typing = () => Date.now() - typeahead.current.atMs < 800;

  function onGridKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (!target.matches("[data-card-target]")) return;
    const current =
      target.closest<HTMLElement>("[data-channel-id]")?.dataset.channelId;
    if (!current) return;
    const index = orderedChannelIds.indexOf(current);
    let next: string | undefined;
    if (event.key === "ArrowRight") next = orderedChannelIds[index + 1];
    else if (event.key === "ArrowLeft") next = orderedChannelIds[index - 1];
    else if (event.key === "Home") next = orderedChannelIds[0];
    else if (event.key === "End") next = orderedChannelIds.at(-1);
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // The card in the next row down (or up) nearest in x, as laid out.
      const cards = [
        ...(mainRef.current?.querySelectorAll<HTMLElement>(
          "[data-channel-id]",
        ) ?? []),
      ];
      const here = cards
        .find((card) => card.dataset.channelId === current)
        ?.getBoundingClientRect();
      if (here) {
        const down = event.key === "ArrowDown";
        const candidates = cards
          .map((card) => ({ card, box: card.getBoundingClientRect() }))
          .filter(({ box }) =>
            down ? box.top >= here.bottom - 1 : box.bottom <= here.top + 1,
          );
        const rowEdge = down
          ? Math.min(...candidates.map(({ box }) => box.top))
          : Math.max(...candidates.map(({ box }) => box.bottom));
        const x = here.left + here.width / 2;
        next = candidates
          .filter(({ box }) =>
            down ? box.top === rowEdge : box.bottom === rowEdge,
          )
          .sort(
            (a, b) =>
              Math.abs(a.box.left + a.box.width / 2 - x) -
              Math.abs(b.box.left + b.box.width / 2 - x),
          )[0]?.card.dataset.channelId;
      }
    } else if (
      event.key.length === 1 &&
      /[\p{L}\p{N}]/u.test(event.key) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      // M and D stay mute and dim unless a name is already being typed.
      !(!typing() && /^[mdMD]$/.test(event.key))
    ) {
      const text =
        (typing() ? typeahead.current.text : "") + event.key.toLowerCase();
      const now = Date.now();
      typeahead.current = { text, atMs: now };
      const visible = orderedChannelIds
        .map((id) => channels.find((channel) => channel.id === id))
        .filter((channel): channel is LiveStateChannel => Boolean(channel));
      next = (
        /^\d+$/.test(text)
          ? visible.find(({ number }) => String(number) === text)
          : visible.find(({ name }) => name.toLowerCase().startsWith(text))
      )?.id;
      event.preventDefault();
      event.stopPropagation();
    }
    if (next === undefined) return;
    event.preventDefault();
    focusCard(next);
  }

  /**
   * Selects a channel to monitor. A plain press replaces the selection with
   * just this one; a Shift-click (or Shift-Enter on a focused card) extends
   * it to every card between the last anchor and this one; a Ctrl/Cmd-click,
   * or any tap while `touchSelecting` is on, toggles this one card without
   * touching the rest. Several channels can play at once in device mode; the
   * shared host output feed still carries only one input, so it ignores
   * every modifier and behaves as a plain single choice.
   */
  function selectChannel(
    channel: LiveStateChannel,
    modifiers: { extend?: boolean; toggle?: boolean } = {},
  ) {
    if (hostMode) {
      if (channel.id === hostSelectedId) return;
      if (channel.input.index === null) {
        setActionError(
          `${channel.name} has no patched input, so the host output is unchanged.`,
        );
        return;
      }
      void changeHost({ channelId: channel.id, input: channel.input.index });
      return;
    }
    if (modifiers.extend && selectionAnchorId) {
      const from = orderedChannelIds.indexOf(selectionAnchorId);
      const to = orderedChannelIds.indexOf(channel.id);
      if (from !== -1 && to !== -1) {
        const [start, end] = from <= to ? [from, to] : [to, from];
        setSelectedIds(orderedChannelIds.slice(start, end + 1));
        return;
      }
    }
    if (modifiers.toggle || touchSelecting) {
      setSelectedIds((prev) =>
        prev.includes(channel.id)
          ? prev.filter((id) => id !== channel.id)
          : [...prev, channel.id],
      );
      setSelectionAnchorId(channel.id);
      return;
    }
    setSelectedIds([channel.id]);
    setSelectionAnchorId(channel.id);
    // A session already open for this channel switches in place; a new one
    // reports its own connecting/listening state as it comes up.
  }

  /** Stops everything playing on this device, or clears the joined feed's shared selection. */
  function clearSelection() {
    if (isA1) return;
    if (hostMode) {
      if (hostMonitor?.input == null) return;
      void changeHost({ channelId: null, input: null });
      return;
    }
    if (selectedIds.length === 0 && !touchSelecting) return;
    setSelectedIds([]);
    setSelectionAnchorId(null);
    setTouchSelecting(false);
  }

  /** A press on empty space between or beside the cards clears the selection. */
  function clearOnBlankPress(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.matches(".channel-main, .channel-group, .channel-grid")
    ) {
      clearSelection();
    }
  }

  const hostOutputInfo = hostDocument?.output ?? null;
  const hostPlayback: PlaybackUpdate =
    hostOutput.connection === "offline" || !hostDocument
      ? {
          status: "error",
          detail:
            "Lost contact with the audio node. The host output state is unknown.",
        }
      : !hostOutputInfo
        ? {
            status: "error",
            detail: "The audio node no longer has a host output device.",
          }
        : hostOutputInfo.status === "starting"
          ? { status: "connecting", detail: hostOutputInfo.detail }
          : hostOutputInfo.status === "error"
            ? { status: "error", detail: hostOutputInfo.detail }
            : !hostFeed || !hostMonitor
              ? {
                  status: "error",
                  detail: "This host output feed is not available.",
                }
              : hostMonitor.input === null
                ? {
                    status: "idle",
                    detail: "",
                  }
                : {
                    status: "listening",
                    detail: `Input ${hostMonitor.input + 1} · ${describeOutputChannels(hostFeed.outputChannels)}`,
                  };
  // Each chip reports the one shared stream, and only for channels in the mix.
  const playbackByChannel: Record<string, PlaybackUpdate> = {};
  if (playback) for (const id of mixedIds) playbackByChannel[id] = playback;
  const primaryPlayback: PlaybackUpdate =
    primarySelectedId !== null
      ? (playbackByChannel[primarySelectedId] ?? {
          status: "connecting",
          detail: `Connecting to input ${(selectedInput ?? 0) + 1}.`,
        })
      : { status: "idle", detail: "Select a patched channel to listen." };
  const shownPlayback = hostMode ? hostPlayback : primaryPlayback;
  /** Whether this card is one of the ones actually audible right now, not just selected. */
  function channelIsListening(channelId: string): boolean {
    if (shownMuted || !effectiveSelectedIds.includes(channelId)) return false;
    if (hostMode) return shownPlayback.status === "listening";
    return playbackByChannel[channelId]?.status === "listening";
  }
  const lastDestination = readLastDestination();
  const chooseDestination = (next: OutputDestination) => {
    saveLastDestination(next);
    setDestination(next);
    setOutputSheetOpen(false);
  };
  const outputPrompt =
    !isA1 && hostDocument?.output && chosenDestination === null;

  useEffect(() => {
    const sheetOpen =
      detailId !== null ||
      exceptionsOpen ||
      turnoverRoom !== null ||
      micCheckId !== null ||
      outputSheetOpen ||
      roomSheetOpen ||
      outputPrompt;
    selectAllAction.current = () => {
      if (isA1 || hostMode || sheetOpen || orderedChannelIds.length === 0) {
        return false;
      }
      setSelectedIds(orderedChannelIds);
      setSelectionAnchorId(orderedChannelIds[0] ?? null);
      return true;
    };
    escapeAction.current = () => {
      setDetailId(null);
      setExceptionsOpen(false);
      setTurnoverRoom(null);
      if (!sheetOpen) clearSelection();
    };
  });
  // What each feed is playing, for the destination prompt.
  const nowPlaying = Object.fromEntries(
    (hostDocument?.feeds ?? []).map(({ id, monitor }) => {
      const playing =
        channels.find(
          (channel) =>
            channel.id === monitor.channelId &&
            channel.input.index === monitor.input,
        ) ?? channels.find(({ input }) => input.index === monitor.input);
      return [
        id,
        monitor.input === null
          ? "Nothing selected."
          : `Now: ${playing?.name ?? `input ${monitor.input + 1}`}${monitor.muted ? ", muted" : ""}.`,
      ];
    }),
  );
  // Audio the node lost since capture started (CLAUDE.md: overruns are
  // metrics). The header carries the count; a notice marks a fresh loss.
  const dropouts =
    liveState && !offline && liveState.node.status === "ready"
      ? liveState.node.dropouts
      : undefined;
  const dropoutCount = dropouts ? dropouts.callbacks + dropouts.blocks : 0;
  const recentDropout =
    dropoutAtMs !== null && nowMs - dropoutAtMs < DROPOUT_NOTICE_MS;
  const summary = liveState?.summary;
  const alertLabel =
    !summary || offline
      ? "Alerts unavailable"
      : summary.outstanding > 0
        ? `${summary.outstanding} to acknowledge${summary.outstandingCritical ? ` · ${summary.outstandingCritical} critical` : ""}`
        : summary.active > 0
          ? `${summary.active} active · all seen`
          : "No active alerts";
  const alertCount =
    !summary || offline
      ? 0
      : summary.outstanding > 0
        ? summary.outstanding
        : summary.active;
  const showName = liveState?.show.name ?? "Show state unavailable";
  const nodeDevice = liveState?.node.device ?? null;

  return (
    <div className="live-app">
      <div className="sr-only" aria-live="assertive" role="status">
        {announcement}
      </div>
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
          <strong>{showName}</strong>
          <span>
            {nodeDevice
              ? `${nodeDevice.name}${nodeDevice.simulated ? " (simulated)" : ""} · ${nodeDevice.channelCount} inputs · ${nodeDevice.sampleRateHz / 1000} kHz`
              : liveState
                ? "Audio device not ready"
                : "Waiting for validated data"}
          </span>
        </div>
        {roomOptions.length > 2 && shownRoom ? (
          <button
            className="room-switch"
            type="button"
            aria-haspopup="dialog"
            aria-label={`Room: ${shownRoom.label}. Change room${otherRoomTone === "clear" ? "" : ". Another room needs attention"}`}
            onClick={() => setRoomSheetOpen(true)}
          >
            <span className="room-switch-text">
              <span>Room</span>
              <strong>{shownRoom.label}</strong>
            </span>
            {otherRoomTone !== "clear" ? (
              <i
                className={`room-dot tone-${otherRoomTone}`}
                aria-hidden="true"
              />
            ) : null}
            <svg
              viewBox="0 0 12 12"
              width="12"
              height="12"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 4.5 6 8l3.5-3.5" />
            </svg>
          </button>
        ) : null}
        <div
          className={`node-state node-${
            offline || !liveState
              ? "unknown"
              : liveState.node.status === "ready"
                ? "ready"
                : liveState.node.status === "unreachable" ||
                    liveState.node.status === "error"
                  ? "offline"
                  : "waiting"
          }${dropoutCount > 0 ? " has-dropouts" : ""}`}
        >
          <span>Node</span>
          <strong>
            {offline || !liveState
              ? "Unknown"
              : liveState.node.status === "ready"
                ? "Capturing"
                : liveState.node.status === "unreachable"
                  ? "Offline"
                  : liveState.node.status === "error"
                    ? "Failed"
                    : "Waiting"}
          </strong>
          {dropoutCount > 0 ? (
            <em>
              {dropoutCount} dropout{dropoutCount === 1 ? "" : "s"}
            </em>
          ) : null}
        </div>
        {nodeDevice?.simulated ? (
          <span className="simulated-badge">Simulated test signal</span>
        ) : null}
        <button
          className={`alert-bell ${
            !summary || offline
              ? "is-unknown"
              : summary.outstandingCritical > 0
                ? "is-critical"
                : summary.outstanding > 0
                  ? "is-caution"
                  : summary.active > 0
                    ? "is-seen"
                    : "is-clear"
          } ${summary && !offline && summary.outstandingCritical > 0 ? "is-pulsing" : ""}`}
          type="button"
          aria-label={alertLabel}
          title={alertLabel}
          onClick={() => setExceptionsOpen(true)}
          disabled={!liveState}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.268 21a2 2 0 0 0 3.464 0" />
            <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
          </svg>
          {alertCount > 0 ? (
            <span className="alert-bell-count">{alertCount}</span>
          ) : null}
        </button>
        <HeaderMenu
          items={[
            ...(!isA1 && hostDocument?.output
              ? [
                  {
                    key: "audio",
                    icon: "audio" as const,
                    label: "Audio output",
                    value: hostMode
                      ? (hostFeed?.name ?? "Host output")
                      : deviceMode
                        ? "This device"
                        : "Choose",
                    attention: !hostMode && !deviceMode,
                    onSelect: () => setOutputSheetOpen(true),
                  },
                ]
              : []),
            {
              key: "operator",
              icon: "user" as const,
              label: "You",
              value: operator.name ? operatorLabel(operator) : "Set your name",
              attention: !operator.name,
              onSelect: () => setOperatorOpen(true),
            },
            {
              key: "manager",
              icon: "manager" as const,
              label: "Manager",
              href: "/manager/",
            },
          ]}
        />
      </header>

      <ConnectionNotice
        connection={connection}
        state={liveState}
        device={device}
      />
      {liveState && !offline ? <NodeNotice state={liveState} /> : null}
      {recentDropout && dropoutAtMs !== null ? (
        <section className="snapshot-notice snapshot-waiting" role="status">
          <div>
            <strong>
              Audio capture dropped audio at{" "}
              {formatClock(new Date(dropoutAtMs).toISOString())}.
            </strong>
            <span>
              Listening and meters had a gap. {dropoutCount} since capture
              started; the node could not keep up with the device.
            </span>
          </div>
        </section>
      ) : null}
      {liveState && !offline ? <ReceiverNotice state={liveState} /> : null}
      {liveState?.node.status === "ready" && meterConnection !== "live" ? (
        <section className="snapshot-notice snapshot-waiting">
          <div>
            <strong>Meter stream reconnecting.</strong>
            <span>Card traces are hatched until meters return.</span>
          </div>
        </section>
      ) : null}
      {actionError ? (
        <section className="snapshot-notice snapshot-error" role="alert">
          <div>
            <strong>Not recorded.</strong>
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            className="line-button"
            onClick={() => setActionError(null)}
          >
            Dismiss
          </button>
        </section>
      ) : null}

      {!isA1 && !hostMode ? (
        <SelectionBar
          count={selectedIds.length}
          touchSelecting={touchSelecting}
          onDone={() => setTouchSelecting(false)}
          onClear={clearSelection}
          onReset={
            offline ? undefined : () => void resetChannelsAlerts(selectedIds)
          }
        />
      ) : null}

      {roomChannels.length ? (
        <div className="chip-bands">
          <FilterBar
            options={filterOptions}
            active={filter}
            onChoose={setFilter}
          />
          <div className="view-switch" role="group" aria-label="Layout">
            {(
              [
                ["cards", "Cards"],
                ["glance", "Glance"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={gridView === key}
                onClick={() => chooseGridView(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {runs.map((run) => (
        <SessionBar
          key={roomKeyOf(run.roomId)}
          session={run}
          roomName={
            rooms.length && (room === "all" || runs.length > 1)
              ? roomName(run.roomId)
              : null
          }
          turnover={turnovers.get(roomKeyOf(run.roomId)) ?? []}
          offline={offline}
          onOpen={() => {
            setSessionError(null);
            setTurnoverRoom(roomKeyOf(run.roomId));
          }}
        />
      ))}

      {!isA1 ? (
        <ReportBanner
          reports={reports.filter(
            (report) =>
              report.status === "open" && report.dismissedAtUtc === null,
          )}
          busy={reportBusy}
          onClaim={(report) => void reportAction(report, "claim")}
          onShow={(report) => setDetailId(report.channelId)}
          onDismiss={(report) => void reportAction(report, "dismiss")}
        />
      ) : null}

      <main
        ref={mainRef}
        className={`channel-main${gridView === "glance" ? " is-glance" : ""}`}
        onClick={clearOnBlankPress}
        onKeyDown={onGridKeyDown}
      >
        {channels.length ? (
          <>
            {isA1 ? (
              <div className="grid-heading">
                <h1>Mix confidence</h1>
                <p>
                  {visibleChannels.length} sources · press a channel to report
                  what you hear · expand opens detail
                  {criticalIds.size ? " · critical faults always shown" : ""}
                </p>
              </div>
            ) : (
              <>
                <h1 className="sr-only">
                  {room !== "all"
                    ? `${room === NO_ROOM ? "No room" : roomName(room)} · `
                    : ""}
                  {filterLabel}
                </h1>
                {criticalIds.size && filter !== "all" ? (
                  <p className="grid-note">Critical faults always shown</p>
                ) : null}
              </>
            )}
            {gridView === "glance" ? (
              <p className="strip-legend" aria-hidden="true">
                Status, left to right: RF · Audio · Battery
              </p>
            ) : null}
            {groups.map((group) => (
              <section
                className="channel-group"
                key={group.key}
                aria-label={group.title ?? undefined}
              >
                {group.title ? (
                  <h2 className="group-heading">
                    {group.title} <span>{group.channels.length}</span>
                  </h2>
                ) : null}
                <div className="channel-grid">
                  {group.channels.map((channel) => (
                    <ChannelCard
                      key={channel.id}
                      channel={channel}
                      density={gridView === "glance" ? "glance" : "card"}
                      tabbable={channel.id === gridFocusId}
                      alert={
                        isA1
                          ? null
                          : overlayAlert(activeAlerts, channel.id, nowMs)
                      }
                      report={cardReportState(reports, channel.id)}
                      actionLabel={isA1 ? "Report a fault on" : "Select"}
                      overlayExpiryMs={
                        liveState?.show.overlayExpiryMs ?? 300_000
                      }
                      nowMs={nowMs}
                      selected={
                        !isA1 && effectiveSelectedIds.includes(channel.id)
                      }
                      listening={!isA1 && channelIsListening(channel.id)}
                      imageRevision={liveState?.show.showfileRevision ?? 0}
                      meterStore={meterStore}
                      metersStale={
                        offline ||
                        !device ||
                        (liveState !== null &&
                          liveState.node.status !== "ready")
                      }
                      onAcknowledge={(alert, event) => {
                        void acknowledge(alert);
                        // The ringing card is the one to hear. Pressing it
                        // never takes a channel out of what is playing.
                        if (!effectiveSelectedIds.includes(channel.id)) {
                          selectChannel(channel, {
                            extend: event.shiftKey,
                            toggle: event.ctrlKey || event.metaKey,
                          });
                        }
                      }}
                      onSelect={(event) => {
                        setFocusId(channel.id);
                        if (isA1) {
                          setFiledReportId(null);
                          setReportError(null);
                          setReportChannelId(channel.id);
                        } else {
                          selectChannel(channel, {
                            extend: event.shiftKey,
                            toggle: event.ctrlKey || event.metaKey,
                          });
                        }
                      }}
                      onLongPressSelect={
                        isA1 || hostMode
                          ? undefined
                          : () => {
                              setTouchSelecting(true);
                              selectChannel(channel, { toggle: true });
                            }
                      }
                      onOpenDetail={() => setDetailId(channel.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        ) : liveState && !offline ? (
          <section className="empty-state">
            <h1>No show channels.</h1>
            <p>
              {liveState.show.name} has no channels yet. Open Manager to add
              channels and patch them to inputs.
            </p>
          </section>
        ) : null}
      </main>

      {isA1 ? (
        <A1Bar
          reports={reports.filter(isActiveReport)}
          awaitingAudioCheck={channels.filter(
            ({ check }) => check !== null && !check.stale && check.waiting > 0,
          )}
          busy={reportBusy}
          onAction={(report, action) => void reportAction(report, action)}
          onAudioVerdict={(channel, pass) => void audioVerdict(channel, pass)}
        />
      ) : (
        <Player
          channel={selectedChannel}
          onOpenDetail={
            gridView === "glance" && selectedChannel
              ? () => setDetailId(selectedChannel.id)
              : undefined
          }
          monitoredChannels={selectedChannels}
          playbackByChannel={playbackByChannel}
          onSelectPrimary={
            hostMode
              ? undefined
              : (id) =>
                  setSelectedIds((prev) =>
                    prev.includes(id)
                      ? [...prev.filter((x) => x !== id), id]
                      : prev,
                  )
          }
          onRemoveChannel={
            hostMode
              ? undefined
              : (id) => setSelectedIds((prev) => prev.filter((x) => x !== id))
          }
          muted={shownMuted}
          dimmed={shownDimmed}
          gainDb={shownGainDb}
          hostOutput={
            hostMode
              ? {
                  feedName: hostFeed?.name ?? "host output",
                  changedBy: hostMonitor?.changedBy ?? null,
                  changedAtUtc: hostMonitor?.changedAtUtc ?? null,
                }
              : null
          }
          playback={
            hostMode
              ? shownPlayback
              : chosenDestination === null
                ? {
                    status: "idle",
                    detail: "Choose where monitor audio plays.",
                  }
                : selectedChannel && selectedInput === null
                  ? {
                      status: "idle",
                      detail:
                        selectedChannel.input.index === null
                          ? `${selectedChannel.input.label}. There is nothing to listen to.`
                          : "The audio node is not ready, so listening is unavailable.",
                    }
                  : primaryPlayback
          }
          directListeningAvailable={
            hostMode
              ? hostOutputInfo !== null && hostOutput.connection !== "offline"
              : device !== null && deviceMode
          }
          meterStore={meterStore}
          alertMarks={
            selectedChannel
              ? [...activeAlerts, ...(alertHistory ?? [])].filter(
                  ({ channelId }) => channelId === selectedChannel.id,
                )
              : []
          }
          nowMs={nowMs}
          onExpandedChange={setTimelineOpen}
          onToggleMute={toggleMute}
          onToggleDim={toggleDim}
          onGainChange={(value) =>
            hostMode
              ? void changeHost({ gainDb: clampMonitorGainDb(value) })
              : setGainDb(clampMonitorGainDb(value))
          }
        />
      )}

      {detailChannel ? (
        <ChannelDetail
          channel={detailChannel}
          alerts={alertsForChannel(activeAlerts, detailChannel.id)}
          reports={reports.filter(
            (report) =>
              report.channelId === detailChannel.id && isActiveReport(report),
          )}
          role={operator.role}
          busy={reportBusy}
          onReportAction={(report, action) => void reportAction(report, action)}
          history={alertHistory}
          nowMs={nowMs}
          onAcknowledge={(alert) => void acknowledge(alert)}
          onResetChannel={
            offline
              ? undefined
              : () => void resetChannelAlerts(detailChannel.id)
          }
          onClose={() => setDetailId(null)}
          onRunCheck={() => {
            setMicCheckId(detailChannel.id);
            setDetailId(null);
          }}
        />
      ) : null}

      {roomSheetOpen && roomOptions.length ? (
        <RoomSheet
          options={roomOptions}
          current={room}
          onChoose={(next) => {
            chooseRoom(next);
            setRoomSheetOpen(false);
          }}
          onClose={() => setRoomSheetOpen(false)}
        />
      ) : null}

      {exceptionsOpen && liveState ? (
        <ExceptionsSheet
          state={{ ...liveState, alerts: [...activeAlerts].sort(byUrgency) }}
          history={alertHistory}
          nowMs={nowMs}
          onAcknowledge={(alert) => void acknowledge(alert)}
          onShowChannel={(channelId) => {
            setExceptionsOpen(false);
            setDetailId(channelId);
          }}
          onClearAll={
            offline
              ? undefined
              : (channelIds) => void resetChannelsAlerts(channelIds)
          }
          onReportAction={(report, action) => void reportAction(report, action)}
          busy={reportBusy}
          onClose={() => setExceptionsOpen(false)}
        />
      ) : null}

      {turnoverRun && !offline ? (
        <SessionSheet
          session={turnoverRun}
          roomName={rooms.length ? roomName(turnoverRun.roomId) : null}
          turnover={turnovers.get(roomKeyOf(turnoverRun.roomId)) ?? []}
          busy={sessionBusy}
          error={sessionError}
          onStart={(sessionId) =>
            void changeSession(sessionId, turnoverRun.roomId)
          }
          onShowChannel={(channelId) => {
            setTurnoverRoom(null);
            setDetailId(channelId);
          }}
          onClose={() => setTurnoverRoom(null)}
        />
      ) : null}

      {reportChannelId
        ? (() => {
            const reportChannel = channels.find(
              ({ id }) => id === reportChannelId,
            );
            if (!reportChannel) return null;
            return (
              <ReportSheet
                channel={reportChannel}
                report={reports.find(({ id }) => id === filedReportId) ?? null}
                nowMs={nowMs}
                busy={reportBusy}
                error={reportError}
                onSend={(faults, note) =>
                  void sendReport(reportChannel, faults, note)
                }
                onAction={(report, action) => void reportAction(report, action)}
                onClose={() => {
                  setReportChannelId(null);
                  setFiledReportId(null);
                }}
              />
            );
          })()
        : null}

      {operatorOpen ? (
        <OperatorSheet
          operator={operator}
          onSave={(next) => {
            saveOperator(next);
            setOperator(next);
            setOperatorOpen(false);
          }}
          onClose={() => setOperatorOpen(false)}
        />
      ) : null}

      {(outputPrompt || outputSheetOpen) && hostDocument?.output ? (
        <OutputSheet
          output={hostDocument.output}
          feeds={hostDocument.feeds}
          nowPlaying={nowPlaying}
          current={chosenDestination}
          suggested={lastDestination}
          onChoose={chooseDestination}
          onClose={outputPrompt ? undefined : () => setOutputSheetOpen(false)}
        />
      ) : null}

      {micCheckChannel ? (
        <MicCheck
          channel={micCheckChannel}
          onClose={() => setMicCheckId(null)}
        />
      ) : null}
    </div>
  );
}
