import type {
  LiveState,
  LiveStateChannel,
  LiveStateVerdict,
  Showfile,
  ShureTelemetry,
} from "@rvlt/pulse-protocol/http";
import type { AlertPolicy } from "./alert-policy.js";
import type { AlertCondition, AlertKind } from "./alerts.js";
import {
  checkVerdict,
  subjectOf,
  summarizeCheck,
  type StoredCheck,
} from "./checks.js";
import {
  NODE_UNREACHABLE_AFTER_MS,
  type NodeObservation,
} from "./node-observer.js";
import { sessionPerformer, type ResolvedSessions } from "./sessions.js";

type ShowChannel = Showfile["channels"][number];
type ReceiverConfig = Showfile["shureReceivers"][number];
type TelemetryReceiver = ShureTelemetry["receivers"][number];
type TelemetryChannel = TelemetryReceiver["channels"][number];

/**
 * Per-channel memory the evaluation needs between passes: how long an input
 * has been silent, whether the channel has been heard at all, and whether a
 * transmitter has been seen on the patched receiver channel since monitoring
 * started. Silence timing and transmitter memory reset when the patch changes;
 * `heard` lasts for the life of the backend process.
 */
export type ChannelTracker = {
  inputKey: string | null;
  observingSinceMs: number | null;
  lastObservedAtMs: number | null;
  lastSignalAtMs: number | null;
  /** Signal above the silence floor has been observed since the backend started; arms no-audio. */
  heard: boolean;
  receiverKey: string | null;
  transmitterSeen: boolean;
};

/** A gap in observation longer than this restarts silence timing instead of counting through it. */
const OBSERVATION_GAP_MS = 5_000;

export type Evaluation = {
  node: LiveState["node"];
  receivers: LiveState["receivers"];
  channels: LiveStateChannel[];
  conditions: AlertCondition[];
};

export type EvaluationInput = {
  showfile: Showfile;
  policy: AlertPolicy;
  observation: NodeObservation;
  trackers: Map<string, ChannelTracker>;
  nowMs: number;
  /** Guided mic checks by channel id; absent means no channel has been checked. */
  checks?: ReadonlyMap<string, StoredCheck>;
  /** The running and next session; absent or both null means the show is not being run by session. */
  sessions?: ResolvedSessions;
};

const DEFAULT_MONITOR = { battery: true, rf: true, audio: true };

/** How long each finding must hold before it becomes an alert, and be gone before it clears. */
export const ALERT_TIMING: Record<
  AlertKind,
  { raiseAfterMs: number; clearAfterMs: number }
> = {
  "battery-low": { raiseAfterMs: 5_000, clearAfterMs: 10_000 },
  "battery-critical": { raiseAfterMs: 5_000, clearAfterMs: 10_000 },
  "rf-low": { raiseAfterMs: 3_000, clearAfterMs: 5_000 },
  "rf-lost": { raiseAfterMs: 1_000, clearAfterMs: 3_000 },
  "link-quality-low": { raiseAfterMs: 3_000, clearAfterMs: 5_000 },
  interference: { raiseAfterMs: 0, clearAfterMs: 10_000 },
  "encryption-mismatch": { raiseAfterMs: 0, clearAfterMs: 5_000 },
  "tx-muted": { raiseAfterMs: 2_000, clearAfterMs: 2_000 },
  "no-audio": { raiseAfterMs: 0, clearAfterMs: 2_000 },
  // Intermittent clipping stays one alert instead of re-raising on every peak.
  clipping: { raiseAfterMs: 0, clearAfterMs: 60_000 },
  "receiver-offline": { raiseAfterMs: 10_000, clearAfterMs: 3_000 },
  "capture-error": { raiseAfterMs: 0, clearAfterMs: 3_000 },
  "node-unreachable": { raiseAfterMs: 5_000, clearAfterMs: 3_000 },
};

const LABELS: Record<AlertKind, string> = {
  "battery-low": "Low battery",
  "battery-critical": "Battery critical",
  "rf-low": "Low RF",
  "rf-lost": "RF lost",
  "link-quality-low": "Poor link",
  interference: "Interference",
  "encryption-mismatch": "Encryption mismatch",
  "tx-muted": "TX muted",
  "no-audio": "No audio",
  clipping: "Clipping",
  "receiver-offline": "Receiver offline",
  "capture-error": "Capture failed",
  "node-unreachable": "Node offline",
};

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** UI text uses a true minus sign for negative measurements. */
function signed(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : String(value);
}

