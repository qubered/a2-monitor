import {
  parseShowfile,
  parseShureTelemetry,
  type Showfile,
  type ShureTelemetry,
} from "@a2-monitor/protocol/http";

export type ObservedDevice = {
  name: string;
  sampleRateHz: number;
  channelCount: number;
  channels: Array<{ index: number; label: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseObservedDevice(value: unknown): ObservedDevice {
  if (!isRecord(value) || value.status !== "ready") {
    throw new Error(
      isRecord(value) && typeof value.detail === "string"
        ? value.detail
        : "The audio device is not ready.",
    );
  }
  if (!isRecord(value.device) || !Array.isArray(value.channels)) {
    throw new Error("The audio device response is incomplete.");
  }
  const { name, sampleRateHz, channelCount } = value.device;
  if (
    typeof name !== "string" ||
    typeof sampleRateHz !== "number" ||
    !Number.isInteger(channelCount)
  ) {
    throw new Error("The audio device identity is invalid.");
  }
  const channels = value.channels.map((channel) => {
    if (
      !isRecord(channel) ||
      !Number.isInteger(channel.index) ||
      typeof channel.label !== "string"
    ) {
      throw new Error("The audio device channel list is invalid.");
    }
    return { index: channel.index as number, label: channel.label };
  });
  return { name, sampleRateHz, channelCount: channelCount as number, channels };
}

export async function loadShowfile(signal?: AbortSignal): Promise<Showfile> {
  const response = await fetch("/api/v1/showfile", { signal });
  if (!response.ok) throw new Error("The showfile could not be loaded.");
  return parseShowfile(await response.json());
}

export async function loadObservedDevice(
  signal?: AbortSignal,
): Promise<ObservedDevice> {
  const response = await fetch("/audio/v0/device", { signal });
  if (!response.ok) throw new Error("The audio device could not be loaded.");
  return parseObservedDevice(await response.json());
}

export async function loadShureTelemetry(
  signal?: AbortSignal,
): Promise<ShureTelemetry> {
  const response = await fetch("/audio/v0/shure", { signal });
  if (!response.ok) throw new Error("Shure telemetry could not be loaded.");
  return parseShureTelemetry(await response.json());
}

export async function saveShowfile(showfile: Showfile): Promise<Showfile> {
  const response = await fetch("/api/v1/showfile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(showfile),
  });
  if (response.status === 409) {
    throw new Error("The showfile changed elsewhere. Reload before saving.");
  }
  if (!response.ok) throw new Error("The showfile could not be saved.");
  return parseShowfile(await response.json());
}

export function projectShowfileToDevice(
  showfile: Showfile,
  device: ObservedDevice,
): Showfile {
  const exactDevice =
    showfile.device?.name === device.name &&
    showfile.device.channelCount === device.channelCount;
  const channels =
    showfile.revision === 0 && showfile.channels.length === 0
      ? device.channels.map(({ index, label }) => ({
          inputIndex: index,
          name: label || `Channel ${index + 1}`,
          shureChannelIndex: null,
        }))
      : showfile.channels.map((channel) => ({
          ...channel,
          inputIndex:
            exactDevice &&
            channel.inputIndex !== null &&
            channel.inputIndex < device.channelCount
              ? channel.inputIndex
              : null,
          shureChannelIndex: channel.shureChannelIndex ?? null,
        }));
  return {
    ...showfile,
    device: { name: device.name, channelCount: device.channelCount },
    channels,
  };
}
