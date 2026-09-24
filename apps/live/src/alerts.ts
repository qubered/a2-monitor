import type { LiveAlert, LiveState } from "@rvlt/pulse-protocol/http";

const SEVERITY_RANK: Record<LiveAlert["severity"], number> = {
  caution: 0,
  critical: 1,
};

export function byUrgency(a: LiveAlert, b: LiveAlert): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    a.raisedAtUtc.localeCompare(b.raisedAtUtc) ||
    a.id.localeCompare(b.id)
  );
}

export function alertsForChannel(
  alerts: readonly LiveAlert[],
  channelId: string,
): LiveAlert[] {
  return alerts
    .filter((alert) => alert.channelId === channelId)
    .sort(byUrgency);
}

/** Whether an unacknowledged alert still marks its card: critical always, others until the overlay expires. */
export function overlayVisible(alert: LiveAlert, nowMs: number): boolean {
  if (alert.acknowledgedAtUtc !== null) return false;
  if (alert.overlayExpiresAtUtc === null) return true;
  return Date.parse(alert.overlayExpiresAtUtc) > nowMs;
}

/** The one alert a card shows: the most urgent unacknowledged alert whose overlay has not expired. */
export function overlayAlert(
  alerts: readonly LiveAlert[],
  channelId: string,
  nowMs: number,
): LiveAlert | null {
  return (
    alertsForChannel(alerts, channelId).find((alert) =>
      overlayVisible(alert, nowMs),
    ) ?? null
  );
}

/** Fraction of the overlay's life remaining, for the expiry countdown; null for critical alerts. */
export function overlayRemaining(
  alert: LiveAlert,
  overlayExpiryMs: number,
  nowMs: number,
): number | null {
  if (alert.overlayExpiresAtUtc === null) return null;
  const remaining = Date.parse(alert.overlayExpiresAtUtc) - nowMs;
  return Math.max(0, Math.min(1, remaining / overlayExpiryMs));
}

/** Channels holding an active critical alert pin to the top of the grid regardless of filter. */
export function criticalChannelIds(state: LiveState): Set<string> {
  return new Set(
    state.alerts
      .filter(({ severity, channelId }) => severity === "critical" && channelId)
      .map(({ channelId }) => channelId!),
  );
}

export function formatClock(isoTime: string): string {
  return new Date(isoTime).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/** Scope label for an alert: the channel it belongs to, or the system part it describes. */
export function alertScope(alert: LiveAlert): string {
  if (alert.channelNumber !== null && alert.channelName !== null) {
    return `${alert.channelNumber} · ${alert.channelName}`;
  }
  return alert.kind === "receiver-offline" ? "Receiver" : "System";
}
