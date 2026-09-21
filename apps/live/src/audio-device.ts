import type { LiveChannel, Showfile } from "@a2-monitor/protocol/http";

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
): LiveChannel[] {
  if (state.status !== "ready" || !state.device || !state.channels) return [];
  const savedNames =
    showfile?.device?.name === state.device.name &&
    showfile.device.channelCount === state.device.channelCount
      ? new Map(
          showfile.channels.map(({ inputIndex, name }) => [inputIndex, name]),
        )
      : new Map<number, string>();
  return state.channels.map(({ index, label }) => ({
    id: `device-channel-${index}`,
    number: index + 1,
    character: savedNames.get(index) ?? (label || `Input ${index + 1}`),
    performer: savedNames.has(index)
      ? `Physical input ${index + 1}`
      : "Identity unknown",
    kind: "wired",
    zone: state.device?.name ?? "Audio device",
    levelDbfs: null,
    statuses: {
      rf: "not-applicable",
      audio: "unknown",
      battery: "not-applicable",
      check: "unknown",
    },
    details: {
      receiver: "Not applicable · wired input",
      input: `${state.device?.name ?? "Audio device"} · input ${index + 1}`,
      rfLevelDbm: null,
      linkQualityPercent: null,
      batteryRemaining: null,
      telemetryAge: "Identity and level not observed",
    },
  }));
}

export const httpAudioDeviceSource = createHttpAudioDeviceSource();