function bounded(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function evaluateNode(
  observation: NodeObservation,
  nowMs: number,
): LiveState["node"] {
  if (!observation.configured) {
    return {
      status: "unreachable",
      detail: "No audio node is configured for this backend.",
      device: null,
      observedAtUtc: null,
    };
  }
  const { levels, levelsAtMs } = observation;
  if (
    !levels ||
    levelsAtMs === null ||
    nowMs - levelsAtMs > NODE_UNREACHABLE_AFTER_MS
  ) {
    return {
      status: "unreachable",
      detail:
        levelsAtMs === null
          ? "The audio node has not answered yet."
          : `The audio node has not answered for ${Math.round((nowMs - levelsAtMs) / 1000)} s.`,
      device: null,
      observedAtUtc: levelsAtMs === null ? null : iso(levelsAtMs),
    };
  }
  return {
    status: levels.capture.status,
    detail: levels.capture.detail,
    device: levels.capture.device,
    observedAtUtc: iso(levelsAtMs),
  };
}

function freshTelemetry(
  observation: NodeObservation,
  nowMs: number,
): ShureTelemetry | null {
  if (
    !observation.shure ||
    observation.shureAtMs === null ||
    nowMs - observation.shureAtMs > NODE_UNREACHABLE_AFTER_MS
  ) {
    return null;
  }
  return observation.shure;
}

function evaluateReceivers(
  configs: readonly ReceiverConfig[],
  telemetry: ShureTelemetry | null,
): LiveState["receivers"] {
  if (configs.length === 0) {
    return {
      status: "unconfigured",
      detail: "No Shure receivers are configured in Manager.",
      units: [],
    };
  }
  if (!telemetry) {
    return {
      status: "unavailable",
      detail:
        "Receiver telemetry is unavailable while the audio node is not answering.",
      units: configs.map(({ id, name }) => ({
        id,
        name,
        model: null,
        status: "stale",
        detail: "Telemetry unavailable.",
      })),
    };
  }
  const units = configs.map((config) => {
    const observed = telemetry.receivers.find(({ id }) => id === config.id);
    if (!observed) {
      return {
        id: config.id,
        name: config.name,
        model: null,
        status: "connecting" as const,
        detail: "Waiting for the audio node to open this receiver.",
      };
    }
    return {
      id: config.id,
      name: config.name,
      model: observed.model,
      status: observed.status,
      detail: observed.detail,
    };
  });
  const statuses = units.map(({ status }) => status);
  const allReady = statuses.every((status) => status === "ready");
  const allSame = statuses.every((status) => status === statuses[0]);
  return {
    status: allReady ? "ready" : allSame ? statuses[0]! : "degraded",
    detail: allReady
      ? "All configured Shure receivers are reporting."
      : "One or more configured Shure receivers are not current.",
    units,
  };
}

function trackerFor(
  trackers: Map<string, ChannelTracker>,
  channelId: string,
): ChannelTracker {
  let tracker = trackers.get(channelId);
  if (!tracker) {
    tracker = {
      inputKey: null,
      observingSinceMs: null,
      lastObservedAtMs: null,
      lastSignalAtMs: null,
      heard: false,
      receiverKey: null,
      transmitterSeen: false,
    };
    trackers.set(channelId, tracker);
  }
  return tracker;
}

type Built = { channel: LiveStateChannel; conditions: AlertCondition[] };

function buildChannel(
  showChannel: ShowChannel,
  position: number,
  input: EvaluationInput,
  node: LiveState["node"],
  telemetry: ShureTelemetry | null,
): Built {
  const { showfile, policy, observation, nowMs } = input;
  const id = showChannel.id ?? `position-${position + 1}`;
  const number = position + 1;
  const monitor = showChannel.monitor ?? DEFAULT_MONITOR;
  const tracker = trackerFor(input.trackers, id);
  const conditions: AlertCondition[] = [];
  const activeSession = input.sessions?.active ?? null;
  const nextSession = input.sessions?.next ?? null;
  const inSession = (session: typeof activeSession) =>
    session === null
      ? null
      : session.channels.some(({ channelId }) => channelId === id);
  const inUse = inSession(activeSession);
  const nextInUse = inSession(nextSession);
  // A channel the running session does not use is expected to be switched off,
  // muted and silent: none of those is a fault until a session needs it.
  const idle = inUse === false;
  const performer = sessionPerformer(showChannel, activeSession);
  const condition = (
    kind: AlertKind,
    severity: AlertCondition["severity"],
    dimension: AlertCondition["dimension"],
    detail: string,
    receiverId: string | null,
  ) => {
    conditions.push({
      key: `${id}:${kind}`,
      kind,
      dimension,
      severity,
      label: LABELS[kind],
      detail: bounded(detail),
      channelId: id,
      channelNumber: number,
      channelName: showChannel.name,
      receiverId,
      ...ALERT_TIMING[kind],
    });
  };

  // ---- Audio input -------------------------------------------------------
  const device = node.status === "ready" ? node.device : null;
  const patchedIndex = showChannel.inputIndex;
  const patchedDevice = showfile.device;
  const deviceMatches =
    device !== null &&
    patchedDevice !== null &&
    patchedDevice.name === device.name &&
    patchedDevice.channelCount === device.channelCount;
  const inputIndex =
    patchedIndex !== null && deviceMatches && patchedIndex < device.channelCount
      ? patchedIndex
      : null;
  const inputLabel =
    patchedIndex === null
      ? "Audio input not patched"
      : inputIndex !== null
        ? `${device!.name} · input ${inputIndex + 1}`
        : device === null
          ? `Input ${patchedIndex + 1} · audio node not ready`
          : `Input ${patchedIndex + 1} was patched on ${patchedDevice?.name ?? "another device"}, not ${device.name}`;
  const level =
    inputIndex === null
      ? undefined
      : observation.levels?.inputs.find(({ index }) => index === inputIndex);

  const inputKey = inputIndex === null ? null : `${device!.name}#${inputIndex}`;
  const peakDbfs = level?.peakDbfs ?? null;
  const rmsDbfs = level?.rmsDbfs ?? null;
  const clippedSamples = level?.clippedSamples ?? 0;
  const audioObserved = peakDbfs !== null && rmsDbfs !== null;
  if (tracker.inputKey !== inputKey) {
    tracker.inputKey = inputKey;
    tracker.observingSinceMs = null;
    tracker.lastObservedAtMs = null;
    tracker.lastSignalAtMs = null;
  }
  let silentForMs: number | null = null;
  if (audioObserved) {
    if (
      tracker.lastObservedAtMs !== null &&
      nowMs - tracker.lastObservedAtMs > OBSERVATION_GAP_MS
    ) {
      tracker.observingSinceMs = null;
      tracker.lastSignalAtMs = null;
    }
    tracker.lastObservedAtMs = nowMs;
    tracker.observingSinceMs ??= nowMs;
    if (peakDbfs > policy.silenceFloorDbfs) {
      tracker.lastSignalAtMs = nowMs;
      tracker.heard = true;
    }
    silentForMs = nowMs - (tracker.lastSignalAtMs ?? tracker.observingSinceMs);
  }
  const clipping = audioObserved && clippedSamples > 0;
  const audio: LiveStateChannel["audio"] = {
    availability: audioObserved
      ? "observed"
      : inputIndex !== null && node.status === "ready"
        ? "stale"
        : "unknown",
    peakDbfs: audioObserved ? peakDbfs : null,
    rmsDbfs: audioObserved ? rmsDbfs : null,
    silentForMs,
    clipping,
  };

  // ---- Receiver telemetry -----------------------------------------------
  const receiverConfig =
    showChannel.shureReceiverId == null
      ? undefined
      : showfile.shureReceivers.find(
          ({ id: receiverId }) => receiverId === showChannel.shureReceiverId,
        );
  const receiverChannelIndex = showChannel.shureChannelIndex ?? null;
  const wireless =
    receiverConfig !== undefined && receiverChannelIndex !== null;
  const telemetryReceiver = wireless
    ? telemetry?.receivers.find(({ id: rid }) => rid === receiverConfig.id)
    : undefined;
  const telemetryChannel: TelemetryChannel | undefined =
    telemetryReceiver?.channels.find(
      ({ index }) => index === receiverChannelIndex,
    );
  const telemetryAvailability: LiveStateChannel["rf"]["availability"] =
    telemetryChannel?.availability === "observed"
      ? "observed"
      : telemetryChannel?.availability === "stale"
        ? "stale"
        : "unknown";
  const receiverKey = wireless
    ? `${receiverConfig.id}#${receiverChannelIndex}`
    : null;
  if (tracker.receiverKey !== receiverKey) {
    tracker.receiverKey = receiverKey;
    tracker.transmitterSeen = false;
  }
  const transmitterPresent =
    telemetryAvailability !== "observed" || !telemetryChannel
      ? null
      : telemetryChannel.linkStatus === "active"
        ? true
        : telemetryChannel.linkStatus === "no-transmitter"
          ? false
          : null;
  if (transmitterPresent === true) tracker.transmitterSeen = true;

  const capabilities = telemetryReceiver?.capabilities;
  const linkQualityPercent =
    capabilities?.linkQuality &&
    telemetryChannel?.linkQualityRaw !== null &&
    telemetryChannel?.linkQualityRaw !== undefined &&
    telemetryChannel.linkQualityRaw <= 5
      ? Math.round((telemetryChannel.linkQualityRaw / 5) * 100)
      : null;
  const rf: LiveStateChannel["rf"] = {
    availability: wireless ? telemetryAvailability : "unknown",
    levelDbm: telemetryChannel?.rfLevelDbm ?? null,
    linkQualityPercent,
    activeAntenna:
      telemetryChannel?.antennas.find(({ active }) => active === true)?.label ??
      null,
    interference: telemetryChannel?.interference ?? "unavailable",
    transmitterPresent,
  };
  const battery: LiveStateChannel["battery"] = {
    availability: wireless ? telemetryAvailability : "unknown",
    percent: telemetryChannel?.batteryChargePercent ?? null,
    bars: telemetryChannel?.batteryBars ?? null,
    runtimeMinutes: telemetryChannel?.batteryRunTimeMinutes ?? null,
    type: telemetryChannel?.batteryType ?? null,
  };
  const transmitter: LiveStateChannel["transmitter"] = {
    type: telemetryChannel?.transmitter.type ?? null,
    name: telemetryChannel?.transmitter.name ?? null,
    muted: telemetryChannel?.transmitter.muted ?? null,
    observedAtUtc: telemetryChannel?.observedAtUtc ?? null,
  };
  const receiverLabel = wireless
    ? `${receiverConfig.name} channel ${receiverChannelIndex + 1}`
    : "";

  // ---- RF verdict and findings ------------------------------------------
  let rfVerdict: LiveStateVerdict = "not-applicable";
  if (wireless) {
    const observed = telemetryAvailability === "observed";
    const findings: LiveStateVerdict[] = [];
    if (observed && transmitterPresent === false && !idle) {
      if (tracker.transmitterSeen) {
        findings.push("fault");
        if (monitor.rf)
          condition(
            "rf-lost",
            "critical",
            "RF",
            `Transmitter not detected on ${receiverLabel}.`,
            receiverConfig.id,
          );
      } else {
        findings.push("caution");
      }
    }
    if (observed && transmitterPresent !== false) {
      if (rf.levelDbm !== null && rf.levelDbm <= policy.rfCautionDbm) {
        const critical = rf.levelDbm <= policy.rfCriticalDbm;
        findings.push(critical ? "fault" : "caution");
        if (monitor.rf)
          condition(
            "rf-low",
            critical ? "critical" : "caution",
            "RF",
            `RF ${signed(rf.levelDbm)} dBm on ${receiverLabel}. ${critical ? `Critical at ${signed(policy.rfCriticalDbm)}` : `Caution at ${signed(policy.rfCautionDbm)}`} dBm.`,
            receiverConfig.id,
          );
      }
      if (
        linkQualityPercent !== null &&
        linkQualityPercent <= policy.qualityCautionPercent
      ) {
        const critical = linkQualityPercent <= policy.qualityCriticalPercent;
        findings.push(critical ? "fault" : "caution");
        if (monitor.rf)
          condition(
            "link-quality-low",
            critical ? "critical" : "caution",
            "RF",
            `Link quality ${linkQualityPercent} % on ${receiverLabel}${rf.levelDbm === null ? "" : `; RF level ${signed(rf.levelDbm)} dBm`}.`,
            receiverConfig.id,
          );
      }
      if (rf.interference === "detected") {
        findings.push("caution");
        if (monitor.rf)
          condition(
            "interference",
            "caution",
            "RF",
            `Interference reported on ${receiverLabel}${rf.levelDbm === null ? "" : `; RF level ${signed(rf.levelDbm)} dBm`}.`,
            receiverConfig.id,
          );
      }
      if (
        telemetryChannel?.warnings.some((warning) =>
          warning.toLowerCase().includes("encryption"),
        )
      ) {
        findings.push("caution");
        if (monitor.rf)
          condition(
            "encryption-mismatch",
            "caution",
            "RF",
            `Encryption mismatch reported on ${receiverLabel}.`,
            receiverConfig.id,
          );
      }
    }
    rfVerdict = !monitor.rf
      ? "unknown"
      : idle && observed && transmitterPresent === false
        ? "not-applicable"
        : !observed || (transmitterPresent === null && rf.levelDbm === null)
          ? "unknown"
          : findings.includes("fault")
            ? "fault"
            : findings.includes("caution")
              ? "caution"
              : "good";
  }

  // ---- Battery verdict and findings -------------------------------------
  let batteryVerdict: LiveStateVerdict = "not-applicable";
  if (wireless) {
    const observed =
      telemetryAvailability === "observed" && transmitterPresent !== false;
    const percent = battery.percent;
    const bars = battery.bars;
    let severity: "critical" | "caution" | null = null;
    let measured = true;
    if (percent !== null) {
      if (percent <= policy.batteryCriticalPercent) severity = "critical";
      else if (percent <= policy.batteryCautionPercent) severity = "caution";
    } else if (bars !== null) {
      if (bars === 0) severity = "critical";
      else if (bars === 1) severity = "caution";
    } else {
      measured = false;
    }
    batteryVerdict =
      !monitor.battery || !observed || !measured
        ? "unknown"
        : severity === "critical"
          ? "fault"
          : severity === "caution"
            ? "caution"
            : "good";
    if (monitor.battery && observed && severity) {
      const reading = percent !== null ? `${percent} %` : `${bars} of 5 bars`;
      const limit =
        percent !== null
          ? ` ${severity === "critical" ? "Critical" : "Caution"} at ${severity === "critical" ? policy.batteryCriticalPercent : policy.batteryCautionPercent} %.`
          : "";
      const runtime =
        battery.runtimeMinutes === null
          ? ""
          : ` About ${battery.runtimeMinutes} min remaining.`;
      condition(
        severity === "critical" ? "battery-critical" : "battery-low",
        severity,
        "Battery",
        `Battery ${reading} on ${receiverLabel}.${limit}${runtime}`,
        receiverConfig.id,
      );
    }
  }

  // ---- Audio verdict and findings ---------------------------------------
  const txMuted =
    telemetryAvailability === "observed" && transmitter.muted === true;
  if (txMuted && monitor.audio && !idle)
    condition(
      "tx-muted",
      "caution",
      "Audio",
      `Transmitter mute is on (${receiverLabel}).`,
      receiverConfig?.id ?? null,
    );
  const silenceLimitMs = policy.silenceAfterSeconds * 1000;
  // A channel that has never been heard this session is not yet in use, so its
  // silence is not a fault: no-audio arms on the first signal above the floor.
  const silentTooLong =
    !idle &&
    tracker.heard &&
    silentForMs !== null &&
    silentForMs >= silenceLimitMs;
  if (monitor.audio && silentTooLong)
    condition(
      "no-audio",
      "critical",
      "Audio",
      `No audio above ${signed(policy.silenceFloorDbfs)} dBFS for ${Math.floor(silentForMs! / 1000)} s on ${inputLabel}.`,
      receiverConfig?.id ?? null,
    );
  if (monitor.audio && policy.clipAlerts && clipping)
    condition(
      "clipping",
      "caution",
      "Audio",
      `${clippedSamples} clipped samples in the last second on ${inputLabel}.`,
      receiverConfig?.id ?? null,
    );
  const signalPresent = peakDbfs !== null && peakDbfs > policy.silenceFloorDbfs;
  const audioVerdict: LiveStateVerdict = !audioObserved
    ? "unknown"
    : monitor.audio && silentTooLong
      ? "fault"
      : monitor.audio && ((policy.clipAlerts && clipping) || (txMuted && !idle))
        ? "caution"
        : signalPresent
          ? "good"
          : idle
            ? "not-applicable"
            : monitor.audio && tracker.heard
              ? "good"
              : "unknown";

  const receiverStatus: NonNullable<LiveStateChannel["receiver"]>["status"] =
    telemetryReceiver?.status ?? "missing";
  // A presenter change between sessions makes an earlier check stale.
  const check = summarizeCheck(
    input.checks?.get(id),
    subjectOf({ ...showChannel, performer }),
  );

  return {
    channel: {
      id,
      number,
      name: showChannel.name,
      performer,
      kind: wireless ? "wireless" : "wired",
      micType: showChannel.micType ?? null,
      hasImage: Boolean(showChannel.imageUrl),
      input: { index: inputIndex, label: bounded(inputLabel, 160) },
      receiver: wireless
        ? {
            id: receiverConfig.id,
            name: receiverConfig.name,
            model: telemetryReceiver?.model ?? null,
            channelIndex: receiverChannelIndex,
            status: receiverStatus,
            frequencyRaw: telemetryChannel?.frequencyRaw ?? null,
            groupChannelRaw: telemetryChannel?.groupChannelRaw ?? null,
          }
        : null,
      monitor,
      statuses: {
        rf: rfVerdict,
        audio: audioVerdict,
        battery: batteryVerdict,
        check: checkVerdict(check),
      },
      audio,
      rf,
      battery,
      transmitter,
      check,
      session:
        activeSession === null && nextSession === null
          ? null
          : {
              inUse,
              nextInUse,
              nextPresenter: nextInUse
                ? sessionPerformer(showChannel, nextSession)
                : null,
            },
    },
    conditions,
  };
}

function systemConditions(
  input: EvaluationInput,
  node: LiveState["node"],
  receivers: LiveState["receivers"],
): AlertCondition[] {
  const conditions: AlertCondition[] = [];
  const system = (
    key: string,
    kind: AlertKind,
    severity: AlertCondition["severity"],
    detail: string,
    receiverId: string | null = null,
  ) =>
    conditions.push({
      key,
      kind,
      dimension: "System",
      severity,
      label: LABELS[kind],
      detail: bounded(detail),
      channelId: null,
      channelNumber: null,
      channelName: null,
      receiverId,
      ...ALERT_TIMING[kind],
    });

  if (input.observation.configured && node.status === "unreachable") {
    system(
      "system:node-unreachable",
      "node-unreachable",
      "critical",
      node.detail,
    );
  }
  if (node.status === "error") {
    system("system:capture-error", "capture-error", "critical", node.detail);
  }
  if (node.status !== "unreachable") {
    for (const unit of receivers.units) {
      if (unit.status === "stale" || unit.status === "error") {
        const config = input.showfile.shureReceivers.find(
          ({ id }) => id === unit.id,
        );
        system(
          `receiver:${unit.id}:receiver-offline`,
          "receiver-offline",
          "caution",
          `${unit.name}${config ? ` (${config.host})` : ""}: ${unit.detail}`,
          unit.id,
        );
      }
    }
  }
  return conditions;
}

/** One evaluation pass over the active showfile and the latest node observation. */
export function evaluate(input: EvaluationInput): Evaluation {
  const node = evaluateNode(input.observation, input.nowMs);
  const telemetry =
    node.status === "unreachable"
      ? null
      : freshTelemetry(input.observation, input.nowMs);
  const receivers = evaluateReceivers(input.showfile.shureReceivers, telemetry);
  const built = input.showfile.channels.map((channel, position) =>
    buildChannel(channel, position, input, node, telemetry),
  );
  const liveIds = new Set(built.map(({ channel }) => channel.id));
  for (const id of [...input.trackers.keys()]) {
    if (!liveIds.has(id)) input.trackers.delete(id);
  }
  return {
    node,
    receivers,
    channels: built.map(({ channel }) => channel),
    conditions: [
      ...systemConditions(input, node, receivers),
      ...built.flatMap(({ conditions }) => conditions),
    ],
  };
}
