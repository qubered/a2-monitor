// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { Showfile, ShureTelemetry } from "@rvlt/pulse-protocol/http";
import {
  createHttpAudioDeviceSource,
  parseAudioDeviceState,
  resolvePatchedInputIndex,
  synthesizeDeviceChannels,
  type AudioDeviceState,
} from "./audio-device";

const readyDevice: AudioDeviceState = {
  schemaVersion: 0,
  status: "ready",
  detail: "Capture active.",
  device: { name: "USB Interface", sampleRateHz: 48000, channelCount: 2 },
  channels: [
    { index: 0, label: "Input 1" },
    { index: 1, label: "Talkback" },
  ],
};

describe("audio device adapter", () => {
  it("loads the version 0 device endpoint", async () => {
    let requested = "";
    const source = createHttpAudioDeviceSource(async (input) => {
      requested = String(input);
      return Response.json(readyDevice);
    });

    await expect(source.load(new AbortController().signal)).resolves.toEqual(
      readyDevice,
    );
    expect(requested).toBe("/audio/v0/device");
  });

  it("rejects incomplete ready state and unknown contract fields", () => {
    expect(() =>
      parseAudioDeviceState({
        schemaVersion: 0,
        status: "ready",
        detail: "Capture active.",
      }),
    ).toThrow("incomplete");
    expect(() =>
      parseAudioDeviceState({ ...readyDevice, healthy: true }),
    ).toThrow("unsupported fields");
  });

  it("keeps a configuration-required node unavailable without inventing inputs", () => {
    const state = parseAudioDeviceState({
      schemaVersion: 0,
      status: "configuration-required",
      detail: "Set A2_AUDIO_DEVICE to an exact device name.",
    });

    expect(state.status).toBe("configuration-required");
    expect(synthesizeDeviceChannels(state)).toEqual([]);
  });

  it("synthesizes wired inputs without inventing cast or telemetry identity", () => {
    const channels = synthesizeDeviceChannels(readyDevice);

    expect(channels).toHaveLength(2);
    expect(channels[1]).toMatchObject({
      id: "device-channel-1",
      number: 2,
      character: "Talkback",
      performer: "Identity unknown",
      kind: "wired",
      levelDbfs: null,
      statuses: { audio: "unknown", check: "unknown" },
      details: { telemetryAge: "Identity and level not observed" },
    });
  });

  it("projects configured input patches and observed Shure battery telemetry", () => {
    const state = parseAudioDeviceState({
      schemaVersion: 0,
      status: "ready",
      detail: "Capture active.",
      device: { name: "USB Interface", sampleRateHz: 48000, channelCount: 2 },
      channels: [
        { index: 0, label: "Input 1" },
        { index: 1, label: "Input 2" },
      ],
    });
    const showfile: Showfile = {
      schemaVersion: "0",
      revision: 3,
      updatedAtUtc: "2026-09-21T00:00:00Z",
      show: { name: "Test" },
      device: { name: "USB Interface", channelCount: 2 },
      shureReceivers: [
        {
          id: "stage-left",
          name: "Stage left",
          host: "192.0.2.10",
          model: "ULXD4D",
          channelCount: 2,
        },
      ],
      channels: [
        {
          inputIndex: 1,
          name: "Lead",
          shureReceiverId: "stage-left",
          shureChannelIndex: 0,
        },
        { inputIndex: null, name: "Spare", shureChannelIndex: null },
      ],
    };
    const shure: ShureTelemetry = {
      schemaVersion: "0",
      status: "ready",
      detail: "Current.",
      receivers: [
        {
          id: "stage-left",
          name: "Stage left",
          host: "192.0.2.10",
          model: "ULXD4D",
          firmware: "2.7.10",
          compatibility: "compatible-read-only",
          status: "ready",
          detail: "Current.",
          capabilities: {
            antennaDiversity: true,
            linkQuality: false,
            interference: true,
            audioMeter: true,
            batteryHealth: true,
            transmitterDetail: true,
          },
          channels: [
            {
              index: 0,
              linkStatus: "active",
              batteryBars: 1,
              batteryChargePercent: 18,
              batteryType: null,
              batteryCycleCount: null,
              batteryRunTimeMinutes: 95,
              antennas: [
                { label: "A", active: true },
                { label: "B", active: false },
              ],
              rfLevelDbm: -52,
              rfLevelRaw: 76,
              linkQualityRaw: null,
              interference: "none",
              audioLevelDbfs: null,
              audioLevelRaw: null,
              frequencyRaw: "0537925",
              groupChannelRaw: "19 037",
              transmitter: { type: "ULXD1", name: "Lead", muted: false },
              warnings: [],
              observedAtUtc: "2026-09-21T00:00:00Z",
              availability: "observed",
            },
          ],
        },
      ],
    };

    const channels = synthesizeDeviceChannels(state, showfile, shure);
    expect(channels[0]).toMatchObject({
      character: "Lead",
      performer: "Physical input 2",
      kind: "wireless",
      statuses: { battery: "caution", rf: "good" },
      details: {
        batteryRemaining: "18% · 1 / 5 bars · 1h 35m remaining",
        rfLevelDbm: -52,
        linkQualityPercent: null,
        receiver:
          "Stage left · ULXD4D · channel 1 · Antenna A active · No interference",
      },
    });
    expect(channels[1]).toMatchObject({ performer: "Audio not patched" });
    expect(resolvePatchedInputIndex("device-channel-0", state, showfile)).toBe(
      1,
    );
    expect(
      resolvePatchedInputIndex("device-channel-1", state, showfile),
    ).toBeUndefined();
  });
});
