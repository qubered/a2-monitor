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
  webAudioPlaybackFactory,
  type PlaybackFactory,
  type PlaybackSession,
  type PlaybackUpdate,
} from "./audio-playback";
import { ChannelCard } from "./components/ChannelCard";
import { ChannelDetail } from "./components/ChannelDetail";
import { ExceptionsSheet } from "./components/ExceptionsSheet";
import { MicCheck } from "./components/MicCheck";
import { OperatorSheet } from "./components/OperatorSheet";
import { Player } from "./components/Player";
import { A1Bar, ReportBanner } from "./components/Reports";
import { ReportSheet } from "./components/ReportSheet";
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
  createEventSourceLiveState,
  type LiveStateConnection,
  type LiveStateSource,
} from "./live-state";
import { MeterStore } from "./meters";
import {
  loadOperator,
  operatorLabel,
  saveOperator,
  type Operator,
} from "./operator";
import { useAudioDevice } from "./useAudioDevice";
import { useLiveState } from "./useLiveState";
import { useNow } from "./useNow";

type Filter = "all" | "needs-someone" | "wireless" | "wired";

const filterLabels: Record<Filter, string> = {
  all: "All channels",
  "needs-someone": "Needs someone",
  wireless: "Wireless",
  wired: "Wired",
};

const ALERT_LOG_REFRESH_MS = 5_000;
/** Grid order holds this long after a touch, so a pinned card never slides under a finger. */
const ORDER_HOLD_MS = 2_500;
const defaultLiveStateSource = createEventSourceLiveState();

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

