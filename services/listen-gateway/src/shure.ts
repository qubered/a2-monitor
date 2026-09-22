import { createConnection, isIP, type Socket } from "node:net";
import {
  parseShowfile,
  type Showfile,
  type ShureTelemetry,
} from "@rvlt/pulse-protocol/http";
import {
  isShureReceiverModel,
  SHURE_MODEL_INFO,
  type ShureCapabilityProfile,
  type ShureReceiverFamily,
} from "@rvlt/pulse-protocol/shure-models";

const MAX_BUFFER_BYTES = 64 * 1024;
const STALE_AFTER_MS = 15_000;
const CONFIG_REFRESH_MS = 2_000;
const METER_RATE_MS = "00100";

type ReceiverConfig = Showfile["shureReceivers"][number];
type ReceiverState = ShureTelemetry["receivers"][number];
type ChannelState = ReceiverState["channels"][number];
type AntennaState = ChannelState["antennas"][number];
type AntennaLabel = AntennaState["label"];

const UNCONFIGURED_CAPABILITIES: ShureCapabilityProfile = {
  antennaDiversity: false,
  linkQuality: false,
  interference: false,
  audioMeter: false,
  batteryHealth: false,
  transmitterDetail: false,
};

const ANTENNA_LABELS: AntennaLabel[] = ["A", "B"];

// Command-string property names differ across Shure receiver generations even
// where the underlying concept is identical (e.g. transmitter type is
// TX_MODEL on Axient Digital/SLX-D but TX_TYPE on ULX-D/QLX-D). This table is
// built from the vendor's published network command-string references for
// AD4/ULX-D/QLX-D/SLX-D; ANX4 and SLX-D+ reuse the closest documented family
// (Axient Digital and SLX-D respectively) because Shure has not published a
// command-string reference for those two receivers. Every tuple here is
// `compatible-read-only` per docs/integrations/shure-wireless.md and remains
// unverified until it passes a hardware acceptance test.
type AntennaFormat = "letters" | "pair" | "none";

type FamilyCommands = {
  antennaProperty: string | null;
  antennaFormat: AntennaFormat;
  rfLevelProperty: string | null;
  rfLevelDbmOffset: number | null;
  qualityProperty: string | null;
  interferenceProperty: string | null;
  interferenceDetectedValues: string[];
  audioProperty: string | null;
  audioDbfsOffset: number | null;
  batteryBarsProperty: string;
  batteryChargeProperty: string;
  batteryTypeProperty: string | null;
  batteryCycleProperty: string | null;
  batteryRunTimeProperty: string | null;
  txTypeProperty: string | null;
  muteProperty: string | null;
  muteTrueValues: string[];
  groupChannelProperty: string;
  encryptionWarningProperty: string | null;
};

export const AXIENT_COMMANDS: FamilyCommands = {
  antennaProperty: "ANTENNA_STATUS",
  antennaFormat: "letters",
  rfLevelProperty: "RSSI",
  rfLevelDbmOffset: 120,
  qualityProperty: "CHAN_QUALITY",
  interferenceProperty: "INTERFERENCE_STATUS",
  interferenceDetectedValues: ["DETECTED"],
  audioProperty: "AUDIO_LEVEL_PEAK",
  audioDbfsOffset: 120,
  batteryBarsProperty: "TX_BATT_BARS",
  batteryChargeProperty: "TX_BATT_CHARGE_PERCENT",
  batteryTypeProperty: "TX_BATT_TYPE",
  batteryCycleProperty: "TX_BATT_CYCLE_COUNT",
  batteryRunTimeProperty: "TX_BATT_MINS",
  txTypeProperty: "TX_MODEL",
  muteProperty: "TX_MUTE_MODE_STATUS",
  muteTrueValues: ["MUTE"],
  groupChannelProperty: "GROUP_CHANNEL",
  encryptionWarningProperty: null,
};

