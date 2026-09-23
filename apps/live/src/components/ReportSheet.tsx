import { useState } from "react";
import type {
  FaultReport,
  LiveStateChannel,
  ReportedFault,
} from "@rvlt/pulse-protocol/http";
import { formatClock } from "../alerts";
import {
  FAULT_LABELS,
  faultSummary,
  isActiveReport,
  reportStatusLine,
  type ReportAction,
} from "../reports";

type ReportSheetProps = {
  channel: LiveStateChannel;
  /** The report this sheet filed, kept current from the shared state. */
  report: FaultReport | null;
  nowMs: number;
  busy: boolean;
  error: string | null;
  onSend: (faults: ReportedFault[], note: string | null) => void;
  onAction: (report: FaultReport, action: ReportAction) => void;
  onClose: () => void;
};

function Tick() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5 6.4 12 13 4.5" />
    </svg>
  );
}

/**
 * The A1's report sheet (design system §11.2): press what is wrong — as many
 * as apply — and send. Two presses, no typing. After sending it shows what
 * went, who has it, a short undo, and the urgent follow-up.
 */
export function ReportSheet({
  channel,
  report,
  nowMs,
  busy,
  error,
  onSend,
  onAction,
  onClose,
}: ReportSheetProps) {
  const [selected, setSelected] = useState<ReportedFault[]>([]);
  const [note, setNote] = useState("");
  const count = selected.length;

  function toggle(fault: ReportedFault) {
    setSelected((current) =>
      current.includes(fault)
        ? current.filter((item) => item !== fault)
        : [...current, fault],
    );
  }

  const canUndo =
    report !== null &&
    report.status === "open" &&
    nowMs < Date.parse(report.undoUntilUtc);

  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="detail-panel report-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="detail-overline">
              Console {channel.number} ·{" "}
              {channel.performer ?? "performer not recorded"}
            </span>
            <h2 id="report-title">{channel.name}</h2>
            <p>{report ? "Sent to the A2s." : "What are you hearing?"}</p>
          </div>
          <button className="line-button" type="button" onClick={onClose}>
            {report ? "Done" : "Cancel"}
          </button>
        </header>

        {report ? (
          <div className="report-sent">
            <p className="report-summary">{faultSummary(report)}</p>
            <p className="mono report-meta">
              Sent {formatClock(report.requestedAtUtc)} by {report.requestedBy}
            </p>
            <p
              className={`report-status report-status-${report.status}`}
              aria-live="polite"
            >
              {reportStatusLine(report)}
              {report.incident
                ? report.incidentReason === "telemetry"
                  ? " · incident, telemetry agrees"
                  : " · incident, marked urgent"
                : " · task"}
            </p>
            <div className="report-actions">
              {canUndo ? (
                <button
                  type="button"
                  className="line-button"
                  disabled={busy}
                  onClick={() => onAction(report, "undo")}
                >
                  Undo
                </button>
              ) : null}
              {isActiveReport(report) && !report.urgent ? (
                <button
                  type="button"
                  className="control-button urgent-button"
                  disabled={busy}
                  onClick={() => onAction(report, "urgent")}
                >
                  Mark urgent — it is on air now
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <form
            className="report-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (count > 0) onSend(selected, note.trim() || null);
            }}
          >
            <div className="fault-grid" role="group" aria-label="Faults heard">
              {FAULT_LABELS.map(([fault, label]) => (
                <button
                  key={fault}
                  type="button"
                  className="fault-button"
                  aria-pressed={selected.includes(fault)}
                  onClick={() => toggle(fault)}
                >
                  {selected.includes(fault) ? <Tick /> : null}
                  {label}
                </button>
              ))}
            </div>
            {selected.includes("other") ? (
              <label className="report-note">
                <span>What else? Dictate or type a short note.</span>
                <input
                  value={note}
                  maxLength={200}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Buzz on the wig mic"
                />
              </label>
            ) : null}
            <button
              type="submit"
              className="send-button"
              disabled={count === 0 || busy}
            >
              {count === 0
                ? "Choose what you hear"
                : `Send ${count} issue${count === 1 ? "" : "s"}`}
            </button>
          </form>
        )}
        {error ? (
          <p className="check-sync-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