function needsSomeone(channel: LiveStateChannel, alerts: readonly LiveAlert[]) {
  return (
    alerts.some(({ channelId }) => channelId === channel.id) ||
    Object.values(channel.statuses).some(
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
  playbackFactory = webAudioPlaybackFactory,
  meterStore: providedMeterStore,
  fetchAlertLog = fetch,
}: {
  liveStateSource?: LiveStateSource;
  audioDeviceSource?: AudioDeviceSource;
  playbackFactory?: PlaybackFactory;
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
  const [filter, setFilter] = useState<Filter>("all");
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
  const [muted, setMuted] = useState(true);
  const [dimmed, setDimmed] = useState(false);
  const [gainDb, setGainDb] = useState(readMonitorGainDb);
  const [playback, setPlayback] = useState<PlaybackUpdate>({
    status: "idle",
    detail: "Select a patched channel to listen.",
  });
  const playbackSession = useRef<PlaybackSession | null>(null);
  const [heldOrder, setHeldOrder] = useState<string[] | null>(null);
  const releaseOrderTimer = useRef<number | undefined>(undefined);
  const outputState = useRef({ muted: true, dimmed: false, gainDb });
  const announcedCritical = useRef<Set<string> | null>(null);

  const offline = connection === "offline";
  const device =
    audioDeviceState.status === "ready" ? audioDeviceState.device : null;

  // Listening needs the node's capture to be ready; each time it becomes
  // ready again (a restart) the playback session is re-opened.
  const [captureEpoch, setCaptureEpoch] = useState(0);
  const deviceReady = device !== null;
  const wasReady = useRef(false);
  useEffect(() => {
    if (deviceReady && !wasReady.current) setCaptureEpoch((epoch) => epoch + 1);
    wasReady.current = deviceReady;
  }, [deviceReady]);

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

  const selectedChannel =
    channels.find((channel) => channel.id === selectedId) ?? null;
  const detailChannel =
    channels.find((channel) => channel.id === detailId) ?? null;
  const micCheckChannel =
    channels.find((channel) => channel.id === micCheckId) ?? null;
  const selectedInput = device ? (selectedChannel?.input.index ?? null) : null;
  const sampleRateHz = device?.device?.sampleRateHz;

  useEffect(() => {
    try {
      if (selectedId)
        window.localStorage.setItem("pulse-selected-channel", selectedId);
      else window.localStorage.removeItem("pulse-selected-channel");
    } catch {
      // Selection is per-device convenience only.
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedInput === null || sampleRateHz === undefined) return;
    const session = playbackFactory({
      channel: selectedInput,
      sampleRateHz,
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
  }, [captureEpoch, playbackFactory, sampleRateHz, selectedInput]);

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

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key.toLowerCase() === "m") setMuted((value) => !value);
      if (event.key.toLowerCase() === "d") setDimmed((value) => !value);
      if (event.key === "Escape") {
        setDetailId(null);
        setExceptionsOpen(false);
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

  const reports = useMemo(
    () => (liveState && !offline ? liveState.reports : []),
    [liveState, offline],
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

  const visibleChannels = useMemo(() => {
    const matches = (channel: LiveStateChannel) => {
      if (filter === "needs-someone")
        return needsSomeone(channel, activeAlerts);
      if (filter === "wireless" || filter === "wired")
        return channel.kind === filter;
      return true;
    };
    const pinned = channels.filter(({ id }) => criticalIds.has(id));
    const rest = channels.filter(
      (channel) => !criticalIds.has(channel.id) && matches(channel),
    );
    return [...pinned, ...rest];
  }, [activeAlerts, channels, criticalIds, filter]);

  // While someone is touching the grid, keep cards where they were and only
  // add or remove; the new pinned order lands once the hold is released.
  const orderedChannels = heldOrder
    ? [
        ...heldOrder.flatMap((id) => {
          const channel = visibleChannels.find((item) => item.id === id);
          return channel ? [channel] : [];
        }),
        ...visibleChannels.filter(({ id }) => !heldOrder.includes(id)),
      ]
    : visibleChannels;

  function holdGridOrder() {
    const current = orderedChannels.map(({ id }) => id);
    setHeldOrder((held) => held ?? current);
    window.clearTimeout(releaseOrderTimer.current);
    releaseOrderTimer.current = window.setTimeout(
      () => setHeldOrder(null),
      ORDER_HOLD_MS,
    );
  }
  useEffect(() => () => window.clearTimeout(releaseOrderTimer.current), []);

  const counts: Record<Filter, number> = {
    all: channels.length,
    "needs-someone": channels.filter((channel) =>
      needsSomeone(channel, activeAlerts),
    ).length,
    wireless: channels.filter(({ kind }) => kind === "wireless").length,
    wired: channels.filter(({ kind }) => kind === "wired").length,
  };

  function selectChannel(channel: LiveStateChannel) {
    setSelectedId(channel.id);
    if (channel.id === selectedId) return;
    setPlayback(
      channel.input.index === null
        ? {
            status: "idle",
            detail: `${channel.input.label}. There is nothing to listen to.`,
          }
        : device
          ? {
              status: "connecting",
              detail: `Connecting to input ${channel.input.index + 1}.`,
            }
          : {
              status: "idle",
              detail:
                "The audio node is not ready, so listening is unavailable.",
            },
    );
  }

  const listening =
    playback.status === "listening" && !muted && selectedChannel !== null;
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

      {channels.length ? (
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
        {channels.length ? (
          <>
            <div className="grid-heading">
              <h1>{isA1 ? "Mix confidence" : filterLabels[filter]}</h1>
              <p>
                {isA1
                  ? `${visibleChannels.length} sources · press a channel to report what you hear · expand opens detail`
                  : `${visibleChannels.length} sources · press a card to select · expand opens detail`}
                {criticalIds.size ? " · critical faults pinned first" : ""}
              </p>
            </div>
            <div className="channel-grid" onPointerDown={holdGridOrder}>
              {orderedChannels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  alert={
                    isA1 ? null : overlayAlert(activeAlerts, channel.id, nowMs)
                  }
                  report={cardReportState(reports, channel.id)}
                  actionLabel={isA1 ? "Report a fault on" : "Select"}
                  overlayExpiryMs={liveState?.show.overlayExpiryMs ?? 300_000}
                  nowMs={nowMs}
                  selected={!isA1 && selectedId === channel.id}
                  listening={!isA1 && listening && selectedId === channel.id}
                  imageRevision={liveState?.show.showfileRevision ?? 0}
                  meterStore={meterStore}
                  metersStale={
                    offline ||
                    !device ||
                    (liveState !== null && liveState.node.status !== "ready")
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
          muted={muted}
          dimmed={dimmed}
          gainDb={gainDb}
          playback={
            selectedChannel && selectedInput === null
              ? {
                  status: "idle",
                  detail:
                    selectedChannel.input.index === null
                      ? `${selectedChannel.input.label}. There is nothing to listen to.`
                      : "The audio node is not ready, so listening is unavailable.",
                }
              : playback
          }
          directListeningAvailable={device !== null}
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
          onToggleMute={() => setMuted((value) => !value)}
          onToggleDim={() => setDimmed((value) => !value)}
          onGainChange={(value) => setGainDb(clampMonitorGainDb(value))}
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

      {micCheckChannel ? (
        <MicCheck
          channel={micCheckChannel}
          onClose={() => setMicCheckId(null)}
        />
      ) : null}
    </div>
  );
}