export const ULXD_COMMANDS: FamilyCommands = {
  antennaProperty: "RF_ANTENNA",
  antennaFormat: "pair",
  rfLevelProperty: "RX_RF_LVL",
  rfLevelDbmOffset: 128,
  qualityProperty: null,
  interferenceProperty: "RF_INT_DET",
  interferenceDetectedValues: ["CRITICAL"],
  audioProperty: "AUDIO_LVL",
  audioDbfsOffset: 50,
  batteryBarsProperty: "TX_BATT_BARS",
  batteryChargeProperty: "BATT_CHARGE",
  batteryTypeProperty: "BATT_TYPE",
  batteryCycleProperty: "BATT_CYCLE",
  batteryRunTimeProperty: "BATT_RUN_TIME",
  txTypeProperty: "TX_TYPE",
  muteProperty: "TX_MUTE_STATUS",
  muteTrueValues: ["ON"],
  groupChannelProperty: "GROUP_CHAN",
  encryptionWarningProperty: "ENCRYPTION_WARNING",
};

export const QLXD_COMMANDS: FamilyCommands = {
  antennaProperty: "RF_ANTENNA",
  antennaFormat: "pair",
  // QLX-D only exposes RF level through the packed SAMPLE meter string, not a
  // scalar GET; leaving it null keeps the field honestly "unavailable"
  // instead of guessing a property name.
  rfLevelProperty: null,
  rfLevelDbmOffset: null,
  qualityProperty: null,
  interferenceProperty: null,
  interferenceDetectedValues: [],
  audioProperty: "AUDIO_LVL",
  audioDbfsOffset: null,
  batteryBarsProperty: "BATT_BARS",
  batteryChargeProperty: "BATT_CHARGE",
  batteryTypeProperty: "BATT_TYPE",
  batteryCycleProperty: "BATT_CYCLE",
  batteryRunTimeProperty: "BATT_RUN_TIME",
  txTypeProperty: "TX_TYPE",
  muteProperty: "TX_MUTE_STATUS",
  muteTrueValues: ["ON"],
  groupChannelProperty: "GROUP_CHAN",
  encryptionWarningProperty: "ENCRYPTION_WARNING",
};

export const SLXD_COMMANDS: FamilyCommands = {
  antennaProperty: null,
  antennaFormat: "none",
  rfLevelProperty: "RSSI",
  rfLevelDbmOffset: 120,
  qualityProperty: null,
  interferenceProperty: null,
  interferenceDetectedValues: [],
  audioProperty: "AUDIO_LEVEL_PEAK",
  audioDbfsOffset: 120,
  batteryBarsProperty: "TX_BATT_BARS",
  batteryChargeProperty: "BATT_CHARGE",
  batteryTypeProperty: null,
  batteryCycleProperty: null,
  batteryRunTimeProperty: null,
  txTypeProperty: "TX_MODEL",
  muteProperty: "TX_MUTE_STATUS",
  muteTrueValues: ["ON"],
  groupChannelProperty: "GROUP_CHANNEL",
  encryptionWarningProperty: null,
};

const SLXD_PLUS_COMMANDS: FamilyCommands = {
  ...SLXD_COMMANDS,
  interferenceProperty: "RF_INT_DET",
  interferenceDetectedValues: ["CRITICAL"],
};

const FAMILY_COMMANDS: Record<ShureReceiverFamily, FamilyCommands> = {
  "axient-digital": AXIENT_COMMANDS,
  anx4: AXIENT_COMMANDS,
  ulxd: ULXD_COMMANDS,
  qlxd: QLXD_COMMANDS,
  slxd: SLXD_COMMANDS,
  "slxd-plus": SLXD_PLUS_COMMANDS,
};

export type ShureFleetOptions = {
  backendOrigin?: string;
  fetch?: typeof fetch;
};

export type ShureFrame = {
  channelIndex?: number;
  property: string;
  value: string;
};

export class ShureFrameParser {
  private buffer = "";

