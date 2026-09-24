// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  DISCONNECTED_GRACE_MS,
  LISTEN_SESSIONS_PATH,
  createWebRtcPlaybackFactory,
  type PlaybackUpdate,
} from "./audio-playback";

class FakeAudioContext {
  static latest: FakeAudioContext;
  state: AudioContextState = "suspended";
  destination = {} as AudioDestinationNode;
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  sources: Array<{
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];

  constructor(readonly options?: AudioContextOptions) {
    FakeAudioContext.latest = this;
  }

  createGain() {
    return this.gain as unknown as GainNode;
  }

  createMediaStreamSource() {
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    this.sources.push(source);
    return source as unknown as MediaStreamAudioSourceNode;
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  connectionState: RTCPeerConnectionState = "new";
  localDescription: { sdp: string } | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  transceivers: Array<[string, RTCRtpTransceiverInit | undefined]> = [];
  close = vi.fn();

  constructor(readonly config: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }

  addTransceiver(kind: string, init?: RTCRtpTransceiverInit) {
    this.transceivers.push([kind, init]);
  }

  async createOffer() {
    return {
      type: "offer",
      sdp: `offer-${FakePeerConnection.instances.length}`,
    };
  }

  async setLocalDescription(description: { sdp: string }) {
    this.localDescription = description;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
  }

  deliverTrack() {
    const track = { muted: false, addEventListener: vi.fn() };
    this.ontrack?.({ track } as unknown as RTCTrackEvent);
  }

  setState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

class FakeMediaStream {
  constructor(readonly tracks: unknown[]) {}
}

function manualTimers() {
  const pending = new Map<number, { callback: () => void; ms: number }>();
  let next = 1;
  return {
    pending,
    timers: {
      setTimeout: (callback: () => void, ms: number) => {
        pending.set(next, { callback, ms });
        return next++;
      },
      clearTimeout: (handle: number) => {
        pending.delete(handle);
      },
    },
    runAll() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, timer] of due) timer.callback();
    },
  };
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(responses?: (url: string, init?: RequestInit) => Response) {
  FakePeerConnection.instances = [];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let sessionCount = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (responses) return responses(url, init);
    if (url === LISTEN_SESSIONS_PATH) {
      sessionCount += 1;
      return new Response(
        JSON.stringify({
          sessionId: `00000000-0000-4000-8000-00000000000${sessionCount}`,
          answer: "answer",
        }),
        { status: 201 },
      );
    }
    return new Response(null, { status: 204 });
  });
  const network = new EventTarget();
  const gestures = new EventTarget();
  const clock = manualTimers();
  const audio = {
    muted: false,
    srcObject: null as MediaProvider | null,
    play: vi.fn(async () => undefined),
  };
  const updates: PlaybackUpdate[] = [];
  const factory = createWebRtcPlaybackFactory({
    AudioContext: FakeAudioContext as unknown as new () => AudioContext,
    RTCPeerConnection:
      FakePeerConnection as unknown as typeof RTCPeerConnection,
    MediaStream: FakeMediaStream as unknown as typeof MediaStream,
    fetch: fetch as unknown as typeof globalThis.fetch,
    createAudioElement: () => audio as unknown as HTMLAudioElement,
    network,
    gestureTarget: gestures,
    timers: clock.timers,
  });
  return { factory, calls, network, gestures, clock, audio, updates };
}

