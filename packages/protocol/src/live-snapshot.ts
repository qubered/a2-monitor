export type Verdict =
  | "good"
  | "fault"
  | "caution"
  | "unknown"
  | "not-applicable";

export type LiveChannel = {
  id: string;
  number: number;
  character: string;
  performer: string;
  kind: "wireless" | "wired";
  zone: string;
  levelDbfs: number | null;
  statuses: {
    rf: Verdict;
    audio: Verdict;
    battery: Verdict;
    check: Verdict;
  };
  alert?: {
    severity: "critical" | "caution";
    label: string;
    dimension: "RF" | "Audio" | "Battery";
  };
  details: {
    receiver: string;
    input: string;
    rfLevelDbm: number | null;
    linkQualityPercent: number | null;
    batteryRemaining: string | null;
    telemetryAge: string;
  };
};

export type LiveSnapshot = {
  schemaVersion: "0";
  generatedAtUtc: string;
  source: {
    kind: "fabricated";
    label: string;
  };
  show: {
    name: string;
    venue: string;
    performanceLabel: string;
  };
  node: {
    status: "ready" | "waiting" | "offline";
    channelCount: number | null;
    sampleRateHz: number | null;
  };
  channels: LiveChannel[];
};

export type HealthResponse = {
  status: "ok";
  service: "a2-backend";
  version: string;
};
