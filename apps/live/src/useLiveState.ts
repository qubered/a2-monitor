import { useCallback, useEffect, useState } from "react";
import type { LiveState } from "@rvlt/pulse-protocol/http";
import type { LiveStateConnection, LiveStateSource } from "./live-state";

export type LiveStateView = {
  connection: LiveStateConnection;
  state: LiveState | null;
  /** Apply a newer state returned by a command, such as an acknowledgement. */
  apply: (state: LiveState) => void;
};

export function useLiveState(source: LiveStateSource): LiveStateView {
  const [connection, setConnection] =
    useState<LiveStateConnection>("connecting");
  const [state, setState] = useState<LiveState | null>(null);

  const apply = useCallback((next: LiveState) => {
    setState((current) =>
      current && current.revision > next.revision ? current : next,
    );
  }, []);

  useEffect(
    () => source.subscribe({ onState: apply, onConnection: setConnection }),
    [apply, source],
  );

  return { connection, state, apply };
}