  push(chunk: Buffer | string): ShureFrame[] {
    this.buffer += chunk.toString();
    if (Buffer.byteLength(this.buffer) > MAX_BUFFER_BYTES) {
      this.buffer = "";
      throw new Error("Shure command-string buffer exceeded 64 KiB.");
    }
    const frames: ShureFrame[] = [];
    while (true) {
      const start = this.buffer.indexOf("<");
      const end = start < 0 ? -1 : this.buffer.indexOf(">", start + 1);
      if (start < 0 || end < 0) {
        if (start > 0) this.buffer = this.buffer.slice(start);
        break;
      }
      const raw = this.buffer.slice(start, end + 1);
      this.buffer = this.buffer.slice(end + 1);
      const match =
        /^<\s*REP\s+(?:(\d+)\s+)?([A-Z0-9_]+)(?:\s+(.+?))?\s*>$/.exec(raw);
      if (!match?.[2]) continue;
      const oneBased = match[1] === undefined ? undefined : Number(match[1]);
      if (
        oneBased !== undefined &&
        (!Number.isInteger(oneBased) || oneBased < 1)
      )
        continue;
      frames.push({
        ...(oneBased === undefined ? {} : { channelIndex: oneBased - 1 }),
        property: match[2],
        value: (match[3] ?? "")
          .trim()
          .replace(/^\{(.*)\}$/, "$1")
          .trim(),
      });
    }
    return frames;
  }
}

function capabilitiesFor(config: ReceiverConfig): ShureCapabilityProfile {
  if (!isShureReceiverModel(config.model)) return UNCONFIGURED_CAPABILITIES;
  return SHURE_MODEL_INFO[config.model].capabilities;
}

function commandsFor(config: ReceiverConfig): FamilyCommands | null {
  if (!isShureReceiverModel(config.model)) return null;
  return FAMILY_COMMANDS[SHURE_MODEL_INFO[config.model].family];
}

function emptyChannel(
  index: number,
  capabilities: ShureCapabilityProfile,
): ChannelState {
  return {
    index,
    linkStatus: "unavailable",
    batteryBars: null,
    batteryChargePercent: null,
    batteryType: null,
    batteryCycleCount: null,
    batteryRunTimeMinutes: null,
    antennas: capabilities.antennaDiversity
      ? ANTENNA_LABELS.map((label) => ({ label, active: null }))
      : [],
    rfLevelDbm: null,
    rfLevelRaw: null,
    linkQualityRaw: null,
    interference: "unavailable",
    audioLevelDbfs: null,
    audioLevelRaw: null,
    frequencyRaw: null,
    groupChannelRaw: null,
    transmitter: { type: null, name: null, muted: null },
    warnings: [],
    observedAtUtc: null,
    availability: "unavailable",
  };
}

function boundedInteger(
  value: string,
  minimum: number,
  maximum: number,
): number | null {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum)
    return null;
  return numeric;
}

