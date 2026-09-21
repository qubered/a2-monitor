import { useEffect, useState } from "react";
import {
  parseShureTelemetry,
  type ShureTelemetry,
} from "@rvlt/pulse-protocol/http";

export function useShureTelemetry(refreshMs = 2000): ShureTelemetry | null {
  const [telemetry, setTelemetry] = useState<ShureTelemetry | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    async function poll() {
      try {
        const response = await fetch("/audio/v0/shure", {
          signal: controller.signal,
        });
        if (response.ok)
          setTelemetry(parseShureTelemetry(await response.json()));
      } catch {
        // Listening remains independent when receiver telemetry is unavailable.
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
  }, [refreshMs]);

  return telemetry;
}
