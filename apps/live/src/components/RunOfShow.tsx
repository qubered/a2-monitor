import { useId, useState, type ReactNode } from "react";

type RunOfShowProps = {
  /** One line that stays visible while the rows are hidden. */
  summary: string;
  /** Whether the summary needs someone; it takes the caution tone. */
  needsAttention: boolean;
  children: ReactNode;
};

const STORAGE_KEY = "pulse-run-of-show-open";

/**
 * The run-of-show rows behind one disclosure, so an A2 who does not run
 * turnovers can hide them. Open by default; the choice is per device. The
 * summary keeps "channels to prepare" visible when the rows are hidden.
 */
export function RunOfShow({
  summary,
  needsAttention,
  children,
}: RunOfShowProps) {
  const bodyId = useId();
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "open" : "closed");
    } catch {
      // The choice is a per-device convenience.
    }
  };

  return (
    <div className="run-of-show">
      <button
        className="run-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        <span className="run-toggle-label">Run of show</span>
        <span
          className={`run-toggle-summary ${needsAttention ? "is-action" : ""}`}
        >
          {summary}
        </span>
      </button>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