function boundedText(value: string, maxLength: number): string | null {
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function parseOnOff(value: string, trueValues: string[]): boolean | null {
  const normalized = value.trim().toUpperCase();
  if (trueValues.includes(normalized)) return true;
  if (["UNKN", "UNKNOWN", ""].includes(normalized)) return null;
  return false;
}

function parseAntennaState(
  channel: ChannelState,
  format: AntennaFormat,
  value: string,
): ChannelState {
  const normalized = value.trim().toUpperCase();
  if (format === "letters") {
    return {
      ...channel,
      antennas: channel.antennas.map((antenna, position) => ({
        ...antenna,
        active: normalized[position] === "B",
      })),
    };
  }
  if (format === "pair" && normalized.length === 2) {
    return {
      ...channel,
      antennas: channel.antennas.map((antenna) => ({
        ...antenna,
        active: normalized[antenna.label === "A" ? 0 : 1] === antenna.label,
      })),
    };
  }
  return channel;
}

function deriveWarnings(channel: ChannelState): string[] {
  const warnings: string[] = [];
  if (channel.interference === "detected")
    warnings.push("RF interference detected.");
  if (
    (channel.batteryChargePercent !== null &&
      channel.batteryChargePercent <= 10) ||
    channel.batteryBars === 0
  )
    warnings.push("Transmitter battery critically low.");
  if (channel.transmitter.muted === true)
    warnings.push("Transmitter is muted.");
  return warnings.slice(0, 8);
}

/** Applies one parsed REP property to a channel using this receiver's family command table. */
export function applyChannelProperty(
  channel: ChannelState,
  commands: FamilyCommands,
  property: string,
  value: string,
): ChannelState | null {
  if (property === commands.antennaProperty)
    return parseAntennaState(channel, commands.antennaFormat, value);
  if (property === commands.rfLevelProperty) {
    const raw = boundedInteger(value, 0, 1_023);
    return {
      ...channel,
      rfLevelRaw: raw,
      rfLevelDbm:
        raw === null || commands.rfLevelDbmOffset === null
          ? null
          : raw - commands.rfLevelDbmOffset,
    };
  }
  if (property === commands.qualityProperty)
    return { ...channel, linkQualityRaw: boundedInteger(value, 0, 1_023) };
  if (property === commands.interferenceProperty) {
    const normalized = value.trim().toUpperCase();
    if (!normalized.length) return channel;
    return {
      ...channel,
      interference: commands.interferenceDetectedValues.includes(normalized)
        ? "detected"
        : "none",
    };
  }
  if (property === commands.audioProperty) {
    const raw = boundedInteger(value, 0, 1_023);
    return {
      ...channel,
      audioLevelRaw: raw,
      audioLevelDbfs:
        raw === null || commands.audioDbfsOffset === null
          ? null
          : raw - commands.audioDbfsOffset,
    };
  }
  if (property === commands.batteryBarsProperty)
    return { ...channel, batteryBars: boundedInteger(value, 0, 5) };
  if (property === commands.batteryChargeProperty)
    return { ...channel, batteryChargePercent: boundedInteger(value, 0, 100) };
  if (property === commands.batteryTypeProperty)
    return { ...channel, batteryType: boundedText(value, 32) };
  if (property === commands.batteryCycleProperty)
    return { ...channel, batteryCycleCount: boundedInteger(value, 0, 100_000) };
  if (property === commands.batteryRunTimeProperty)
    return {
      ...channel,
      batteryRunTimeMinutes: boundedInteger(value, 0, 1_440),
    };
  if (property === commands.txTypeProperty)
    return {
      ...channel,
      transmitter: { ...channel.transmitter, type: boundedText(value, 64) },
    };
  if (property === commands.muteProperty) {
    const muted = parseOnOff(value, commands.muteTrueValues);
    if (muted === null) return channel;
    return { ...channel, transmitter: { ...channel.transmitter, muted } };
  }
  if (property === commands.groupChannelProperty)
    return { ...channel, groupChannelRaw: boundedText(value, 16) };
  if (property === commands.encryptionWarningProperty) {
    const warningOn = parseOnOff(value, ["ON"]);
    if (!warningOn) return channel;
    return {
      ...channel,
      warnings: [...channel.warnings, "Encryption mismatch detected."].slice(
        0,
        8,
      ),
    };
  }
  if (property === "FREQUENCY")
    return { ...channel, frequencyRaw: boundedText(value, 16) };
  if (property === "CHAN_NAME")
    return {
      ...channel,
      transmitter: { ...channel.transmitter, name: boundedText(value, 64) },
    };
  return null;
}

class ReceiverMonitor {
  private socket?: Socket;
  private reconnectTimer?: NodeJS.Timeout;
  private staleTimer?: NodeJS.Timeout;
  private closed = false;
  private reconnectDelayMs = 500;
  private state: ReceiverState;
  private readonly capabilities: ShureCapabilityProfile;
  private readonly commands: FamilyCommands | null;

  constructor(readonly config: ReceiverConfig) {
    this.capabilities = capabilitiesFor(config);
    this.commands = commandsFor(config);
    this.state = {
      id: config.id,
      name: config.name,
      host: config.host,
      model: null,
      firmware: null,
      compatibility: "compatible-read-only",
      status: "connecting",
      detail: "Connecting to this Shure receiver.",
      capabilities: this.capabilities,
      channels: Array.from({ length: config.channelCount }, (_, index) =>
        emptyChannel(index, this.capabilities),
      ),
    };
  }

  start(): void {
    if (this.closed) return;
    if (isIP(this.config.host) === 0) {
      this.state = {
        ...this.state,
        status: "error",
        detail: "Receiver host must be an explicit IP address.",
      };
      return;
    }
    this.connect();
  }

  getState(): ReceiverState {
    return structuredClone(this.state);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.socket?.destroy();
  }

  private connect(): void {
    if (this.closed) return;
    this.state = {
      ...this.state,
      status: "connecting",
      detail: "Connecting to this Shure receiver.",
    };
    const parser = new ShureFrameParser();
    const socket = createConnection({ host: this.config.host, port: 2202 });
    this.socket = socket;
    socket.setKeepAlive(true, 5_000);
    socket.setTimeout(20_000, () =>
      socket.destroy(new Error("Shure receiver timed out.")),
    );
    socket.on("connect", () => {
      this.reconnectDelayMs = 500;
      socket.write(this.buildInitialCommands());
      this.state = {
        ...this.state,
        status: "ready",
        detail: "Read-only connection is active; waiting for receiver reports.",
      };
    });
    socket.on("data", (chunk) => {
      try {
        for (const frame of parser.push(chunk)) this.apply(frame);
      } catch (error) {
        socket.destroy(error as Error);
      }
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      if (this.closed) return;
      this.state = {
        ...this.state,
        status: "stale",
        detail: "Receiver disconnected; retained telemetry is stale.",
        channels: this.state.channels.map((channel) => ({
          ...channel,
          availability:
            channel.observedAtUtc === null ? "unavailable" : "stale",
        })),
      };
      this.reconnectTimer = setTimeout(
        () => this.connect(),
        this.reconnectDelayMs,
      );
      this.reconnectTimer.unref();
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
    });
  }

  private buildInitialCommands(): string {
    const commands = ["< GET MODEL >", "< GET FW_VER >"];
    const table = this.commands;
    for (let channel = 1; channel <= this.config.channelCount; channel += 1) {
      commands.push(
        `< GET ${channel} CHAN_NAME >`,
        `< GET ${channel} FREQUENCY >`,
      );
      if (!table) continue;
      commands.push(
        `< GET ${channel} ${table.batteryBarsProperty} >`,
        `< GET ${channel} ${table.batteryChargeProperty} >`,
        `< GET ${channel} ${table.groupChannelProperty} >`,
      );
      if (this.capabilities.batteryHealth) {
        for (const property of [
          table.batteryTypeProperty,
          table.batteryCycleProperty,
          table.batteryRunTimeProperty,
        ]) {
          if (property) commands.push(`< GET ${channel} ${property} >`);
        }
      }
      if (this.capabilities.antennaDiversity) {
        if (table.antennaProperty)
          commands.push(`< GET ${channel} ${table.antennaProperty} >`);
        if (table.rfLevelProperty)
          commands.push(`< GET ${channel} ${table.rfLevelProperty} >`);
      }
      if (this.capabilities.linkQuality && table.qualityProperty) {
        commands.push(`< GET ${channel} ${table.qualityProperty} >`);
      }
      if (this.capabilities.interference && table.interferenceProperty) {
        commands.push(`< GET ${channel} ${table.interferenceProperty} >`);
        if (table.encryptionWarningProperty)
          commands.push(
            `< GET ${channel} ${table.encryptionWarningProperty} >`,
          );
      }
      if (this.capabilities.audioMeter && table.audioProperty) {
        commands.push(
          `< SET ${channel} METER_RATE ${METER_RATE_MS} >`,
          `< GET ${channel} ${table.audioProperty} >`,
        );
      }
      if (this.capabilities.transmitterDetail) {
        if (table.txTypeProperty)
          commands.push(`< GET ${channel} ${table.txTypeProperty} >`);
        if (table.muteProperty)
          commands.push(`< GET ${channel} ${table.muteProperty} >`);
      }
    }
    return `${commands.join("\r\n")}\r\n`;
  }

  private apply(frame: ShureFrame): void {
    if (frame.property === "MODEL" || frame.property === "FW_VER") {
      this.state = {
        ...this.state,
        [frame.property === "MODEL" ? "model" : "firmware"]:
          frame.value || null,
      };
      return;
    }
    if (
      frame.channelIndex === undefined ||
      frame.channelIndex >= this.state.channels.length ||
      !this.commands
    )
      return;
    const current =
      this.state.channels[frame.channelIndex] ??
      emptyChannel(frame.channelIndex, this.capabilities);
    const updated = applyChannelProperty(
      current,
      this.commands,
      frame.property,
      frame.value,
    );
    if (!updated) return;
    const observed: ChannelState = {
      ...updated,
      linkStatus: "active",
      observedAtUtc: new Date().toISOString(),
      availability: "observed",
    };
    const channels = [...this.state.channels];
    channels[frame.channelIndex] = {
      ...observed,
      warnings: deriveWarnings(observed),
    };
    this.state = {
      ...this.state,
      status: "ready",
      detail: "Read-only Shure telemetry is current.",
      channels,
    };
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => {
      this.state = {
        ...this.state,
        status: "stale",
        detail: "Shure telemetry has not updated for 15 seconds.",
        channels: this.state.channels.map((channel) => ({
          ...channel,
          availability:
            channel.observedAtUtc === null ? "unavailable" : "stale",
        })),
      };
    }, STALE_AFTER_MS);
    this.staleTimer.unref();
  }
}

