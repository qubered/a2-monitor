import type {
  LiveChannel,
  Showfile,
  ShureTelemetry,
} from "@rvlt/pulse-protocol/http";

export type AudioDeviceState = {
  schemaVersion: 0;
  status:
    | "ready"
    | "configuration-required"
    | "starting"
    | "waiting"
    | "offline"
    | "error";
  detail: string;
  device?: {
    name: string;
    sampleRateHz: number;
    channelCount: number;
  };
  channels?: Array<{ index: number; label: string }>;
};

export interface AudioDeviceSource {
  load(signal: AbortSignal): Promise<AudioDeviceState>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAudioDeviceState(value: unknown): AudioDeviceState {
  if (!isRecord(value))
    throw new Error("Audio device response is not an object.");
  const allowed = new Set([
    "schemaVersion",
    "status",
    "detail",
    "device",
    "channels",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("Audio device response contains unsupported fields.");
  }
  if (value.schemaVersion !== 0)
    throw new Error("Audio device schema version is unsupported.");
  if (
    ![
      "ready",
      "configuration-required",
      "starting",
      "waiting",
      "offline",
      "error",
    ].includes(String(value.status))
  ) {
    throw new Error("Audio device status is invalid.");
  }
  if (typeof value.detail !== "string")
    throw new Error("Audio device detail is missing.");

  let device: AudioDeviceState["device"];
  if (value.device !== undefined) {
    if (!isRecord(value.device))
      throw new Error("Audio device identity is invalid.");
    const { name, sampleRateHz, channelCount } = value.device;
    if (
      Object.keys(value.device).some(
        (key) => !["name", "sampleRateHz", "channelCount"].includes(key),
      ) ||
      typeof name !== "string" ||
      typeof sampleRateHz !== "number" ||
      !Number.isFinite(sampleRateHz) ||
      sampleRateHz <= 0 ||
      !Number.isInteger(channelCount) ||
      (channelCount as number) < 1
    ) {
      throw new Error("Audio device identity is invalid.");
    }
    device = { name, sampleRateHz, channelCount: channelCount as number };
  }

  let channels: AudioDeviceState["channels"];
  if (value.channels !== undefined) {
    if (!Array.isArray(value.channels))
      throw new Error("Audio device channels are invalid.");
    channels = value.channels.map((channel) => {
      if (
        !isRecord(channel) ||
        Object.keys(channel).some((key) => !["index", "label"].includes(key)) ||
        !Number.isInteger(channel.index) ||
        (channel.index as number) < 0 ||
        typeof channel.label !== "string"
      ) {
        throw new Error("Audio device channel is invalid.");
      }
      return { index: channel.index as number, label: channel.label };
    });
  }

  const result: AudioDeviceState = {
    schemaVersion: 0,
    status: value.status as AudioDeviceState["status"],
    detail: value.detail,
  };
  if (device) result.device = device;
  if (channels) result.channels = channels;
  if (result.status === "ready" && (!device || !channels)) {
    throw new Error("Ready audio device response is incomplete.");
  }
  if (device && channels) {
    const indexes = new Set(channels.map(({ index }) => index));
    if (
      indexes.size !== channels.length ||
      channels.some(({ index }) => index >= device.channelCount)
    ) {
      throw new Error("Audio device channel indexes are invalid.");
    }
  }
  return result;
}

export function createHttpAudioDeviceSource(
  fetchDevice: typeof fetch = fetch,
): AudioDeviceSource {
  return {
    async load(signal) {
      const response = await fetchDevice("/audio/v0/device", { signal });
      if (!response.ok)
        throw new Error(
          `Audio device request failed with HTTP ${response.status}.`,
        );
      return parseAudioDeviceState(await response.json());
    },
  };
}

export function synthesizeDeviceChannels(
  state: AudioDeviceState,
  showfile?: Showfile | null,
  shure?: ShureTelemetry | null,
): LiveChannel[] {
  if (state.status !== "ready" || !state.device || !state.channels) return [];
  const hasExactShowfile =
    showfile?.device?.name === state.device.name &&
    showfile.device.channelCount === state.device.channelCount &&
    showfile.revision > 0;
  const configured = hasExactShowfile
    ? showfile.channels
    : state.channels.map(({ index, label }) => ({
        inputIndex: index,
        name: label || `Input ${index + 1}`,
        shureReceiverId: null,
        shureChannelIndex: null,
      }));
  return configured.map((configuredChannel, position) => {
    const inputIndex = configuredChannel.inputIndex;
    const receiver =
      configuredChannel.shureReceiverId == null
        ? undefined
        : shure?.receivers.find(
            ({ id }) => id === configuredChannel.shureReceiverId,
          );
    const receiverChannel =
      configuredChannel.shureChannelIndex === undefined ||
      configuredChannel.shureChannelIndex === null
        ? undefined
        : receiver?.channels.find(
            ({ index }) => index === configuredChannel.shureChannelIndex,
          );
    const observed = receiverChannel?.availability === "observed";
    const batteryValue =
      receiverChannel?.batteryChargePercent ?? receiverChannel?.batteryBars;
    const batteryStatus = !observed
      ? "unknown"
      : batteryValue === null || batteryValue === undefined
        ? "unknown"
        : receiverChannel?.batteryChargePercent !== null
          ? batteryValue <= 10
            ? "fault"
            : batteryValue <= 20
              ? "caution"
              : "good"
          : batteryValue === 0
            ? "fault"
            : batteryValue === 1
              ? "caution"
              : "good";
    const batteryRemaining = observed
      ? [
          receiverChannel?.batteryChargePercent === null
            ? null
            : `${receiverChannel?.batteryChargePercent}%`,
          receiverChannel?.batteryBars === null
            ? null
            : `${receiverChannel?.batteryBars} / 5 bars`,
          receiverChannel?.batteryRunTimeMinutes === null
            ? null
            : `${Math.floor((receiverChannel?.batteryRunTimeMinutes ?? 0) / 60)}h ${(receiverChannel?.batteryRunTimeMinutes ?? 0) % 60}m remaining`,
          receiverChannel?.batteryType === null
            ? null
            : receiverChannel?.batteryType,
        ]
          .filter(Boolean)
          .join(" · ") || null
      : null;
    const antennaCapable = receiver?.capabilities.antennaDiversity ?? false;
    const rfStatus =
      !receiver || !antennaCapable
        ? "not-applicable"
        : !observed
          ? "unknown"
          : receiverChannel?.interference === "detected"
            ? "fault"
            : receiverChannel?.rfLevelDbm !== null &&
                receiverChannel?.rfLevelDbm !== undefined
              ? receiverChannel.rfLevelDbm <= -75
                ? "fault"
                : receiverChannel.rfLevelDbm <= -65
                  ? "caution"
                  : "good"
              : receiverChannel?.rfLevelRaw !== null &&
                  receiverChannel?.rfLevelRaw !== undefined
                ? receiverChannel.rfLevelRaw <= 20
                  ? "fault"
                  : receiverChannel.rfLevelRaw <= 40
                    ? "caution"
                    : "good"
                : "unknown";
    const linkQualityPercent =
      receiver?.capabilities.linkQuality &&
      receiverChannel?.linkQualityRaw !== null &&
      receiverChannel?.linkQualityRaw !== undefined
        ? Math.min(100, Math.round((receiverChannel.linkQualityRaw / 5) * 100))
        : null;
    const activeAntenna = receiverChannel?.antennas.find(
      (antenna) => antenna.active === true,
    )?.label;
    const receiverExtras = [
      antennaCapable
        ? activeAntenna
          ? `Antenna ${activeAntenna} active`
          : "Antenna diversity unknown"
        : null,
      receiver?.capabilities.interference
        ? receiverChannel?.interference === "detected"
          ? "Interference detected"
          : receiverChannel?.interference === "none"
            ? "No interference"
            : null
        : null,
      receiverChannel?.transmitter.muted === true ? "Transmitter muted" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: `device-channel-${position}`,
      number: position + 1,
      character: configuredChannel.name,
      performer: hasExactShowfile
        ? inputIndex === null
          ? "Audio not patched"
          : `Physical input ${inputIndex + 1}`
        : "Identity unknown",
      kind: configuredChannel.shureReceiverId == null ? "wired" : "wireless",
      zone: state.device?.name ?? "Audio device",
      levelDbfs: null,
      statuses: {
        rf:
          configuredChannel.shureReceiverId == null
            ? "not-applicable"
            : rfStatus,
        audio: "unknown",
        battery:
          configuredChannel.shureReceiverId == null
            ? "not-applicable"
            : batteryStatus,
        check: "unknown",
      },
      details: {
        receiver:
          configuredChannel.shureReceiverId == null
            ? "Not applicable · wired input"
            : receiver
              ? [
                  `${receiver.name} · ${receiver.model ?? "model unknown"} · channel ${(configuredChannel.shureChannelIndex ?? 0) + 1}`,
                  receiverExtras,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : `Shure receiver unavailable · channel ${(configuredChannel.shureChannelIndex ?? 0) + 1}`,
        input:
          inputIndex === null
            ? "Audio input not patched"
            : `${state.device?.name ?? "Audio device"} · input ${inputIndex + 1}`,
        rfLevelDbm: receiverChannel?.rfLevelDbm ?? null,
        linkQualityPercent,
        batteryRemaining,
        telemetryAge: observed
          ? `Telemetry observed ${receiverChannel?.observedAtUtc ?? "at unknown time"}`
          : configuredChannel.shureReceiverId == null
            ? "Identity and level not observed"
            : (receiver?.detail ??
              shure?.detail ??
              "Shure telemetry unavailable"),
      },
    };
  });
}

export function resolvePatchedInputIndex(
  channelId: string | null,
  state: AudioDeviceState,
  showfile?: Showfile | null,
): number | undefined {
  if (state.status !== "ready" || !state.device || !state.channels) return;
  const match = /^device-channel-(\d+)$/.exec(channelId ?? "");
  if (!match) return;
  const position = Number(match[1]);
  const exact =
    showfile?.revision !== undefined &&
    showfile.revision > 0 &&
    showfile.device?.name === state.device.name &&
    showfile.device.channelCount === state.device.channelCount;
  if (exact) return showfile.channels[position]?.inputIndex ?? undefined;
  return state.channels[position]?.index;
}

export const httpAudioDeviceSource = createHttpAudioDeviceSource();
