export type PlaybackState = "idle" | "connecting" | "listening" | "error";

export type PlaybackUpdate = {
  status: PlaybackState;
  detail: string;
};

export interface PlaybackSession {
  setMuted(muted: boolean): Promise<void>;
  setDimmed(dimmed: boolean): void;
  setGainDb(gainDb: number): void;
  close(): void;
}

export const MIN_MONITOR_GAIN_DB = -60;
export const MAX_MONITOR_GAIN_DB = 12;
export const DEFAULT_MONITOR_GAIN_DB = -18;
export const DIM_ATTENUATION_DB = -12;

export function clampMonitorGainDb(value: number): number {
  return Math.min(MAX_MONITOR_GAIN_DB, Math.max(MIN_MONITOR_GAIN_DB, value));
}

export type PlaybackFactory = (options: {
  channel: number;
  sampleRateHz: number;
  onUpdate: (update: PlaybackUpdate) => void;
}) => PlaybackSession;

type AudioContextConstructor = new (
  options?: AudioContextOptions,
) => AudioContext;

/**
 * Asks for a context at the node's sample rate so the browser resamples to
 * whatever the output hardware runs at (44.1 kHz on many Macs). Only when the
 * browser refuses that rate does playback fall back to the default context,
 * where a mismatch is reported instead of played at the wrong speed.
 */
function openContext(
  AudioContextClass: AudioContextConstructor,
  sampleRateHz: number,
): AudioContext {
  try {
    return new AudioContextClass({
      sampleRate: sampleRateHz,
      latencyHint: "interactive",
    });
  } catch {
    return new AudioContextClass();
  }
}

export function websocketListenUrl(
  channel: number,
  location = window.location,
) {
  const url = new URL(location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/audio/v0/listen";
  url.search = new URLSearchParams({ channel: String(channel) }).toString();
  url.hash = "";
  return url.toString();
}

export function createWebAudioPlaybackFactory(dependencies?: {
  AudioContext?: AudioContextConstructor;
  WebSocket?: typeof WebSocket;
  queueCapSamples?: number;
}): PlaybackFactory {
  return ({ channel, sampleRateHz, onUpdate }) => {
    const AudioContextClass =
      dependencies?.AudioContext ??
      (window.AudioContext as unknown as AudioContextConstructor);
    const WebSocketClass = dependencies?.WebSocket ?? window.WebSocket;
    const queueCap = dependencies?.queueCapSamples ?? sampleRateHz / 4;
    const context = openContext(AudioContextClass, sampleRateHz);
    const gain = context.createGain();
    const processor = context.createScriptProcessor(1024, 0, 1);
    const queue: Float32Array[] = [];
    let queuedSamples = 0;
    let muted = true;
    let dimmed = false;
    let gainDb = DEFAULT_MONITOR_GAIN_DB;
    let closed = false;
    let failed = false;
    let receivedAudio = false;

    const socket = new WebSocketClass(websocketListenUrl(channel));
    socket.binaryType = "arraybuffer";
    gain.gain.value = 0;
    processor.connect(gain);
    gain.connect(context.destination);

    function applyGain() {
      const effectiveGainDb = gainDb + (dimmed ? DIM_ATTENUATION_DB : 0);
      gain.gain.value = muted ? 0 : 10 ** (effectiveGainDb / 20);
    }

    function fail(detail: string) {
      // A session the caller already closed must never overwrite the state
      // of the session that replaced it, and the first, specific reason is
      // never replaced by the socket error its own shutdown causes.
      if (closed || failed) return;
      failed = true;
      onUpdate({ status: "error", detail });
      socket.close();
    }

    if (context.sampleRate !== sampleRateHz) {
      fail(
        `Device is ${sampleRateHz} Hz but browser output is ${context.sampleRate} Hz. Listening is stopped.`,
      );
    } else {
      onUpdate({
        status: "connecting",
        detail: `Connecting to input ${channel + 1}.`,
      });
    }

    socket.onopen = () => {
      if (!closed && context.sampleRate === sampleRateHz) {
        onUpdate({
          status: "connecting",
          detail: "Connected; waiting for audio.",
        });
      }
    };
    socket.onerror = () => fail("Audio stream connection failed.");
    socket.onclose = () => {
      if (!closed && !failed && context.sampleRate === sampleRateHz) {
        onUpdate({ status: "error", detail: "Audio stream disconnected." });
      }
    };
    socket.onmessage = (event) => {
      if (closed || !(event.data instanceof ArrayBuffer)) return;
      const view = new DataView(event.data);
      const samples = new Float32Array(Math.floor(view.byteLength / 4));
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = view.getFloat32(index * 4, true);
      }
      if (samples.length === 0) return;
      if (!receivedAudio) {
        receivedAudio = true;
        onUpdate({
          status: "listening",
          detail: `Receiving input ${channel + 1}.`,
        });
      }
      if (samples.length > queueCap) {
        queue.length = 0;
        const tail = samples.slice(samples.length - queueCap);
        queue.push(tail);
        queuedSamples = tail.length;
        return;
      }
      while (queuedSamples + samples.length > queueCap && queue.length > 0) {
        queuedSamples -= queue.shift()?.length ?? 0;
      }
      queue.push(samples);
      queuedSamples += samples.length;
    };
    processor.onaudioprocess = (event) => {
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);
      let position = 0;
      while (position < output.length && queue.length > 0) {
        const head = queue[0];
        if (!head) break;
        const count = Math.min(head.length, output.length - position);
        output.set(head.subarray(0, count), position);
        position += count;
        queuedSamples -= count;
        if (count === head.length) queue.shift();
        else queue[0] = head.subarray(count);
      }
    };

    return {
      async setMuted(nextMuted) {
        muted = nextMuted;
        applyGain();
        if (!muted && context.state !== "running") {
          try {
            await context.resume();
          } catch {
            muted = true;
            applyGain();
            onUpdate({
              status: "error",
              detail: "Browser audio output could not be started.",
            });
          }
        }
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
        socket.close();
        processor.disconnect();
        gain.disconnect();
        void context.close();
      },
    };
  };
}

export const webAudioPlaybackFactory = createWebAudioPlaybackFactory();
