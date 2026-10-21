/* Pulse, by RVLT: the product lockup. The five-bar glyph is Pulse's own mark,
   set the way RVLT sets product icons (cream on an RVLT-red tile). The "by RVLT"
   wordmark is the RVLT mark's outlines, unaltered; do not retype or redraw it. */
const RVLT_PATHS = [
  "M0,42C0,21.94,16.92,5.64,36.98,5.64h106.56c82.12,0,137.91,58.92,137.91,131.64,0,60.18-37.61,101.55-81.49,112.21l-8.15.63,116.59,139.16c6.9,8.15,8.78,15.67,8.78,24.45,0,20.06-16.3,36.36-36.36,36.36-11.28,0-21.31-4.39-28.83-13.79l-146.68-174.26c-5.01-6.27-11.28-16.3-11.28-28.83,0-18.81,15.04-33.22,33.22-33.22h13.79c37.61,0,63.94-28.21,63.94-62.68s-26.33-63.31-63.94-63.31h-67.07v339.12c0,20.06-16.92,36.98-36.98,36.98S0,433.15,0,413.09V42Z",
  "M366.7,36.98c0-20.69,16.92-36.98,36.98-36.98s36.98,16.3,36.98,36.98v282.08L697.67,12.54c6.27-8.15,16.92-12.54,26.33-12.54,19.43,0,34.48,15.04,34.48,34.48,0,6.9-1.25,14.42-8.15,21.94l-317.18,378.62c-8.78,11.28-19.43,15.04-29.46,15.04-20.06,0-36.98-16.92-36.98-36.98V36.98Z",
  "M804.85,36.98c0-20.69,16.92-36.98,36.98-36.98s36.98,16.3,36.98,36.98v338.5h132.26c18.81,0,33.85,15.04,33.85,34.48s-15.04,34.48-33.85,34.48h-169.25c-20.06,0-36.98-16.92-36.98-36.98V36.98Z",
  "M1100.72,73.97h-83.37c-19.43,0-34.48-15.04-34.48-34.48s15.04-33.85,34.48-33.85h240.71c19.43,0,34.48,15.04,34.48,33.85s-15.04,34.48-34.48,34.48h-83.37v339.12c0,20.06-16.92,36.98-36.98,36.98s-36.98-16.92-36.98-36.98V73.97Z",
];

export function PulseTile({ size = 36 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <rect width="100" height="100" rx="22.6" fill="var(--red)" />
      <g fill="var(--cream)">
        <rect x="14" y="41" width="9" height="18" rx="4.5" />
        <rect x="29" y="30" width="9" height="40" rx="4.5" />
        <rect x="45.5" y="16" width="9" height="68" rx="4.5" />
        <rect x="62" y="30" width="9" height="40" rx="4.5" />
        <rect x="77" y="41" width="9" height="18" rx="4.5" />
      </g>
    </svg>
  );
}

export function PulseLockup({
  label = "Pulse by RVLT",
  suffix,
}: {
  label?: string;
  suffix?: string;
}) {
  return (
    <div className="brand" aria-label={label}>
      <PulseTile />
      <span className="brand-name">
        <b>Pulse</b>
        <span className="brand-by" aria-hidden="true">
          by
          <svg viewBox="0 0 1258 450.7">
            {RVLT_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
        </span>
      </span>
      {suffix ? <em className="brand-suffix">{suffix}</em> : null}
    </div>
  );
}
