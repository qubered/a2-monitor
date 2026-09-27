import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/** DESIGN.md §8.1.7: an audio-changing gesture needs a deliberate press, not
 * just a bigger target. 550ms is long enough to rule out an accidental tap. */
const LONG_PRESS_MS = 550;
/** A press that drifts this far is a scroll or a drag, not a hold. */
const MOVE_CANCEL_PX = 10;

/**
 * Fires `onLongPress` after a sustained touch or pen press, ignoring mouse
 * (which already has Shift/Ctrl for the same purpose) and any press that
 * moves or lifts early. `fired` is exposed so the caller's click handler can
 * skip the click that immediately follows a fired long-press — the browser
 * dispatches both for the same touch.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  function clear() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }

  return {
    /** True if a long-press just fired; reading it also resets it, since the
     * browser follows that press with a click the caller should now ignore. */
    consumeFired(): boolean {
      const value = fired.current;
      fired.current = false;
      return value;
    },
    handlers: {
      onPointerDown(event: ReactPointerEvent) {
        if (event.pointerType === "mouse") return;
        start.current = { x: event.clientX, y: event.clientY };
        fired.current = false;
        timer.current = window.setTimeout(() => {
          timer.current = null;
          fired.current = true;
          onLongPress();
        }, LONG_PRESS_MS);
      },
      onPointerMove(event: ReactPointerEvent) {
        if (!start.current) return;
        const dx = event.clientX - start.current.x;
        const dy = event.clientY - start.current.y;
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
    },
  };
}
