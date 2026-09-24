import { formatClock } from "../alerts";
import {
  formatStartMinute,
  sessionById,
  type SessionState,
  type TurnoverItem,
} from "../sessions";

type SessionBarProps = {
  session: SessionState;
  turnover: readonly TurnoverItem[];
  offline: boolean;
  onOpen: () => void;
};

/**
 * The run of show at a glance: what is on now, what is next and how much the
 * turnover still needs. Starting a session happens in the sheet, after the
 * turnover list, never from a single press here.
 */
export function SessionBar({
  session,
  turnover,
  offline,
  onOpen,
}: SessionBarProps) {
  const active = sessionById(session, session.activeId);
  const next = sessionById(session, session.nextId);
  const toPrepare = turnover.filter(({ tone }) => tone !== "ready").length;
  const nextStart = formatStartMinute(next?.startMinute ?? null);

  return (
    <section className="session-bar" aria-label="Run of show">
      <div className="session-slot">
        <span className="session-overline">Now</span>
        <strong>
          {offline ? "Unknown" : (active?.name ?? "No session running")}
        </strong>
        <span className="session-meta">
          {offline
            ? "The backend is unreachable."
            : active && session.startedAtUtc
              ? `Started ${formatClock(session.startedAtUtc)}${session.startedBy ? ` by ${session.startedBy}` : ""}`
              : `${session.sessions.length} session${session.sessions.length === 1 ? "" : "s"} in the run of show`}
        </span>
      </div>
      <div className="session-slot">
        <span className="session-overline">
          Next{nextStart ? ` · ${nextStart}` : ""}
        </span>
        <strong>{next?.name ?? "End of the run of show"}</strong>
        {next && !offline ? (
          <span
            className={`session-meta ${toPrepare ? "is-action" : "is-ready"}`}
          >
            {toPrepare
              ? `${toPrepare} of ${turnover.length} channel${turnover.length === 1 ? "" : "s"} to prepare`
              : `${turnover.length} channel${turnover.length === 1 ? "" : "s"} ready`}
          </span>
        ) : null}
      </div>
      <button
        className="line-button session-open"
        type="button"
        onClick={onOpen}
        disabled={offline}
      >
        {next ? "Turnover" : "Run of show"}
      </button>
    </section>
  );
}
