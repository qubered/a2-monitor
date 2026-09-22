/**
 * One requestAnimationFrame per tick, shared by every mounted trace/timeline
 * canvas, so redrawing N lanes in response to a data update never costs N
 * frames. Traces are not animated (Pulse redraws at data rate, not on a
 * loop — see design system §6), so this schedules a single redraw per
 * requested update rather than a continuous render loop.
 */
type RedrawFn = () => void;

let frameScheduled = false;
const pendingRedraws = new Set<RedrawFn>();

function flush(): void {
  frameScheduled = false;
  const batch = [...pendingRedraws];
  pendingRedraws.clear();
  for (const redraw of batch) redraw();
}

export function scheduleTraceRedraw(redraw: RedrawFn): () => void {
  pendingRedraws.add(redraw);
  if (!frameScheduled) {
    frameScheduled = true;
    requestAnimationFrame(flush);
  }
  return () => {
    pendingRedraws.delete(redraw);
  };
}
