import type { FaultReport, LiveStateChannel } from "@rvlt/pulse-protocol/http";
import { formatClock } from "../alerts";
import type { OperatorRole } from "../operator";
import { faultSummary, reportStatusLine, type ReportAction } from "../reports";

/**
 * Every incoming report, on whatever the A2 is doing (design system §11.2.1).
 * Persistent until claimed or dismissed on this device; never covers a meter
 * and never plays a sound. Comms remains the authoritative urgent path.
 */
export function ReportBanner({
  reports,
  busy,
  onClaim,
  onShow,
  onDismiss,
}: {
  reports: readonly FaultReport[];
  busy: boolean;
  onClaim: (report: FaultReport) => void;
  onShow: (report: FaultReport) => void;
  onDismiss: (report: FaultReport) => void;
}) {
  if (reports.length === 0) return null;
  return (
    <section className="report-banner" aria-label="Fault reports from the A1">
      {reports.map((report) => (
        <div
          key={report.id}
          className={`report-banner-item ${report.urgent ? "is-urgent" : ""}`}
        >
          <div>
            <strong>
              {report.urgent ? "Urgent · " : ""}
              {report.channelNumber} · {report.channelName}
            </strong>
            <span>{faultSummary(report)}</span>
            <span className="mono">
              {report.requestedBy} · {formatClock(report.requestedAtUtc)}
              {report.incident ? " · incident" : ""}
            </span>
          </div>
          <div className="report-banner-actions">
            <button
              type="button"
              className="control-button claim-button"
              disabled={busy}
              onClick={() => onClaim(report)}
            >
              Claim
            </button>
            <button
              type="button"
              className="line-button"
              onClick={() => onShow(report)}
            >
              Details
            </button>
            <button
              type="button"
              className="line-button"
              aria-label={`Dismiss the banner for ${report.channelName}`}
              onClick={() => onDismiss(report)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

/** Reports with the actions the operator's role may take on each. */
export function ReportList({
  reports,
  role,
  busy,
  onAction,
}: {
  reports: readonly FaultReport[];
  role: OperatorRole;
  busy: boolean;
  onAction: (report: FaultReport, action: ReportAction) => void;
}) {
  return (
    <ul className="report-list">
      {reports.map((report) => {
        const actions: Array<[ReportAction, string]> =
          role === "A2"
            ? report.status === "open"
              ? [
                  ["claim", "Claim"],
                  ["resolve", "Mark fixed"],
                ]
              : report.status === "claimed"
                ? [["resolve", "Mark fixed"]]
                : []
            : report.status === "awaiting-confirmation"
              ? [
                  ["confirm-fixed", "Confirm fixed"],
                  ["reopen", "Still hearing it"],
                ]
              : report.status === "open" || report.status === "claimed"
                ? report.urgent
                  ? []
                  : [["urgent", "Mark urgent"]]
                : [];
        return (
          <li
            key={report.id}
            className={`report-row report-row-${report.status} ${report.urgent ? "is-urgent" : ""}`}
          >
            <div>
              <strong>
                {report.channelNumber} · {report.channelName}
                {report.incident ? (
                  <span className="report-kind">Incident</span>
                ) : (
                  <span className="report-kind">Task</span>
                )}
              </strong>
              <span>{faultSummary(report)}</span>
              <span className="mono">
                {report.requestedBy} · {formatClock(report.requestedAtUtc)} ·{" "}
                {reportStatusLine(report)}
              </span>
            </div>
            {actions.length ? (
              <div className="report-row-actions">
                {actions.map(([action, label]) => (
                  <button
                    key={action}
                    type="button"
                    className="line-button"
                    disabled={busy}
                    onClick={() => onAction(report, action)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The A1's bottom bar (design system §11.2): their open reports and who has
 * them, plus the one verdict the A1 owns in a mic check — whether the
 * captured audio reaches the desk. There is no listen control here.
 */
export function A1Bar({
  reports,
  awaitingAudioCheck,
  busy,
  onAction,
  onAudioVerdict,
}: {
  reports: readonly FaultReport[];
  awaitingAudioCheck: readonly LiveStateChannel[];
  busy: boolean;
  onAction: (report: FaultReport, action: ReportAction) => void;
  onAudioVerdict: (channel: LiveStateChannel, pass: boolean) => void;
}) {
  return (
    <footer className="a1-bar" aria-label="Your reports and check requests">
      {awaitingAudioCheck.length ? (
        <div className="a1-check-prompts">
          {awaitingAudioCheck.map((channel) => (
            <div key={channel.id} className="a1-check-prompt">
              <span>
                Captured audio on{" "}
                <strong>
                  {channel.number} · {channel.name}
                </strong>
                ? Check it on the console.
              </span>
              <button
                type="button"
                className="check-fail"
                disabled={busy}
                onClick={() => onAudioVerdict(channel, false)}
              >
                A1 fail
              </button>
              <button
                type="button"
                className="check-pass"
                disabled={busy}
                onClick={() => onAudioVerdict(channel, true)}
              >
                A1 pass
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {reports.length ? (
        <ReportList
          reports={reports}
          role="A1"
          busy={busy}
          onAction={onAction}
        />
      ) : (
        <p className="a1-bar-empty">
          No open reports. Press a channel to report what you hear.
        </p>
      )}
    </footer>
  );
}
