import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
} from "./audio-playback";
import { ChannelCard } from "./components/ChannelCard";
import { ChannelDetail } from "./components/ChannelDetail";
import { ExceptionsSheet } from "./components/ExceptionsSheet";
import { MicCheck } from "./components/MicCheck";
import { OperatorSheet } from "./components/OperatorSheet";
import { OutputSheet } from "./components/OutputSheet";
import { Player } from "./components/Player";
import { A1Bar, ReportBanner } from "./components/Reports";
import { ReportSheet } from "./components/ReportSheet";
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
import { effectiveRoom, groupChannels, inRoom, type RoomChoice } from "./rooms";
import {
  NO_ROOM,
  nextSessionMinutes,
  roomKeyOf,
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

type Filter = "all" | "session" | "needs-someone" | "wireless" | "wired";

const filterLabels: Record<Filter, string> = {
  all: "All channels",
  session: "This session",
  "needs-someone": "Needs someone",
  wireless: "Wireless",
  wired: "Wired",
};

const ALERT_LOG_REFRESH_MS = 5_000;
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

const DISMISSED_KEY = "pulse-dismissed-reports";

function readDismissed(): Set<string> {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(DISMISSED_KEY) ?? "[]",
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
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem("pulse-selected-channel");
    } catch {
      return null;
    }
  });
  const [detailId, setDetailId] = useState<string | null>(null);
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
  const [dismissedReports, setDismissedReports] =
    useState<Set<string>>(readDismissed);
  const [announcement, setAnnouncement] = useState("");
  const [muted, setMuted] = useState(false);
  const [dimmed, setDimmed] = useState(false);
  const [gainDb, setGainDb] = useState(readMonitorGainDb);
  const [playback, setPlayback] = useState<PlaybackUpdate>({
    status: "idle",
    detail: "Select a patched channel to listen.",
  });
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

  // On host output the selection is the shared one, so every client shows it.
  const hostSelectedId = hostMonitor
    ? (channels.find(
        ({ id, input }) =>
          id === hostMonitor.channelId && input.index === hostMonitor.input,
      )?.id ??
      channels.find(({ input }) => input.index === hostMonitor.input)?.id ??
      null)
    : null;
  const effectiveSelectedId = hostMode ? hostSelectedId : selectedId;
  const selectedChannel =
    channels.find((channel) => channel.id === effectiveSelectedId) ?? null;
  const detailChannel =
    channels.find((channel) => channel.id === detailId) ?? null;
  const micCheckChannel =
    channels.find((channel) => channel.id === micCheckId) ?? null;
  const selectedInput = device ? (selectedChannel?.input.index ?? null) : null;
  const selectedTrimDb = selectedChannel?.trimDb ?? 0;
  const selectedTrimRef = useRef(selectedTrimDb);
  useEffect(() => {
    selectedTrimRef.current = selectedTrimDb;
    playbackSession.current?.setTrimDb(selectedTrimDb);
  }, [selectedTrimDb]);

  useEffect(() => {
    try {
      if (selectedId)
        window.localStorage.setItem("pulse-selected-channel", selectedId);
      else window.localStorage.removeItem("pulse-selected-channel");
    } catch {
      // Selection is per-device convenience only.
    }
  }, [selectedId]);

  // One WebRTC session lives while any patched input is selected and the node
  // is ready; changing input moves that session server-side instead of
  // renegotiating, and the session itself reconnects after a capture restart.
  const hasSelectedInput = selectedInput !== null;
  const selectedInputRef = useRef(selectedInput);
  useEffect(() => {
    // Declared before the session effect so a new session starts on the current input.
    selectedInputRef.current = selectedInput;
  }, [selectedInput]);
  useEffect(() => {
    const initialInput = selectedInputRef.current;
    if (initialInput === null || !deviceMode) return;
    const session = playbackFactory({
      channel: initialInput,
      onUpdate: setPlayback,
    });
    session.setGainDb(outputState.current.gainDb);
    session.setTrimDb(selectedTrimRef.current);
    session.setDimmed(outputState.current.dimmed);
    void session.setMuted(outputState.current.muted);
    playbackSession.current = session;
    return () => {
      if (playbackSession.current === session) playbackSession.current = null;
      session.close();
    };
  }, [deviceMode, hasSelectedInput, playbackFactory]);

  useEffect(() => {
    if (selectedInput !== null)
      playbackSession.current?.setChannel(selectedInput);
  }, [selectedInput]);

  useEffect(() => {
    outputState.current = { muted, dimmed, gainDb };
    try {
      window.localStorage.setItem("pulse-gain-db", String(gainDb));
    } catch {
      // Gain still applies for this session.
    }
    playbackSession.current?.setGainDb(gainDb);
    playbackSession.current?.setDimmed(dimmed);
    void playbackSession.current?.setMuted(muted);
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
      if (event.key.toLowerCase() === "m") keyboardToggles.current.toggleMute();
      if (event.key.toLowerCase() === "d") keyboardToggles.current.toggleDim();
      if (event.key === "Escape") {
        setDetailId(null);
        setExceptionsOpen(false);
        setTurnoverRoom(null);
      }
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
          liveState.channels.filter(
            (channel) => roomKeyOf(channel.roomId) === key,
          ),
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

  function dismissReport(report: FaultReport) {
    setDismissedReports((current) => {
      const next = new Set(current).add(report.id);
      try {
        window.localStorage.setItem(
          DISMISSED_KEY,
          JSON.stringify([...next].slice(-100)),
        );
      } catch {
        // Dismissal is a per-device convenience.
      }
      return next;
    });
  }

  // "This session" means nothing once the run of show ends; fall back to all.
  const filter: Filter =
    chosenFilter === "session" && !sessionRunning ? "all" : chosenFilter;

  const visibleChannels = useMemo(() => {
    const matches = (channel: LiveStateChannel) => {
      if (filter === "session") return channel.session?.inUse !== false;
      if (filter === "needs-someone")
        return needsSomeone(channel, activeAlerts);
      if (filter === "wireless" || filter === "wired")
        return channel.kind === filter;
      return true;
    };
    // Showfile order, always: a critical channel stays visible whatever the
    // filter, but in its own place, so no card ever moves.
    // Another room's critical fault counts in the header and the exceptions
    // sheet; this device's grid stays on its own room.
    return roomChannels.filter(
      (channel) => criticalIds.has(channel.id) || matches(channel),
    );
  }, [activeAlerts, roomChannels, criticalIds, filter]);
  const groups = useMemo(
    () => groupChannels(visibleChannels, rooms, room),
    [visibleChannels, rooms, room],
  );

  const counts: Record<Filter, number> = {
    all: roomChannels.length,
    session: roomChannels.filter(({ session }) => session?.inUse !== false)
      .length,
    "needs-someone": roomChannels.filter((channel) =>
      needsSomeone(channel, activeAlerts),
    ).length,
    wireless: roomChannels.filter(({ kind }) => kind === "wireless").length,
    wired: roomChannels.filter(({ kind }) => kind === "wired").length,
  };

  function selectChannel(channel: LiveStateChannel) {
    if (hostMode) {
      if (channel.id === effectiveSelectedId) return;
      if (channel.input.index === null) {
        setActionError(
          `${channel.name} has no patched input, so the host output is unchanged.`,
        );
        return;
      }
      void changeHost({ channelId: channel.id, input: channel.input.index });
      return;
    }
    setSelectedId(channel.id);
    if (channel.id === selectedId) return;
    if (channel.input.index === null) {
      setPlayback({
        status: "idle",
        detail: `${channel.input.label}. There is nothing to listen to.`,
      });
    } else if (!device) {
      setPlayback({
        status: "idle",
        detail: "The audio node is not ready, so listening is unavailable.",
      });
    } else if (!playbackSession.current) {
      setPlayback({
        status: "connecting",
        detail: `Connecting to input ${channel.input.index + 1}.`,
      });
    }
    // With a session open the switch happens in place; the session reports
    // when the new input is flowing, so a source change never shows a reconnect.
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
                    detail: `Nothing selected in ${hostFeed.name}. Press a card to play it on ${describeOutputChannels(hostFeed.outputChannels)} of ${hostOutputInfo.deviceName}.`,
                  }
                : {
                    status: "listening",
                    detail: `${hostFeed.name}: input ${hostMonitor.input + 1} on ${describeOutputChannels(hostFeed.outputChannels)} of ${hostOutputInfo.deviceName}.`,
                  };
  const shownPlayback = hostMode ? hostPlayback : playback;
  const listening =
    shownPlayback.status === "listening" &&
    !shownMuted &&
    selectedChannel !== null;
  const lastDestination = readLastDestination();
  const chooseDestination = (next: OutputDestination) => {
    saveLastDestination(next);
    setDestination(next);
    setOutputSheetOpen(false);
  };
  const outputPrompt =
    !isA1 && hostDocument?.output && chosenDestination === null;
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
  const summary = liveState?.summary;
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
          }`}
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
        </div>
        {nodeDevice?.simulated ? (
          <span className="simulated-badge">Simulated test signal</span>
        ) : null}
        <button
          className={`alert-count ${
            !summary || offline
              ? "is-unknown"
              : summary.outstandingCritical > 0
                ? "is-critical"
                : summary.outstanding > 0
                  ? "is-caution"
                  : "is-clear"
          }`}
          type="button"
          onClick={() => setExceptionsOpen(true)}
          disabled={!liveState}
        >
          {!summary || offline
            ? "Alerts unavailable"
            : summary.outstanding > 0
              ? `${summary.outstanding} to acknowledge${summary.outstandingCritical ? ` · ${summary.outstandingCritical} critical` : ""}`
              : summary.active > 0
                ? `${summary.active} active · all seen`
                : "No active alerts"}
        </button>
        {!isA1 && hostDocument?.output ? (
          <button
            className={`operator-chip output-chip ${hostMode ? "is-host" : ""}`}
            type="button"
            onClick={() => setOutputSheetOpen(true)}
          >
            {hostMode
              ? `Audio: ${hostFeed?.name ?? "host output"}`
              : deviceMode
                ? "Audio: this device"
                : "Audio: choose"}
          </button>
        ) : null}
        <button
          className="operator-chip"
          type="button"
          onClick={() => setOperatorOpen(true)}
        >
          {operator.name ? operatorLabel(operator) : "Set your name"}
        </button>
        <a className="manager-link" href="/manager/">
          Manager
        </a>
      </header>

      <ConnectionNotice
        connection={connection}
        state={liveState}
        device={device}
      />
      {liveState && !offline ? <NodeNotice state={liveState} /> : null}
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

      {rooms.length ? (
        <nav className="room-bar" aria-label="Rooms">
          <span className="filter-label">Room</span>
          {[
            { key: "all", label: "All rooms", count: channels.length },
            ...rooms.map(({ id, name }) => ({
              key: id,
              label: name,
              count: channels.filter(({ roomId }) => roomId === id).length,
            })),
            ...(channels.some(({ roomId }) => !roomId)
              ? [
                  {
                    key: NO_ROOM,
                    label: "No room",
                    count: channels.filter(({ roomId }) => !roomId).length,
                  },
                ]
              : []),
          ].map(({ key, label, count }) => (
            <button
              type="button"
              className="filter-button"
              aria-pressed={room === key}
              onClick={() => chooseRoom(key)}
              key={key}
            >
              {label} <span>{count}</span>
            </button>
          ))}
        </nav>
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
              report.status === "open" && !dismissedReports.has(report.id),
          )}
          busy={reportBusy}
          onClaim={(report) => void reportAction(report, "claim")}
          onShow={(report) => setDetailId(report.channelId)}
          onDismiss={dismissReport}
        />
      ) : null}

      {roomChannels.length ? (
        <nav className="filters" aria-label="Channel filters">
          <span className="filter-label">Showing</span>
          {(Object.keys(filterLabels) as Filter[])
            .filter(
              (filterOption) => filterOption !== "session" || sessionRunning,
            )
            .map((filterOption) => (
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
        {channels.length ? (
          <>
            <div className="grid-heading">
              <h1>
                {room !== "all"
                  ? `${room === NO_ROOM ? "No room" : roomName(room)} · `
                  : ""}
                {isA1 ? "Mix confidence" : filterLabels[filter]}
              </h1>
              <p>
                {isA1
                  ? `${visibleChannels.length} sources · press a channel to report what you hear · expand opens detail`
                  : `${visibleChannels.length} sources · press a card to select · expand opens detail`}
                {criticalIds.size ? " · critical faults always shown" : ""}
              </p>
            </div>
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
                      selected={!isA1 && effectiveSelectedId === channel.id}
                      listening={
                        !isA1 && listening && effectiveSelectedId === channel.id
                      }
                      imageRevision={liveState?.show.showfileRevision ?? 0}
                      meterStore={meterStore}
                      metersStale={
                        offline ||
                        !device ||
                        (liveState !== null &&
                          liveState.node.status !== "ready")
                      }
                      onAcknowledge={(alert) => void acknowledge(alert)}
                      onSelect={() => {
                        if (isA1) {
                          setFiledReportId(null);
                          setReportError(null);
                          setReportChannelId(channel.id);
                        } else {
                          selectChannel(channel);
                        }
                      }}
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
                  : playback
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
