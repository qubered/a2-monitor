import type {
  NodeLevels,
  Showfile,
  ShureTelemetry,
} from "@rvlt/pulse-protocol/http";
import type { NodeObservation, NodeSource } from "./node-observer.js";

export const DEVICE = {
  name: "USB Interface",
  sampleRateHz: 48_000,
  channelCount: 4,
  simulated: false,
};

export function showfileWith(overrides: Partial<Showfile> = {}): Showfile {
  return {
    schemaVersion: "0",
    revision: 4,
    updatedAtUtc: "2026-09-23T00:00:00Z",
    show: { name: "The Winter Circus" },
    device: { name: DEVICE.name, channelCount: DEVICE.channelCount },
    shureReceivers: [
      {
        id: "rack-a",
        name: "Stage left",
        host: "192.0.2.10",
        model: "AD4Q",
        channelCount: 4,
      },
    ],
    channels: [
      {
        id: "ch-marguerite",
        inputIndex: 0,
        name: "Marguerite",
        performer: "Eleanor Vance",
        shureReceiverId: "rack-a",
        shureChannelIndex: 0,
        micType: "headset",
        imageUrl: null,
        monitor: { battery: true, rf: true, audio: true },
      },
      {
        id: "ch-talkback",
        inputIndex: 1,
        name: "Talkback",
        shureReceiverId: null,
        shureChannelIndex: null,
        monitor: { battery: true, rf: true, audio: true },
      },
    ],
    ...overrides,
  };
}

export function levelsWith(
  peaks: Array<number | null>,
  overrides: Partial<NodeLevels["capture"]> = {},
  clipped: number[] = [],
): NodeLevels {
  return {
    schemaVersion: "0",
    generatedAtUtc: "2026-09-23T00:00:00Z",
    capture: {
      status: "ready",
      detail: "Capture is ready.",
      device: DEVICE,
      ...overrides,
    },
    windowMs: 1000,
    inputs: peaks.map((peakDbfs, index) => ({
      index,
      peakDbfs,
      rmsDbfs: peakDbfs === null ? null : Math.max(-120, peakDbfs - 18),
      clippedSamples: clipped[index] ?? 0,
    })),
  };
}

type ChannelOverrides = Partial<
  ShureTelemetry["receivers"][number]["channels"][number]
>;

export function telemetryWith(
  channels: ChannelOverrides[],
  receiverOverrides: Partial<ShureTelemetry["receivers"][number]> = {},
): ShureTelemetry {
  return {
    schemaVersion: "0",
    status: "ready",
    detail: "All configured Shure receivers are reporting.",
    receivers: [
      {
        id: "rack-a",
        name: "Stage left",
        host: "192.0.2.10",
        model: "AD4Q",
        firmware: "2.3.28.0",
        compatibility: "compatible-read-only",
        status: "ready",
        detail: "Read-only Shure telemetry is current.",
        capabilities: {
          antennaDiversity: true,
          linkQuality: true,
          interference: true,
          audioMeter: true,
          batteryHealth: true,
          transmitterDetail: true,
        },
        channels: channels.map((overrides, index) => ({
          index,
          linkStatus: "active",
          batteryBars: 5,
          batteryChargePercent: 90,
          batteryType: "LION",
          batteryCycleCount: 42,
          batteryRunTimeMinutes: 270,
          antennas: [
            { label: "A", active: true },
            { label: "B", active: false },
          ],
          rfLevelDbm: -58,
          rfLevelRaw: 62,
          linkQualityRaw: 5,
          interference: "none",
          audioLevelDbfs: -20,
          audioLevelRaw: 100,
          frequencyRaw: "0578125",
          groupChannelRaw: "1,4",
          transmitter: { type: "AD2", name: "MARGUERITE", muted: false },
          warnings: [],
          observedAtUtc: "2026-09-23T00:00:00Z",
          availability: "observed",
          ...overrides,
        })),
        ...receiverOverrides,
      },
    ],
  };
}

/** A node source whose observation the test sets directly. */
export class FakeNodeSource implements NodeSource {
  observation: NodeObservation = {
    configured: true,
    levels: null,
    levelsAtMs: null,
    shure: null,
    shureAtMs: null,
    firstAttemptAtMs: null,
    error: null,
  };

  current(): NodeObservation {
    return this.observation;
  }

  start(): void {}

  stop(): void {}

  observe(
    nowMs: number,
    levels: NodeLevels | null,
    shure: ShureTelemetry | null,
  ): void {
    this.observation = {
      ...this.observation,
      levels,
      levelsAtMs: levels ? nowMs : this.observation.levelsAtMs,
      shure,
      shureAtMs: shure ? nowMs : this.observation.shureAtMs,
      firstAttemptAtMs: this.observation.firstAttemptAtMs ?? nowMs,
    };
  }
}

export function observationAt(
  nowMs: number,
  levels: NodeLevels | null,
  shure: ShureTelemetry | null,
): NodeObservation {
  return {
    configured: true,
    levels,
    levelsAtMs: levels ? nowMs : null,
    shure,
    shureAtMs: shure ? nowMs : null,
    firstAttemptAtMs: nowMs,
    error: null,
  };
}
