import type {
  LiveChannel,
  LiveSnapshot,
  Verdict,
} from "@a2-monitor/protocol/live-snapshot";

export interface SnapshotSource {
  load(signal: AbortSignal): Promise<LiveSnapshot>;
}

export class SnapshotOfflineError extends Error {
  constructor() {
    super("The backend could not be reached.");
    this.name = "SnapshotOfflineError";
  }
}

export class SnapshotContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function isNullableNumber(value: unknown): value is number | null {
  return (
    value === null || (typeof value === "number" && Number.isFinite(value))
  );
}

const verdicts = new Set<Verdict>([
  "good",
  "fault",
  "caution",
  "unknown",
  "not-applicable",
]);

function isChannel(value: unknown): value is LiveChannel {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        "id",
        "number",
        "character",
        "performer",
        "kind",
        "zone",
        "levelDbfs",
        "statuses",
        "details",
      ],
      ["alert"],
    )
  ) {
    return false;
  }

  const statuses = value.statuses;
  const details = value.details;
  const alert = value.alert;
  if (
    !isRecord(statuses) ||
    !hasExactKeys(statuses, ["rf", "audio", "battery", "check"]) ||
    !Object.values(statuses).every((status) =>
      verdicts.has(status as Verdict),
    ) ||
    !isRecord(details) ||
    !hasExactKeys(details, [
      "receiver",
      "input",
      "rfLevelDbm",
      "linkQualityPercent",
      "batteryRemaining",
      "telemetryAge",
    ])
  ) {
    return false;
  }

  const validAlert =
    alert === undefined ||
    (isRecord(alert) &&
      hasExactKeys(alert, ["severity", "label", "dimension"]) &&
      (alert.severity === "critical" || alert.severity === "caution") &&
      isBoundedString(alert.label) &&
      (alert.dimension === "RF" ||
        alert.dimension === "Audio" ||
        alert.dimension === "Battery"));

  return (
    isBoundedString(value.id) &&
    Number.isInteger(value.number) &&
    Number(value.number) > 0 &&
    isBoundedString(value.character) &&
    isBoundedString(value.performer) &&
    (value.kind === "wireless" || value.kind === "wired") &&
    isBoundedString(value.zone) &&
    isNullableNumber(value.levelDbfs) &&
    isBoundedString(details.receiver) &&
    isBoundedString(details.input) &&
    isNullableNumber(details.rfLevelDbm) &&
    isNullableNumber(details.linkQualityPercent) &&
    (details.batteryRemaining === null ||
      isBoundedString(details.batteryRemaining)) &&
    isBoundedString(details.telemetryAge) &&
    validAlert
  );
}

export function parseLiveSnapshot(value: unknown): LiveSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "generatedAtUtc",
      "source",
      "show",
      "node",
      "channels",
    ]) ||
    value.schemaVersion !== "0" ||
    !isBoundedString(value.generatedAtUtc) ||
    !Number.isFinite(Date.parse(value.generatedAtUtc)) ||
    !isRecord(value.source) ||
    !hasExactKeys(value.source, ["kind", "label"]) ||
    value.source.kind !== "fabricated" ||
    !isBoundedString(value.source.label) ||
    !isRecord(value.show) ||
    !hasExactKeys(value.show, ["name", "venue", "performanceLabel"]) ||
    !isBoundedString(value.show.name) ||
    !isBoundedString(value.show.venue) ||
    !isBoundedString(value.show.performanceLabel) ||
    !isRecord(value.node) ||
    !hasExactKeys(value.node, ["status", "channelCount", "sampleRateHz"]) ||
    !["ready", "waiting", "offline"].includes(String(value.node.status)) ||
    !(
      value.node.channelCount === null ||
      (Number.isInteger(value.node.channelCount) &&
        Number(value.node.channelCount) >= 0)
    ) ||
    !(
      value.node.sampleRateHz === null ||
      (Number.isInteger(value.node.sampleRateHz) &&
        Number(value.node.sampleRateHz) >= 8000)
    ) ||
    !Array.isArray(value.channels) ||
    value.channels.length > 128 ||
    !value.channels.every(isChannel)
  ) {
    throw new SnapshotContractError(
      "The backend returned a snapshot that does not match schema version 0.",
    );
  }

  return value as LiveSnapshot;
}

export function createHttpSnapshotSource(
  fetchSnapshot: typeof fetch = fetch,
): SnapshotSource {
  return {
    async load(signal) {
      let response: Response;
      try {
        response = await fetchSnapshot("/api/v1/live/snapshot", { signal });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        throw new SnapshotOfflineError();
      }

      if (!response.ok) {
        throw new Error(
          `Snapshot request failed with HTTP ${response.status}.`,
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new SnapshotContractError(
          "The backend snapshot response was not valid JSON.",
        );
      }
      return parseLiveSnapshot(body);
    },
  };
}

export function createStaticSnapshotSource(
  snapshot: LiveSnapshot,
): SnapshotSource {
  return {
    async load() {
      return snapshot;
    },
  };
}

export const httpSnapshotSource = createHttpSnapshotSource();
