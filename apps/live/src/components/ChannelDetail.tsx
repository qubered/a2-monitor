import type {
  FaultReport,
  LiveAlert,
  LiveStateAvailability,
  LiveStateChannel,
} from "@rvlt/pulse-protocol/http";
import { formatClock, formatDuration } from "../alerts";
import type { OperatorRole } from "../operator";
import type { ReportAction } from "../reports";
import { formatTrim } from "../trim";
import { ReportList } from "./Reports";

type ChannelDetailProps = {
  channel: LiveStateChannel;
  alerts: readonly LiveAlert[];
  reports?: readonly FaultReport[];
  role?: OperatorRole;
  busy?: boolean;
  onReportAction?: (report: FaultReport, action: ReportAction) => void;
  history: readonly LiveAlert[] | null;
  nowMs: number;
  onAcknowledge: (alert: LiveAlert) => void;
  /** Absent while the backend is unreachable, so the reset is never offered then. */
  onResetChannel?: () => void;
  onClose: () => void;
  onRunCheck: () => void;
};

type Reading = {
  label: string;
  value: string | null;
  availability?: LiveStateAvailability;
  mono?: boolean;
};

function signed(value: number, digits = 0): string {
  const text = Math.abs(value).toFixed(digits);
  return value < 0 ? `−${text}` : text;
}

function measured(
  value: number | null,
  unit: string,
  digits = 0,
): string | null {
  return value === null ? null : `${signed(value, digits)} ${unit}`;
}

function frequencyLabel(raw: string | null): string | null {
  if (raw === null) return null;
  return /^\d{6,7}$/.test(raw) ? `${(Number(raw) / 1000).toFixed(3)} MHz` : raw;
}

