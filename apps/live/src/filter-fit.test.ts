import { describe, expect, it } from "vitest";
import { fitFilters } from "./filter-fit";

// Five chips of 100 px, an 8 px gap and a 60 px More button.
const widths = [100, 100, 100, 100, 100];

describe("fitFilters", () => {
  it("shows every chip when the row has room, with no More", () => {
    expect(fitFilters(widths, 8, 60, 532, 0)).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps as many chips as fit beside More", () => {
    // 3 chips + 2 gaps + a gap + More = 300 + 16 + 8 + 60 = 384; 4 would need 492.
    expect(fitFilters(widths, 8, 60, 400, 0)).toEqual([0, 1, 2]);
  });

  it("swaps the active chip into the row instead of hiding it", () => {
    expect(fitFilters(widths, 8, 60, 400, 4)).toEqual([0, 1, 4]);
    expect(fitFilters(widths, 8, 60, 400, 1)).toEqual([0, 1, 2]);
  });

  it("never shows nothing, however narrow the row", () => {
    expect(fitFilters(widths, 8, 60, 40, 3)).toEqual([3]);
    expect(fitFilters(widths, 8, 60, 40, -1)).toEqual([0]);
  });
});
