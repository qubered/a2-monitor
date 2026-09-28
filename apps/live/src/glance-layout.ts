/**
 * The glance view's fit (DESIGN.md §10.1): how many columns, and how tall a
 * tile, so every channel in view fits the space above the player. Tiles never
 * shrink below a touch target; when that floor is reached the grid scrolls.
 */
export type GlanceFitInput = {
  /** Content width available to the grid, in CSS px. */
  width: number;
  /** Height between the top of the grid and the player, in CSS px. */
  height: number;
  /** Cards per group in showfile order; `titled` groups carry a heading. */
  groups: readonly { count: number; titled: boolean }[];
  minTileWidth?: number;
  minTileHeight?: number;
  maxTileHeight?: number;
  /** Past this width a tile only stretches its strip; more columns are fine. */
  maxTileWidth?: number;
  gap?: number;
  headingHeight?: number;
  groupGap?: number;
};

export type GlanceFit = {
  columns: number;
  tileHeight: number;
  /** False when even the smallest tiles need the grid to scroll. */
  fits: boolean;
};

export const GLANCE_MIN_TILE_WIDTH = 72;
export const GLANCE_MIN_TILE_HEIGHT = 48;
export const GLANCE_MAX_TILE_HEIGHT = 160;
export const GLANCE_MAX_TILE_WIDTH = 200;

export function fitGlance({
  width,
  height,
  groups,
  minTileWidth = GLANCE_MIN_TILE_WIDTH,
  minTileHeight = GLANCE_MIN_TILE_HEIGHT,
  maxTileHeight = GLANCE_MAX_TILE_HEIGHT,
  maxTileWidth = GLANCE_MAX_TILE_WIDTH,
  gap = 8,
  headingHeight = 26,
  groupGap = 12,
}: GlanceFitInput): GlanceFit {
  const shown = groups.filter(({ count }) => count > 0);
  const maxColumns = Math.max(
    1,
    Math.floor((width + gap) / (minTileWidth + gap)),
  );
  const tileHeightFor = (columns: number) => {
    const rows = shown.reduce(
      (sum, { count }) => sum + Math.ceil(count / columns),
      0,
    );
    if (rows === 0) return maxTileHeight;
    const fixed =
      shown.filter(({ titled }) => titled).length * headingHeight +
      Math.max(0, shown.length - 1) * groupGap +
      (rows - shown.length) * gap;
    return (height - fixed) / rows;
  };
  // The tallest tile any column count reaches, capped; then the fewest
  // columns (widest tiles, longest names) that still reach it, but not so few
  // that tiles grow past the width a name and a strip can use.
  let best = -Infinity;
  for (let columns = 1; columns <= maxColumns; columns += 1) {
    best = Math.max(best, tileHeightFor(columns));
  }
  const target = Math.min(best, maxTileHeight);
  const tileWidthFor = (columns: number) =>
    (width - (columns - 1) * gap) / columns;
  const reaching = Array.from({ length: maxColumns }, (_, i) => i + 1).filter(
    (candidate) => tileHeightFor(candidate) >= target - 0.5,
  );
  const columns =
    reaching.find((candidate) => tileWidthFor(candidate) <= maxTileWidth) ??
    reaching.at(-1) ??
    maxColumns;
  const raw = Math.min(tileHeightFor(columns), maxTileHeight);
  return {
    columns,
    tileHeight: Math.max(minTileHeight, Math.floor(raw)),
    fits: raw >= minTileHeight,
  };
}
