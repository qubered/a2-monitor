// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createWebAudioPlaybackFactory } from "./audio-playback";

class FakeSocket {
  static instances: FakeSocket[] = [];
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
}

class FakeAudioContext {
  static sampleRate = 48000;
  static latest: FakeAudioContext;
  sampleRate = FakeAudioContext.sampleRate;
  state: AudioContextState = "suspended";
  destination = {} as AudioDestinationNode;
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  processor = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null,
  };

  constructor() {
    FakeAudioContext.latest = this;
  }

  createGain() {
    return this.gain as unknown as GainNode;
  }

  createScriptProcessor() {
    return this.processor as unknown as ScriptProcessorNode;
  }
}

describe("bounded Web Audio playback", () => {
  it("drops old queued samples, starts muted and applies dim safely", async () => {
    FakeSocket.instances = [];
    FakeAudioContext.sampleRate = 48000;
    const updates: string[] = [];
    const factory = createWebAudioPlaybackFactory({
      AudioContext: FakeAudioContext as unknown as new () => AudioContext,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
      queueCapSamples: 4,
    });
    const session = factory({
      channel: 1,
      sampleRateHz: 48000,
      onUpdate: ({ status }) => updates.push(status),
    });
    const socket = FakeSocket.instances[0];
    expect(socket?.url).toContain("/audio/v0/listen?channel=1");
    expect(FakeAudioContext.latest.gain.gain.value).toBe(0);

    socket?.onopen?.();
    socket?.onmessage?.(
      new MessageEvent("message", { data: new Float32Array([1, 2, 3]).buffer }),
    );
    socket?.onmessage?.(
      new MessageEvent("message", { data: new Float32Array([4, 5, 6]).buffer }),
    );
    const output = new Float32Array(4);
    FakeAudioContext.latest.processor.onaudioprocess?.({
      outputBuffer: { getChannelData: () => output },
    } as unknown as AudioProcessingEvent);

    expect([...output]).toEqual([4, 5, 6, 0]);
    expect(updates).toEqual(["connecting", "connecting", "listening"]);
    session.setDimmed(true);
    await session.setMuted(false);
    expect(FakeAudioContext.latest.gain.gain.value).toBeCloseTo(0.0316);
    expect(FakeAudioContext.latest.resume).toHaveBeenCalledOnce();
    session.close();
  });

  it("reports a sample-rate mismatch and closes the stream", () => {
    FakeSocket.instances = [];
    FakeAudioContext.sampleRate = 44100;
    const details: string[] = [];
    createWebAudioPlaybackFactory({
      AudioContext: FakeAudioContext as unknown as new () => AudioContext,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    })({
      channel: 0,
      sampleRateHz: 48000,
      onUpdate: ({ detail }) => details.push(detail),
    });

    expect(details[0]).toContain("48000 Hz");
    expect(details[0]).toContain("44100 Hz");
    expect(FakeSocket.instances[0]?.close).toHaveBeenCalledOnce();
  });
});
