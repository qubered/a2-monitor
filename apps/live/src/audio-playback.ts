export type PlaybackState = "idle" | "connecting" | "listening" | "error";

export type PlaybackUpdate = {
  status: PlaybackState;
  detail: string;
};

export interface PlaybackSession {
  setChannel(channel: number): void;
  setMuted(muted: boolean): Promise<void>;
  setDimmed(dimmed: boolean): void;
  setGainDb(gainDb: number): void;
  close(): void;
}

export const MIN_MONITOR_GAIN_DB = -60;
export const MAX_MONITOR_GAIN_DB = 12;
export const DEFAULT_MONITOR_GAIN_DB = -18;
export const DIM_ATTENUATION_DB = -12;

/** Retry spacing after a lost connection, e.g. a Wi-Fi roam or a sleeping phone. */
export const RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;
/** ICE `disconnected` often recovers on its own after a short Wi-Fi stall. */
export const DISCONNECTED_GRACE_MS = 2_000;

export const LISTEN_SESSIONS_PATH = "/audio/v0/listen/sessions";

export function clampMonitorGainDb(value: number): number {
  return Math.min(MAX_MONITOR_GAIN_DB, Math.max(MIN_MONITOR_GAIN_DB, value));
}

export type PlaybackFactory = (options: {
  channel: number;
  onUpdate: (update: PlaybackUpdate) => void;
}) => PlaybackSession;

type AudioContextConstructor = new (
  options?: AudioContextOptions,
) => AudioContext;

type Timers = {
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
};

type Dependencies = {
  AudioContext?: AudioContextConstructor;
  RTCPeerConnection?: typeof RTCPeerConnection;
  MediaStream?: typeof MediaStream;
  fetch?: typeof fetch;
  createAudioElement?: () => HTMLAudioElement;
  network?: EventTarget;
  /** Where a touch or key press can start held browser audio. */
  gestureTarget?: EventTarget;
  timers?: Timers;
};

class SignalingError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

async function postOffer(
  fetchImpl: typeof fetch,
  channel: number,
  offer: string,
): Promise<{ sessionId: string; answer: string }> {
  let response: Response;
  try {
    response = await fetchImpl(LISTEN_SESSIONS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, offer }),
    });
  } catch {
    throw new SignalingError(0, true, "Listen node is unreachable.");
  }
  if (response.status === 503) {
    throw new SignalingError(503, true, "Listen node is not ready.");
  }
  if (!response.ok) {
    throw new SignalingError(
      response.status,
      false,
      `Listen node refused the stream (HTTP ${response.status}).`,
    );
  }
  const body = (await response.json()) as unknown;
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { sessionId?: unknown }).sessionId !== "string" ||
    typeof (body as { answer?: unknown }).answer !== "string"
  ) {
    throw new SignalingError(response.status, false, "Answer is invalid.");
  }
  return body as { sessionId: string; answer: string };
}

/**
 * Plays one node-encoded Opus stream over WebRTC. The peer connection is kept across
 * input changes (the node switches and crossfades server-side) and rebuilt with backoff
 * when the network path is lost. The browser's adaptive jitter buffer is left at its
 * default minimum: it shrinks toward the network's real jitter on a quiet wired link and
 * grows under Wi-Fi contention instead of concealing constant underruns.
 */
