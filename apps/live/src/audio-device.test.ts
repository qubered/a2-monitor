// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  createHttpAudioDeviceSource,
  parseAudioDeviceState,
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
});
