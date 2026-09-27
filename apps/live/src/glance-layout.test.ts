import { describe, expect, it } from "vitest";
import { fitGlance } from "./glance-layout";

const theatre = [
  { count: 12, titled: true },
  { count: 36, titled: true },
  { count: 16, titled: true },
];

describe("fitGlance", () => {
  it("fits a 64-channel theatre show above the player on an iPad", () => {
    // 1024×768 less header, filters, padding and the player.
    const fit = fitGlance({ width: 1000, height: 460, groups: theatre });
    expect(fit.fits).toBe(true);
    expect(fit.tileHeight).toBeGreaterThanOrEqual(48);
    const rows = theatre.reduce(
      (sum, g) => sum + Math.ceil(g.count / fit.columns),
      0,
    );
    expect(rows * fit.tileHeight).toBeLessThanOrEqual(460);
  });

  it("prefers wide tiles once the height cap is reached, up to a width", () => {
    const fit = fitGlance({
      width: 1400,
      height: 800,
      groups: [{ count: 8, titled: false }],
    });
    // Every count from two columns reaches the 96 px cap; seven is the
    // fewest that keeps tiles within 200 px.
    expect(fit.tileHeight).toBe(96);
    expect(fit.columns).toBe(7);
  });

  it("never goes below a touch target; it scrolls instead", () => {
    const fit = fitGlance({ width: 360, height: 400, groups: theatre });
    expect(fit.tileHeight).toBe(48);
    expect(fit.fits).toBe(false);
    expect(fit.columns).toBe(4);
  });
});