export function createWebRtcPlaybackFactory(
  dependencies?: Dependencies,
): PlaybackFactory {
  return ({ channel: initialChannel, onUpdate }) => {
    const AudioContextClass =
      dependencies?.AudioContext ??
      (window.AudioContext as unknown as AudioContextConstructor);
    const PeerConnection =
      dependencies?.RTCPeerConnection ?? window.RTCPeerConnection;
    const MediaStreamClass = dependencies?.MediaStream ?? window.MediaStream;
    const fetchImpl = dependencies?.fetch ?? window.fetch.bind(window);
    const createAudioElement =
      dependencies?.createAudioElement ?? (() => new Audio());
    const network = dependencies?.network ?? window;
    const timers: Timers = dependencies?.timers ?? {
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (handle) => window.clearTimeout(handle),
    };

    const context = new AudioContextClass({ latencyHint: "interactive" });
    const gain = context.createGain();
    gain.connect(context.destination);

    let channel = initialChannel;
    // Listening starts audible; mute and dim stay one touch away (DESIGN.md §2.7).
    let muted = false;
    let dimmed = false;
    let gainDb = DEFAULT_MONITOR_GAIN_DB;
    let closed = false;
    let generation = 0;
    let attempt = 0;
    let peer: RTCPeerConnection | undefined;
    let sessionId: string | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let sink: HTMLAudioElement | undefined;
    let retryTimer: number | undefined;
    let graceTimer: number | undefined;
    let listening = false;

    function applyGain() {
      const effectiveGainDb = gainDb + (dimmed ? DIM_ATTENUATION_DB : 0);
      gain.gain.value = muted ? 0 : 10 ** (effectiveGainDb / 20);
    }

    applyGain();

    let lastStatus: PlaybackState = "idle";
    let lastDetail = "";
    function update(status: PlaybackState, detail: string) {
      listening = status === "listening";
      lastStatus = status;
      lastDetail = detail;
      if (!closed) onUpdate({ status, detail });
    }

    /**
     * Browsers hold audio output until the page is touched. When a resume is
     * refused, the next touch or key press anywhere starts it, and the status
     * says so until then rather than claiming the operator can hear anything.
     */
    const AUDIO_HELD =
      "The browser is holding audio. Tap anywhere to start it.";
    let heldDetail: string | undefined;
    const gestureTarget = dependencies?.gestureTarget ?? window.document;
    const onGesture = () => {
      if (closed || muted || context.state === "running") return;
      void context.resume().then(
        () => {
          if (heldDetail === undefined || context.state !== "running") return;
          const previous = heldDetail;
          heldDetail = undefined;
          if (lastDetail === AUDIO_HELD) update(lastStatus, previous);
        },
        () => undefined,
      );
    };
    for (const type of ["pointerdown", "keydown"] as const) {
      gestureTarget.addEventListener(type, onGesture, true);
    }
    // A function, so TypeScript does not narrow the state across the await.
    const running = () => context.state === "running";
    async function startOutput() {
      if (muted || running()) return;
      try {
        await context.resume();
      } catch {
        // Held until a gesture; reported below.
      }
      if (!closed && !muted && !running() && heldDetail === undefined) {
        heldDetail = lastDetail;
        update(lastStatus, AUDIO_HELD);
      }
    }

    /** Moves the live session to `channel`; the node crossfades, no renegotiation. */
    function pushChannel() {
      const target = sessionId;
      if (target === undefined) return;
      const requested = channel;
      void fetchImpl(`${LISTEN_SESSIONS_PATH}/${target}/channel`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: requested }),
      })
        .then((response) => {
          if (target !== sessionId) return;
          if (!response.ok) {
            scheduleReconnect("Audio session expired; reconnecting.");
          } else if (listening && requested === channel) {
            update("listening", `Receiving input ${channel + 1}.`);
          }
        })
        .catch(() => {
          if (target === sessionId) {
            scheduleReconnect("Listen node is unreachable; reconnecting.");
          }
        });
    }

    function releaseSession() {
      if (sessionId === undefined) return;
      void fetchImpl(`${LISTEN_SESSIONS_PATH}/${sessionId}`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => undefined);
      sessionId = undefined;
    }

    function teardown() {
      generation += 1;
      if (graceTimer !== undefined) timers.clearTimeout(graceTimer);
      graceTimer = undefined;
      source?.disconnect();
      source = undefined;
      if (sink) sink.srcObject = null;
      sink = undefined;
      if (peer) {
        peer.ontrack = null;
        peer.onconnectionstatechange = null;
        peer.close();
      }
      peer = undefined;
      releaseSession();
    }

    function scheduleReconnect(detail: string) {
      if (closed || retryTimer !== undefined) return;
      teardown();
      const delay =
        RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
      attempt += 1;
      update("connecting", detail);
      retryTimer = timers.setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, delay ?? 4_000);
    }

    function attachTrack(track: MediaStreamTrack) {
      const stream = new MediaStreamClass([track]);
      // Chromium only pulls remote WebRTC audio into Web Audio while a media element
      // also consumes the stream. The element stays muted; the gain node is the only
      // audible path, so mute and dim remain authoritative.
      sink = createAudioElement();
      sink.muted = true;
      sink.srcObject = stream;
      void sink.play().catch(() => undefined);
      source = context.createMediaStreamSource(stream);
      source.connect(gain);
      const markListening = () => {
        attempt = 0;
        update("listening", `Receiving input ${channel + 1}.`);
      };
      if (!track.muted) markListening();
      else track.addEventListener("unmute", markListening, { once: true });
    }

    async function connect() {
      if (closed) return;
      const current = ++generation;
      update("connecting", `Connecting to input ${channel + 1}.`);
      const connection = new PeerConnection({
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
      });
      peer = connection;
      connection.addTransceiver("audio", { direction: "recvonly" });
      connection.ontrack = (event) => {
        if (current === generation) attachTrack(event.track);
      };
      connection.onconnectionstatechange = () => {
        if (current !== generation) return;
        const state = connection.connectionState;
        if (state === "connected") {
          if (graceTimer === undefined) return;
          // Recovered from a brief stall without rebuilding the connection.
          timers.clearTimeout(graceTimer);
          graceTimer = undefined;
          if (source) update("listening", `Receiving input ${channel + 1}.`);
        } else if (state === "failed") {
          scheduleReconnect("Audio connection lost; reconnecting.");
        } else if (state === "disconnected" && graceTimer === undefined) {
          update("connecting", "Audio connection interrupted; waiting.");
          graceTimer = timers.setTimeout(() => {
            graceTimer = undefined;
            if (current === generation) {
              scheduleReconnect("Audio connection lost; reconnecting.");
            }
          }, DISCONNECTED_GRACE_MS);
        }
      };

      try {
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        const offerSdp = connection.localDescription?.sdp ?? offer.sdp ?? "";
        const requested = channel;
        const signaled = await postOffer(fetchImpl, requested, offerSdp);
        if (current !== generation) {
          // Superseded while signaling; release the node-side session at once.
          void fetchImpl(`${LISTEN_SESSIONS_PATH}/${signaled.sessionId}`, {
            method: "DELETE",
            keepalive: true,
          }).catch(() => undefined);
          return;
        }
        sessionId = signaled.sessionId;
        await connection.setRemoteDescription({
          type: "answer",
          sdp: signaled.answer,
        });
        // The operator picked another input while the offer was in flight.
        if (channel !== requested) pushChannel();
      } catch (error) {
        if (current !== generation) return;
        if (error instanceof SignalingError && !error.retryable) {
          teardown();
          update("error", error.message);
          return;
        }
        scheduleReconnect(
          error instanceof SignalingError
            ? `${error.message} Retrying.`
            : "Audio connection could not be set up; retrying.",
        );
      }
    }

    // A network change (Wi-Fi rejoin, interface up) is the best moment to retry.
    const onOnline = () => {
      if (closed || retryTimer === undefined) return;
      timers.clearTimeout(retryTimer);
      retryTimer = undefined;
      attempt = 0;
      void connect();
    };
    network.addEventListener("online", onOnline);

    void connect();

    return {
      setChannel(nextChannel) {
        if (nextChannel === channel) return;
        channel = nextChannel;
        pushChannel();
      },
      async setMuted(nextMuted) {
        muted = nextMuted;
        applyGain();
        await startOutput();
      },
      setDimmed(nextDimmed) {
        dimmed = nextDimmed;
        applyGain();
      },
      setGainDb(nextGainDb) {
        gainDb = clampMonitorGainDb(nextGainDb);
        applyGain();
      },
      close() {
        closed = true;
        network.removeEventListener("online", onOnline);
        for (const type of ["pointerdown", "keydown"] as const) {
          gestureTarget.removeEventListener(type, onGesture, true);
        }
        if (retryTimer !== undefined) timers.clearTimeout(retryTimer);
        retryTimer = undefined;
        teardown();
        gain.disconnect();
        void context.close();
      },
    };
  };
}

export const webRtcPlaybackFactory = createWebRtcPlaybackFactory();