describe("WebRTC Opus playback", () => {
  it("signals a recvonly offer, starts audible and applies dim safely", async () => {
    const { factory, calls, audio, updates } = setup();
    const session = factory({ channel: 1, onUpdate: (u) => updates.push(u) });
    await settle();

    const peer = FakePeerConnection.instances[0];
    expect(peer?.transceivers).toEqual([["audio", { direction: "recvonly" }]]);
    expect(calls[0]?.url).toBe(LISTEN_SESSIONS_PATH);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      channel: 1,
      offer: "offer-1",
    });
    expect(peer?.remoteDescription).toEqual({ type: "answer", sdp: "answer" });
    expect(FakeAudioContext.latest.options).toEqual({
      latencyHint: "interactive",
    });
    // Unmuted at the default −18 dB monitor level.
    expect(FakeAudioContext.latest.gain.gain.value).toBeCloseTo(0.1259, 4);

    peer?.deliverTrack();
    // The element only feeds Web Audio; it is never an audible path.
    expect(audio.muted).toBe(true);
    expect(FakeAudioContext.latest.sources[0]?.connect).toHaveBeenCalledWith(
      FakeAudioContext.latest.gain,
    );
    expect(updates.map(({ status }) => status)).toEqual([
      "connecting",
      "listening",
    ]);

    session.setDimmed(true);
    await session.setMuted(false);
    expect(FakeAudioContext.latest.gain.gain.value).toBeCloseTo(0.0316);
    expect(FakeAudioContext.latest.resume).toHaveBeenCalledOnce();
    session.setDimmed(false);
    session.setGainDb(6);
    expect(FakeAudioContext.latest.gain.gain.value).toBeCloseTo(1.995, 3);

    session.close();
    expect(peer?.close).toHaveBeenCalledOnce();
    expect(calls.at(-1)).toMatchObject({
      url: `${LISTEN_SESSIONS_PATH}/00000000-0000-4000-8000-000000000001`,
      init: { method: "DELETE", keepalive: true },
    });
  });

  it("says when the browser holds audio and starts it on the next touch", async () => {
    const { factory, gestures, updates } = setup();
    const session = factory({ channel: 0, onUpdate: (u) => updates.push(u) });
    await settle();
    FakePeerConnection.instances[0]?.deliverTrack();
    const context = FakeAudioContext.latest;

    // Without a gesture the context stays suspended after resume().
    await session.setMuted(false);
    expect(updates.at(-1)).toEqual({
      status: "listening",
      detail: "The browser is holding audio. Tap anywhere to start it.",
    });

    context.resume.mockImplementation(async () => {
      context.state = "running";
    });
    gestures.dispatchEvent(new Event("pointerdown"));
    await settle();
    expect(context.state).toBe("running");
    expect(updates.at(-1)).toEqual({
      status: "listening",
      detail: "Receiving input 1.",
    });

    session.close();
    context.resume.mockClear();
    context.state = "suspended";
    gestures.dispatchEvent(new Event("pointerdown"));
    expect(context.resume).not.toHaveBeenCalled();
  });

  it("switches input on the live session without renegotiating", async () => {
    const { factory, calls, updates } = setup();
    const session = factory({ channel: 0, onUpdate: (u) => updates.push(u) });
    await settle();
    FakePeerConnection.instances[0]?.deliverTrack();

    session.setChannel(3);
    await settle();

    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(calls.at(-1)).toMatchObject({
      url: `${LISTEN_SESSIONS_PATH}/00000000-0000-4000-8000-000000000001/channel`,
      init: { method: "PUT", body: JSON.stringify({ channel: 3 }) },
    });
    expect(updates.at(-1)).toEqual({
      status: "listening",
      detail: "Receiving input 4.",
    });
    session.close();
  });

  it("rides out a short Wi-Fi stall, then rebuilds a lost connection", async () => {
    const { factory, clock, network, updates } = setup();
    const session = factory({ channel: 0, onUpdate: (u) => updates.push(u) });
    await settle();
    const first = FakePeerConnection.instances[0];
    first?.deliverTrack();

    first?.setState("disconnected");
    expect(updates.at(-1)?.status).toBe("connecting");
    expect([...clock.pending.values()][0]?.ms).toBe(DISCONNECTED_GRACE_MS);
    first?.setState("connected");
    expect(clock.pending.size).toBe(0);
    expect(updates.at(-1)?.status).toBe("listening");

    first?.setState("failed");
    expect(first?.close).toHaveBeenCalledOnce();
    expect(updates.at(-1)).toEqual({
      status: "connecting",
      detail: "Audio connection lost; reconnecting.",
    });

    // Rejoining the network retries immediately rather than waiting out the backoff.
    network.dispatchEvent(new Event("online"));
    await settle();
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(FakePeerConnection.instances[1]?.remoteDescription).toEqual({
      type: "answer",
      sdp: "answer",
    });
    session.close();
  });

  it("retries while the node is not ready and stops on a refused offer", async () => {
    let status = 503;
    const { factory, clock, updates } = setup(
      () => new Response(null, { status }),
    );
    const session = factory({ channel: 0, onUpdate: (u) => updates.push(u) });
    await settle();
    expect(updates.at(-1)).toEqual({
      status: "connecting",
      detail: "Listen node is not ready. Retrying.",
    });

    status = 400;
    clock.runAll();
    await settle();
    expect(updates.at(-1)).toEqual({
      status: "error",
      detail: "Listen node refused the stream (HTTP 400).",
    });
    expect(clock.pending.size).toBe(0);
    session.close();
  });
});
