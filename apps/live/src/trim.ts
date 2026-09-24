/** "+6" or "−3.5": a signed monitor trim in dB. */
export function formatTrim(trimDb: number): string {
  return `${trimDb > 0 ? "+" : trimDb < 0 ? "−" : ""}${Math.abs(trimDb)}`;
}
