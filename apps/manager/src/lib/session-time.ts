/** "HH:MM" from minutes after local midnight, for a time input. */
export function minuteToTime(minute: number | null): string {
  if (minute === null) return "";
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** Minutes after local midnight from a time input's "HH:MM"; empty is unscheduled. */
export function timeToMinute(value: string): number | null {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute < 24 * 60 ? minute : null;
}
