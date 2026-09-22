// Honesty-grammar states a single measurement can be in (design system §9).
// "unknown" never renders as zero or as a filled bar — a gap or a faint dash.
export type SampleAvailability = "observed" | "stale" | "unknown";

export type TraceSample = {
  value: number | null;
  availability: SampleAvailability;
};

export type TraceVariant = "bars" | "line";

export type TraceTheme = {
  ok: string;
  purple: string;
  inkMuted: string;
  rep: string;
  paper: string;
};

const FALLBACK_THEME: TraceTheme = {
  ok: "#4fd888",
  purple: "#9b82e6",
  inkMuted: "#cdc4b2",
  rep: "#b6ac9a",
  paper: "#141210",
};

/** Reads the live design tokens from the page rather than duplicating hex values here (design system §3.2). */
export function readTraceTheme(element: Element): TraceTheme {
  const computed = getComputedStyle(element);
  const read = (name: string, fallback: string) =>
    computed.getPropertyValue(name).trim() || fallback;
  return {
    ok: read("--ok", FALLBACK_THEME.ok),
    purple: read("--purple", FALLBACK_THEME.purple),
    inkMuted: read("--ink-2", FALLBACK_THEME.inkMuted),
    rep: read("--rep", FALLBACK_THEME.rep),
    paper: read("--paper", FALLBACK_THEME.paper),
  };
}

export type DrawTraceOptions = {
  min: number;
  max: number;
  variant: TraceVariant;
  theme: TraceTheme;
  /** Ratio (0..1) across the width after which data is later than the playhead and is dimmed; null when fully live. */
  playheadRatio: number | null;
  /** True while scrubbed back — the observed value renders in --purple instead of --ok. */
  replay: boolean;
};

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function drawHatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  width: number,
  height: number,
  color: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, 0, width, height);
  ctx.clip();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = color;
  ctx.fillRect(x, 0, width, height);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, width * 0.35);
  const step = Math.max(3, width * 1.6);
  for (let offset = -height; offset < width + height; offset += step) {
    ctx.beginPath();
    ctx.moveTo(x + offset, height);
    ctx.lineTo(x + offset + height, 0);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawTrace(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  samples: readonly TraceSample[],
  options: DrawTraceOptions,
): void {
  ctx.clearRect(0, 0, width, height);
  if (samples.length === 0 || width <= 0 || height <= 0) return;

  const { min, max, variant, theme, playheadRatio, replay } = options;
  const slotWidth = width / samples.length;
  const observedColor = replay ? theme.purple : theme.ok;

  if (variant === "line") {
    ctx.lineWidth = Math.max(1.25, slotWidth * 0.6);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let previousPoint: { x: number; y: number } | null = null;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      const x = index * slotWidth + slotWidth / 2;
      if (sample.availability === "stale") {
        drawHatch(ctx, index * slotWidth, slotWidth, height, theme.rep);
        previousPoint = null;
        continue;
      }
      if (sample.value === null) {
        previousPoint = null;
        continue;
      }
      const y = height - normalize(sample.value, min, max) * height;
      if (previousPoint) {
        ctx.strokeStyle = observedColor;
        ctx.beginPath();
        ctx.moveTo(previousPoint.x, previousPoint.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      previousPoint = { x, y };
    }
  } else {
    const barWidth = Math.max(1, slotWidth - Math.min(1, slotWidth * 0.15));
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      const x = index * slotWidth;
      if (sample.availability === "stale") {
        drawHatch(ctx, x, slotWidth, height, theme.rep);
        continue;
      }
      if (sample.availability === "unknown") {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = theme.rep;
        ctx.fillRect(x, height - 2, barWidth, 2);
        ctx.globalAlpha = 1;
        continue;
      }
      if (sample.value === null) {
        ctx.fillStyle = theme.inkMuted;
        ctx.fillRect(x, height - 2, barWidth, 2);
        continue;
      }
      const barHeight = Math.max(2, normalize(sample.value, min, max) * height);
      ctx.fillStyle = observedColor;
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
    }
  }

  if (playheadRatio !== null) {
    const playheadX = playheadRatio * width;
    if (playheadX < width - 0.5) {
      ctx.fillStyle = theme.paper;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(playheadX, 0, width - playheadX, height);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = replay ? theme.purple : theme.inkMuted;
    ctx.lineWidth = Math.max(1, width * 0.0025);
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
  }
}
