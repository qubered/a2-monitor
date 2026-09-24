import {
  parseHostOutput,
  parseProductionList,
  parseShowfile,
  parseShureTelemetry,
  type HostOutput,
  type ProductionList,
  type Showfile,
  type ShureTelemetry,
} from "@rvlt/pulse-protocol/http";

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
  const value = (await response.json()) as Record<string, unknown>;
  return parseShowfile({
    ...value,
    shureReceivers: value.shureReceivers ?? [],
  });
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

/** The node's host output state (ADR 0031): device, channels in effect and status. */
export async function loadHostOutput(
  signal?: AbortSignal,
): Promise<HostOutput> {
  const response = await fetch("/audio/v0/output", { signal });
  if (!response.ok)
    throw new Error("The host output state could not be loaded.");
  return parseHostOutput(await response.json());
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

export async function loadProductions(
  signal?: AbortSignal,
): Promise<ProductionList> {
  const response = await fetch("/api/v1/productions", { signal });
  if (!response.ok) throw new Error("The production list could not be loaded.");
  return parseProductionList(await response.json());
}

export async function createProduction(name: string): Promise<ProductionList> {
  const response = await fetch("/api/v1/productions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error("The production could not be created.");
  return parseProductionList(await response.json());
}

export async function activateProduction(id: string): Promise<ProductionList> {
  const response = await fetch(
    `/api/v1/productions/${encodeURIComponent(id)}/activate`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error("The production could not be activated.");
  return parseProductionList(await response.json());
}

export async function deleteProduction(id: string): Promise<ProductionList> {
  const response = await fetch(
    `/api/v1/productions/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error("The production could not be removed.");
  return parseProductionList(await response.json());
}

export async function loadProductionShowfile(
  id: string,
  signal?: AbortSignal,
): Promise<Showfile> {
  const response = await fetch(
    `/api/v1/productions/${encodeURIComponent(id)}`,
    { signal },
  );
  if (!response.ok) throw new Error("The showfile could not be loaded.");
  return parseShowfile(await response.json());
}

function showfileDownloadFilename(name: string): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "showfile";
  return `${slug}.a2-showfile.json`;
}

export function downloadShowfile(showfile: Showfile): void {
  const blob = new Blob([JSON.stringify(showfile, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = showfileDownloadFilename(showfile.show.name);
  link.click();
  URL.revokeObjectURL(url);
}

export async function readUploadedShowfile(file: File): Promise<Showfile> {
  const text = await file.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!isRecord(value)) {
    throw new Error("That file is not a showfile.");
  }
  return parseShowfile({
    ...value,
    shureReceivers: value.shureReceivers ?? [],
  });
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
          shureReceiverId: null,
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
          shureReceiverId: channel.shureReceiverId ?? null,
        }));
  return {
    ...showfile,
    shureReceivers: showfile.shureReceivers ?? [],
    device: { name: device.name, channelCount: device.channelCount },
    channels,
  };
}
