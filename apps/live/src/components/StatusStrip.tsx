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

/**
 * The card's measured dimensions. Mic-check progress lives in the channel detail, not on the card.
 * `compact` (the glance tile) keeps glyph, colour and fixed position but drops the visible word,
 * which the grid's legend and each cell's accessible name carry instead.
 */
export function StatusStrip({
  statuses,
  compact = false,
}: Pick<LiveStateChannel, "statuses"> & { compact?: boolean }) {
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
        return (
          <div
            className={`status-cell status-${verdict}`}
            title={`${accessibleLabel}: ${verdictLabels[verdict]}`}
            key={key}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <VerdictGlyph verdict={verdict} />
            </svg>
            {compact ? null : <span>{label}</span>}
            <span className="sr-only">
              {accessibleLabel}: {verdictLabels[verdict]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
