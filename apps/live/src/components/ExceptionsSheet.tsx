import type {
  FaultReport,
  LiveAlert,
  LiveState,
} from "@rvlt/pulse-protocol/http";
import { alertScope, byUrgency, formatClock, formatDuration } from "../alerts";
import { isActiveReport, type ReportAction } from "../reports";
import { AlertIcon } from "./ChannelCard";
import { ReportList } from "./Reports";

type ExceptionsSheetProps = {
  state: LiveState;
  history: readonly LiveAlert[] | null;
  nowMs: number;
  onAcknowledge: (alert: LiveAlert) => void;
  onShowChannel: (channelId: string) => void;
  onReportAction?: (report: FaultReport, action: ReportAction) => void;
  busy?: boolean;
  onClose: () => void;
};

/**
 * Show-wide exceptions (design system §10.8): every active alert across the
 * show, including channels outside the current filter and system faults
 * that belong to no card, plus what cleared recently.
 */
export function ExceptionsSheet({
  state,
  history,
  nowMs,
  onAcknowledge,
  onShowChannel,
  onReportAction,
  busy = false,
  onClose,
}: ExceptionsSheetProps) {
  const active = [...state.alerts].sort(byUrgency);
  const reports = state.reports.filter(isActiveReport);
  const cleared = (history ?? []).slice(0, 12);

  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="detail-panel exceptions-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exceptions-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="detail-overline">
              {state.summary.outstanding} to acknowledge ·{" "}
              {state.summary.active} active
            </span>
            <h2 id="exceptions-title">Exceptions</h2>
            <p>Every active alert across the show, most urgent first.</p>
          </div>
          <button
            className="line-button"
            type="button"
            onClick={onClose}
            autoFocus
          >
            Close
          </button>
        </header>

        {reports.length && onReportAction ? (
          <section className="detail-alerts" aria-label="Open fault reports">
            <h3>Fault reports</h3>
            <ReportList
              reports={reports}
              role="A2"
              busy={busy}
              onAction={onReportAction}
            />
          </section>
        ) : null}

        {active.length === 0 ? (
          <p className="exceptions-empty">
            No active alerts. Channels without monitoring armed are not
            evaluated.
          </p>
        ) : (
          <ul className="exceptions-list">
            {active.map((alert) => (
              <li
                key={alert.id}
                className={`exception exception-${alert.severity} ${alert.acknowledgedAtUtc ? "is-acknowledged" : ""}`}
              >
                <span className="exception-icon">
                  <AlertIcon dimension={alert.dimension} />
                </span>
                <div className="exception-body">
                  <strong>
                    {alert.label}
                    <span className="exception-scope">{alertScope(alert)}</span>
                  </strong>
                  <span>{alert.detail}</span>
                  <span className="mono">
                    {alert.severity === "critical" ? "Critical" : "Caution"} ·
                    raised {formatClock(alert.raisedAtUtc)} · for{" "}
                    {formatDuration(nowMs - Date.parse(alert.raisedAtUtc))}
                    {alert.acknowledgedAtUtc
                      ? ` · seen by ${alert.acknowledgedBy ?? "unknown"} at ${formatClock(alert.acknowledgedAtUtc)}`
                      : ""}
                  </span>
                </div>
                <div className="exception-actions">
                  {alert.channelId ? (
                    <button
                      type="button"
                      className="line-button"
                      onClick={() => onShowChannel(alert.channelId!)}
                    >
                      Details
                    </button>
                  ) : null}
                  {alert.acknowledgedAtUtc ? null : (
                    <button
                      type="button"
                      className="line-button acknowledge-button"
                      onClick={() => onAcknowledge(alert)}
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <section className="detail-alerts" aria-label="Recently cleared alerts">
          <h3>Recently cleared</h3>
          {history === null ? (
            <p className="exceptions-empty">Loading the alert log.</p>
          ) : cleared.length === 0 ? (
            <p className="exceptions-empty">Nothing has cleared yet.</p>
          ) : (
            <ul className="cleared-list">
              {cleared.map((alert) => (
                <li key={alert.id}>
                  <span className="mono">
                    {formatClock(alert.raisedAtUtc)}–
                    {formatClock(alert.clearedAtUtc ?? alert.raisedAtUtc)}
                  </span>
                  <span>
                    {alert.label} · {alertScope(alert)}
                  </span>
                  <span className="cleared-seen">
                    {alert.acknowledgedAtUtc
                      ? `Seen by ${alert.acknowledgedBy ?? "unknown"}`
                      : "Never acknowledged"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </div>
  );
}
