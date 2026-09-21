import { useEffect, useState } from "react";
import { parseShowfile, type Showfile } from "@rvlt/pulse-protocol/http";

export function useShowfile(refreshMs = 2000): Showfile | null {
  const [showfile, setShowfile] = useState<Showfile | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    async function poll() {
      try {
        const response = await fetch("/api/v1/showfile", {
          signal: controller.signal,
        });
        if (response.ok) setShowfile(parseShowfile(await response.json()));
      } catch {
        // Audio remains usable with observed fallback names when Manager is offline.
      } finally {
        if (!controller.signal.aborted) {
          timer = window.setTimeout(poll, refreshMs);
        }
      }
    }
    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refreshMs]);

  return showfile;
}
