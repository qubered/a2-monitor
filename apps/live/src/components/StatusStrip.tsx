import type {
  LiveStateChannel,
  LiveStateVerdict as Verdict,
} from "@rvlt/pulse-protocol/http";

const verdictLabels: Record<Verdict, string> = {
  good: "good",
  fault: "fault",
  caution: "caution",
  unknown: "unknown",
  "not-applicable": "not applicable",
};

function VerdictGlyph({ verdict }: { verdict: Verdict }) {
  if (verdict === "good") {
    return <path d="M3 8.5 6.4 12 13 4.5" />;
  }
  if (verdict === "fault") {
    return <path d="M4 4l8 8M12 4l-8 8" />;
  }
  if (verdict === "caution") {
    return <path d="M8 2.4 15 14H1L8 2.4Zm0 4.2v3.2m0 2.1h.01" />;
  }
  if (verdict === "unknown") {
    return <path d="M4 8h8" />;
  }
  return <path d="m4.5 11.5 7-7" />;
}

/** Remaining runtime as a short card string: "3h 20m", "45m". */
function formatRuntime(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return `${whole}m`;
  return `${Math.floor(whole / 60)}h ${String(whole % 60).padStart(2, "0")}m`;
}

type BatteryReading = { percent: string | null; runtime: string | null };

/**
 * What the battery cell says beyond its verdict. Unknown stays unknown: no
 * number is shown for a battery that was never read, and a stale reading is
 * marked as such rather than passed off as current (DESIGN.md §9).
 */
function batteryReading(
  battery: LiveStateChannel["battery"] | undefined,
  verdict: Verdict,
): BatteryReading | null {
  if (!battery || verdict === "not-applicable") return null;
  if (battery.availability === "unknown") return null;
  const percent = battery.percent === null ? null : `${battery.percent}%`;
  const runtime =
    battery.runtimeMinutes === null
      ? null
      : formatRuntime(battery.runtimeMinutes);
  if (percent === null && runtime === null) return null;
  return { percent, runtime };
}

/**
 * The card's measured dimensions. Mic-check progress lives in the channel detail, not on the card.
 * `compact` (the glance tile) keeps glyph, colour and fixed position but drops the visible word,
 * which the grid's legend and each cell's accessible name carry instead.
 */
export function StatusStrip({
  statuses,
  battery,
  compact = false,
}: Pick<LiveStateChannel, "statuses"> & {
  /** When given, the full card's battery cell also shows charge and runtime. */
  battery?: LiveStateChannel["battery"];
  compact?: boolean;
}) {
  const dimensions = [
    ["rf", "RF", "RF link"],
    ["audio", "Audio", "Audio"],
    ["battery", "Battery", "Battery"],
  ] as const;

  return (
    <div
      className={`status-strip${compact ? " is-compact" : ""}`}
      role="group"
      aria-label="Status by dimension"
    >
      {dimensions.map(([key, label, accessibleLabel]) => {
        const verdict = statuses[key];
        const reading =
          key === "battery" && !compact
            ? batteryReading(battery, verdict)
            : null;
        const stale = reading !== null && battery?.availability === "stale";
        return (
          <div
            className={`status-cell status-${verdict}`}
            title={`${accessibleLabel}: ${verdictLabels[verdict]}`}
            key={key}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <VerdictGlyph verdict={verdict} />
            </svg>
            {compact ? null : reading ? (
              <span className="status-reading mono">
                {reading.percent ? <b>{reading.percent}</b> : null}
                {reading.runtime ? <i>{reading.runtime}</i> : null}
                {stale ? <i>stale</i> : null}
              </span>
            ) : (
              <span>{label}</span>
            )}
            <span className="sr-only">
              {accessibleLabel}: {verdictLabels[verdict]}
              {reading
                ? `, ${[
                    reading.percent && `${reading.percent} charge`,
                    reading.runtime && `${reading.runtime} remaining`,
                    stale && "stale reading",
                  ]
                    .filter(Boolean)
                    .join(", ")}`
                : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
