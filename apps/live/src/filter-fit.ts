/**
 * Which filter chips stay in the row when they do not all fit: as many from
 * the left as the row allows (leaving room for the "More" button), and always
 * the active one, so the choice never disappears into the dropdown.
 *
 * Returns the indexes of the chips to show, in order; every other index goes
 * in the dropdown. With room for every chip there is no dropdown.
 */
export function fitFilters(
  widths: readonly number[],
  gap: number,
  moreWidth: number,
  available: number,
  active: number,
): number[] {
  const total = (indexes: readonly number[], withMore: boolean) =>
    indexes.reduce((sum, index) => sum + widths[index]!, 0) +
    gap * (indexes.length - 1 + (withMore ? 1 : 0)) +
    (withMore ? moreWidth : 0);
  const all = widths.map((_, index) => index);
  if (total(all, false) <= available) return all;
  for (let count = widths.length - 1; count >= 1; count -= 1) {
    const first = all.slice(0, count);
    const shown =
      first.includes(active) || active < 0
        ? first
        : [...first.slice(0, count - 1), active];
    if (total(shown, true) <= available) return shown;
  }
  return active >= 0 ? [active] : [0];
}
