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
    session.setDimmed(false);
    session.setGainDb(6);
    expect(FakeAudioContext.latest.gain.gain.value).toBeCloseTo(1.995, 3);
    session.close();
  });

  it("asks for a context at the node's rate so the browser resamples", () => {
    FakeSocket.instances = [];
    const requested: Array<AudioContextOptions | undefined> = [];
    class ResamplingContext extends FakeAudioContext {
      constructor(options?: AudioContextOptions) {
        super();
        requested.push(options);
        this.sampleRate = options?.sampleRate ?? 44100;
      }
    }
    const updates: string[] = [];
    createWebAudioPlaybackFactory({
      AudioContext: ResamplingContext as unknown as new () => AudioContext,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    })({
      channel: 0,
      sampleRateHz: 48000,
      onUpdate: ({ status }) => updates.push(status),
    });

    expect(requested[0]).toMatchObject({ sampleRate: 48000 });
    expect(updates).toEqual(["connecting"]);
  });

  it("reports a sample-rate mismatch it cannot resample, and keeps that reason", () => {
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
    FakeSocket.instances[0]?.onerror?.();
    FakeSocket.instances[0]?.onclose?.();

    expect(details).toHaveLength(1);
    expect(details[0]).toContain("48000 Hz");
    expect(details[0]).toContain("44100 Hz");
    expect(FakeSocket.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it("never reports a late socket error from a session that was already closed", () => {
    FakeSocket.instances = [];
    FakeAudioContext.sampleRate = 48000;
    const updates: string[] = [];
    const session = createWebAudioPlaybackFactory({
      AudioContext: FakeAudioContext as unknown as new () => AudioContext,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    })({
      channel: 0,
      sampleRateHz: 48000,
      onUpdate: ({ status }) => updates.push(status),
    });

    session.close();
    // Browsers fire error and close for a socket closed while connecting.
    FakeSocket.instances[0]?.onerror?.();
    FakeSocket.instances[0]?.onclose?.();
    FakeSocket.instances[0]?.onmessage?.(
      new MessageEvent("message", { data: new Float32Array([1]).buffer }),
    );

    expect(updates).toEqual(["connecting"]);
  });
});