function Readings({ title, readings }: { title: string; readings: Reading[] }) {
  return (
    <section>
      <h3>{title}</h3>
      <dl>
        {readings.map(({ label, value, availability, mono = true }) => (
          <div
            key={label}
            className={`reading reading-${value === null ? "unknown" : (availability ?? "observed")}`}
          >
            <dt>{label}</dt>
            <dd className={mono && value !== null ? "mono" : undefined}>
              {value === null
                ? "Unknown"
                : availability === "stale"
                  ? `${value} · stale`
                  : value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function AlertRow({
  alert,
  nowMs,
  onAcknowledge,
}: {
  alert: LiveAlert;
  nowMs: number;
  onAcknowledge?: (alert: LiveAlert) => void;
}) {
  return (
    <li className={`alert-row alert-row-${alert.severity}`}>
      <div>
        <strong>{alert.label}</strong>
        <span>{alert.detail}</span>
        <span className="mono">
          Raised {formatClock(alert.raisedAtUtc)}
          {alert.clearedAtUtc
            ? ` · cleared ${formatClock(alert.clearedAtUtc)}`
            : ` · for ${formatDuration(nowMs - Date.parse(alert.raisedAtUtc))}`}
          {alert.acknowledgedAtUtc
            ? ` · seen by ${alert.acknowledgedBy ?? "unknown"} at ${formatClock(alert.acknowledgedAtUtc)}`
            : alert.clearedAtUtc
              ? " · never acknowledged"
              : ""}
        </span>
      </div>
      {onAcknowledge && !alert.acknowledgedAtUtc && !alert.clearedAtUtc ? (
        <button
          type="button"
          className="line-button"
          onClick={() => onAcknowledge(alert)}
        >
          Acknowledge
        </button>
      ) : null}
    </li>
  );
}

export function ChannelDetail({
  channel,
  alerts,
  reports = [],
  role = "A2",
  busy = false,
  onReportAction,
  history,
  nowMs,
  onAcknowledge,
  onResetChannel,
  onClose,
  onRunCheck,
}: ChannelDetailProps) {
  const wireless = channel.receiver !== null;
  const recent = (history ?? [])
    .filter(({ channelId }) => channelId === channel.id)
    .slice(0, 5);

  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="detail-overline">Channel {channel.number}</span>
            <h2 id="detail-title">{channel.name}</h2>
            <p>{channel.performer ?? "Performer not recorded"}</p>
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
          <section className="detail-alerts" aria-label="Fault reports">
            <h3>Fault reports</h3>
            <ReportList
              reports={reports}
              role={role}
              busy={busy}
              onAction={onReportAction}
            />
          </section>
        ) : null}

        {alerts.length ? (
          <section className="detail-alerts" aria-label="Active alerts">
            <h3>Active alerts</h3>
            <ul>
              {alerts.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  nowMs={nowMs}
                  onAcknowledge={onAcknowledge}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {onResetChannel &&
        (alerts.length > 0 ||
          channel.micTypeSource === "inferred" ||
          Object.values(channel.statuses).some(
            (status) => status === "fault",
          )) ? (
          <section
            className="detail-alerts detail-reset"
            aria-label="Reset channel"
          >
            <button
              type="button"
              className="line-button"
              disabled={busy}
              onClick={onResetChannel}
            >
              Clear alerts and reset
            </button>
          </section>
        ) : null}

        <div className="detail-grid">
          <Readings
            title="Audio"
            readings={[
              {
                label: "Captured peak",
                value: measured(channel.audio.peakDbfs, "dBFS", 1),
                availability: channel.audio.availability,
              },
              {
                label: "Captured RMS",
                value: measured(channel.audio.rmsDbfs, "dBFS", 1),
                availability: channel.audio.availability,
              },
              {
                label: "Below silence floor",
                value:
                  channel.audio.silentForMs === null
                    ? null
                    : channel.audio.silentForMs === 0
                      ? "Signal present"
                      : formatDuration(channel.audio.silentForMs),
                availability: channel.audio.availability,
              },
              {
                label: "Clipping",
                value:
                  channel.audio.availability === "observed"
                    ? channel.audio.clipping
                      ? "Clipped in the last second"
                      : "None in the last second"
                    : null,
                mono: false,
              },
              {
                label: "Monitor trim",
                value: `${formatTrim(channel.trimDb ?? 0)} dB`,
              },
              {
                label: "Transmitter mute",
                value:
                  channel.transmitter.muted === null
                    ? null
                    : channel.transmitter.muted
                      ? "On"
                      : "Off",
                availability: channel.rf.availability,
                mono: false,
              },
            ]}
          />

          {wireless ? (
            <Readings
              title="RF and link"
              readings={[
                {
                  label: "RF level",
                  value: measured(channel.rf.levelDbm, "dBm"),
                  availability: channel.rf.availability,
                },
                {
                  label: "Link quality",
                  value:
                    channel.rf.linkQualityPercent === null
                      ? null
                      : `${channel.rf.linkQualityPercent} %`,
                  availability: channel.rf.availability,
                },
                {
                  label: "Active antenna",
                  value: channel.rf.activeAntenna,
                  availability: channel.rf.availability,
                },
                {
                  label: "Interference",
                  value:
                    channel.rf.interference === "unavailable"
                      ? null
                      : channel.rf.interference === "detected"
                        ? "Detected"
                        : "None reported",
                  availability: channel.rf.availability,
                  mono: false,
                },
                {
                  label: "Transmitter",
                  value:
                    channel.rf.transmitterPresent === null
                      ? null
                      : channel.rf.transmitterPresent
                        ? "Linked"
                        : "Not detected",
                  availability: channel.rf.availability,
                  mono: false,
                },
              ]}
            />
          ) : null}

          {wireless ? (
            <Readings
              title="Battery and transmitter"
              readings={[
                {
                  label: "Charge",
                  value:
                    channel.battery.percent === null
                      ? null
                      : `${channel.battery.percent} %`,
                  availability: channel.battery.availability,
                },
                {
                  label: "Bars",
                  value:
                    channel.battery.bars === null
                      ? null
                      : `${channel.battery.bars} of 5`,
                  availability: channel.battery.availability,
                },
                {
                  label: "Runtime",
                  value:
                    channel.battery.runtimeMinutes === null
                      ? null
                      : formatDuration(channel.battery.runtimeMinutes * 60_000),
                  availability: channel.battery.availability,
                },
                {
                  label: "Battery type",
                  value: channel.battery.type,
                  availability: channel.battery.availability,
                },
                {
                  label: "Model",
                  value: channel.transmitter.type,
                  availability: channel.rf.availability,
                },
                {
                  label: "Name on pack",
                  value: channel.transmitter.name,
                  availability: channel.rf.availability,
                },
              ]}
            />
          ) : null}

          <Readings
            title={wireless ? "Receiver and assignment" : "Assignment"}
            readings={[
              ...(channel.receiver
                ? [
                    {
                      label: "Receiver",
                      value: `${channel.receiver.name} · channel ${channel.receiver.channelIndex + 1}`,
                      mono: false,
                    },
                    {
                      label: "Model",
                      value: channel.receiver.model,
                    },
                    {
                      label: "Frequency",
                      value: frequencyLabel(channel.receiver.frequencyRaw),
                      availability: channel.rf.availability,
                    },
                    {
                      label: "Group, channel",
                      value: channel.receiver.groupChannelRaw,
                      availability: channel.rf.availability,
                    },
                    {
                      label: "Telemetry",
                      value: channel.transmitter.observedAtUtc
                        ? `${channel.receiver.status} · observed ${formatClock(channel.transmitter.observedAtUtc)}`
                        : channel.receiver.status,
                      mono: false,
                    },
                  ]
                : []),
              { label: "Audio input", value: channel.input.label, mono: false },
              {
                label: "Mic check",
                value: channel.check
                  ? [
                      `${channel.check.passed} of ${channel.check.total} passed`,
                      channel.check.failed
                        ? `${channel.check.failed} failed`
                        : null,
                      channel.check.waiting
                        ? `${channel.check.waiting} waiting`
                        : null,
                      channel.check.stale
                        ? "stale, patch or performer changed"
                        : `updated ${formatClock(channel.check.updatedAtUtc)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "Not checked",
                mono: false,
              },
              {
                label: "Monitoring",
                value:
                  [
                    channel.monitor.rf && wireless ? "RF" : null,
                    channel.monitor.audio ? "silence" : null,
                    channel.monitor.battery && wireless ? "battery" : null,
                  ]
                    .filter(Boolean)
                    .join(", ") || "Off",
                mono: false,
              },
            ]}
          />
        </div>

        {recent.length ? (
          <section className="detail-alerts" aria-label="Recent alerts">
            <h3>Recently cleared</h3>
            <ul>
              {recent.map((alert) => (
                <AlertRow key={alert.id} alert={alert} nowMs={nowMs} />
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="detail-actions">
          <button className="line-button" type="button" onClick={onRunCheck}>
            Run a check
          </button>
        </footer>
      </section>
    </div>
  );
}