export class ShureFleetMonitor {
  private readonly monitors = new Map<string, ReceiverMonitor>();
  private readonly fetcher: typeof fetch;
  private refreshTimer?: NodeJS.Timeout;
  private closed = false;
  private configError?: string;

  constructor(private readonly options: ShureFleetOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
  }

  start(): void {
    if (!this.options.backendOrigin || this.closed) return;
    void this.refresh();
    this.refreshTimer = setInterval(
      () => void this.refresh(),
      CONFIG_REFRESH_MS,
    );
    this.refreshTimer.unref();
  }

  getState(): ShureTelemetry {
    const receivers = [...this.monitors.values()].map((monitor) =>
      monitor.getState(),
    );
    if (receivers.length === 0)
      return {
        schemaVersion: "0",
        status: this.configError ? "error" : "unconfigured",
        detail:
          this.configError ?? "No Shure receivers are configured in Manager.",
        receivers: [],
      };
    const statuses = receivers.map(({ status }) => status);
    const allReady = statuses.every((status) => status === "ready");
    const allSame = statuses.every((status) => status === statuses[0]);
    return {
      schemaVersion: "0",
      status: allReady ? "ready" : allSame ? statuses[0]! : "degraded",
      detail: allReady
        ? "All configured Shure receivers are reporting."
        : "One or more configured Shure receivers are not current.",
      receivers,
    };
  }

  close(): void {
    this.closed = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    for (const monitor of this.monitors.values()) monitor.close();
    this.monitors.clear();
  }

  private async refresh(): Promise<void> {
    try {
      const response = await this.fetcher(
        new URL("/api/v1/showfile", this.options.backendOrigin),
      );
      if (!response.ok)
        throw new Error(
          `Manager configuration returned HTTP ${response.status}.`,
        );
      const showfile = parseShowfile(await response.json());
      this.reconcile(showfile.shureReceivers);
      this.configError = undefined;
    } catch (error) {
      this.configError =
        error instanceof Error
          ? error.message
          : "Receiver configuration is unavailable.";
    }
  }

  private reconcile(configs: ReceiverConfig[]): void {
    const desired = new Set(configs.map(({ id }) => id));
    for (const [id, monitor] of this.monitors) {
      if (!desired.has(id)) {
        monitor.close();
        this.monitors.delete(id);
      }
    }
    for (const config of configs) {
      const current = this.monitors.get(config.id);
      if (current && JSON.stringify(current.config) === JSON.stringify(config))
        continue;
      current?.close();
      const monitor = new ReceiverMonitor(config);
      this.monitors.set(config.id, monitor);
      monitor.start();
    }
  }
}
