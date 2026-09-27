type SelectionBarProps = {
  count: number;
  /** On, once a long-press has turned every following tap into a toggle. */
  touchSelecting: boolean;
  onDone: () => void;
  onClear: () => void;
};

/**
 * Feedback while several channels are being monitored at once: Shift-click
 * (or Shift-Enter on a focused card) extends a range on a computer, Ctrl/Cmd
 * click toggles one card, and a long-press then tap does the same on touch
 * (DESIGN.md §8). `touchSelecting` names that touch mode explicitly, since
 * there is no held modifier key to show it is on.
 */
export function SelectionBar({
  count,
  touchSelecting,
  onDone,
  onClear,
}: SelectionBarProps) {
  // One channel is just what the player shows; the bar is for several
  // (DESIGN.md §8.4) and for the touch mode that picks them.
  if (count < 2 && !touchSelecting) return null;
  return (
    <section className="selection-bar" aria-live="polite">
      <span>
        {count === 0
          ? "Tap channels to monitor them together."
          : `${count} channel${count === 1 ? "" : "s"} monitored together.`}
      </span>
      <div className="selection-bar-actions">
        {touchSelecting ? (
          <button type="button" className="control-button" onClick={onDone}>
            Done
          </button>
        ) : null}
        {count > 0 ? (
          <button
            type="button"
            className="line-button"
            onClick={onClear}
            aria-label="Stop monitoring every selected channel"
          >
            Clear
          </button>
        ) : null}
      </div>
    </section>
  );
}
