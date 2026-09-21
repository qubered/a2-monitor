import { useEffect, useState } from "react";
import type { AudioDeviceSource, AudioDeviceState } from "./audio-device";

export type AudioDeviceViewState =
  | { status: "waiting"; device: null; message: string }
  | { status: "ready"; device: AudioDeviceState; message: string }
  | { status: "unavailable" | "error"; device: null; message: string };

export function useAudioDevice(source: AudioDeviceSource, refreshMs = 2000) {
  const [state, setState] = useState<AudioDeviceViewState>({
    status: "waiting",
    device: null,
    message: "Waiting for the audio node.",
  });

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    async function poll() {
      try {
        const next = await source.load(controller.signal);
        if (controller.signal.aborted) return;
        setState(
          next.status === "ready"
            ? { status: "ready", device: next, message: next.detail }
            : {
                status: "unavailable",
                device: null,
                message: next.detail,
              },
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          device: null,
          message:
            error instanceof Error
              ? error.message
              : "Audio device state could not be read.",
        });
      } finally {
        if (!controller.signal.aborted)
          timer = window.setTimeout(poll, refreshMs);
      }
    }

    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refreshMs, source]);

  return state;
}
