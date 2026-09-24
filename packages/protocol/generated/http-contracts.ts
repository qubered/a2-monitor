// Generated file. Do not edit by hand.
// Sources:
//   - schema/v0/http/health-response.schema.json
//   - schema/v0/http/live-snapshot-response.schema.json
//   - schema/v0/http/showfile.schema.json
//   - schema/v0/http/shure-telemetry.schema.json
//   - schema/v0/http/production-list.schema.json
//   - schema/v0/http/channel-level-history.schema.json
//   - schema/v0/http/node-levels.schema.json
//   - schema/v0/http/meter-frame.schema.json
//   - schema/v0/http/host-output.schema.json
//   - schema/v0/http/live-state.schema.json
//   - schema/v0/http/alert-log.schema.json
//   - schema/v0/http/mic-checks.schema.json
// Regenerate: npm run generate --workspace @rvlt/pulse-protocol
// Schema-SHA256: 14711b4c08945918f142d93ab88c78517621595cb6f6d3fdfbf7e980927016cf
// Generator-SHA256: 7c6c8c3297d1ffee85f78fc29a4b03c3fbf3fa68da597de8be09f1f2e73d4cbf
// Body-SHA256: 7aacd547c7b9b00dc24dd70924afa91276f463dc246f1c62e0d2d2bff2fdf4f8

export type HealthResponse = {
  status: "ok";
  service: "pulse-backend";
  version: string;
};

export type Verdict =
  "good" | "fault" | "caution" | "unknown" | "not-applicable";

export type NullableNumber = number | null;

export type LiveChannel = {
  id: string;
  number: number;
  character: string;
  performer: string;
  kind: "wireless" | "wired";
  zone: string;
  levelDbfs: NullableNumber;
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
    rfLevelDbm: NullableNumber;
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
  channels: Array<LiveChannel>;
};

export type Showfile = {
  schemaVersion: "0";
  revision: number;
  updatedAtUtc: string | null;
  show: {
    name: string;
  };
  alertPolicy?: {
    batteryCautionPercent: number;
    batteryCriticalPercent: number;
    rfCautionDbm: number;
    rfCriticalDbm: number;
    qualityCautionPercent: number;
    qualityCriticalPercent: number;
    silenceFloorDbfs: number;
    silenceAfterSeconds: number;
    clipAlerts: boolean;
    overlayExpiryMinutes: number;
  };
  hostOutput?: {
    outputChannels: Array<number>;
  };
  device: {
    name: string;
    channelCount: number;
  } | null;
  shureReceivers: Array<{
    id: string;
    name: string;
    host: string;
    model:
      | "AD4D"
      | "AD4D-DC"
      | "AD4Q"
      | "AD4Q-DC"
      | "ANX4"
      | "ULXD4"
      | "ULXD4D"
      | "ULXD4Q"
      | "ULXD4-GV"
      | "ULXD4D-GV"
      | "ULXD4Q-GV"
      | "QLXD4"
      | "SLXD4"
      | "SLXD4D"
      | "SLXD4+"
      | "SLXD4D+"
      | "SLXD4Q+"
      | "SLXD4QDAN+";
    channelCount: number;
  }>;
  channels: Array<{
    id?: string;
    inputIndex: number | null;
    name: string;
    performer?: string | null;
    shureChannelIndex?: number | null;
    shureReceiverId?: string | null;
    micType?:
      | "lavalier"
      | "headset"
      | "handheld"
      | "boundary"
      | "instrument"
      | "other"
      | null;
    imageUrl?: string | null;
    monitor?: {
      battery: boolean;
      rf: boolean;
      audio: boolean;
    };
  }>;
};

export type ShureTelemetry = {
  schemaVersion: "0";
  status:
    "unconfigured" | "connecting" | "ready" | "degraded" | "stale" | "error";
  detail: string;
  receivers: Array<{
    id: string;
    name: string;
    host: string;
    model: string | null;
    firmware: string | null;
    compatibility: "compatible-read-only";
    status: "connecting" | "ready" | "stale" | "error";
    detail: string;
    capabilities: {
      antennaDiversity: boolean;
      linkQuality: boolean;
      interference: boolean;
      audioMeter: boolean;
      batteryHealth: boolean;
      transmitterDetail: boolean;
    };
    channels: Array<{
      index: number;
      linkStatus: "no-transmitter" | "active" | "unavailable";
      batteryBars: number | null;
      batteryChargePercent: number | null;
      batteryType: string | null;
      batteryCycleCount: number | null;
      batteryRunTimeMinutes: number | null;
      antennas: Array<{
        label: "A" | "B" | "C" | "D";
        active: boolean | null;
      }>;
      rfLevelDbm: number | null;
      rfLevelRaw: number | null;
      linkQualityRaw: number | null;
      interference: "none" | "detected" | "unavailable";
      audioLevelDbfs: number | null;
      audioLevelRaw: number | null;
      frequencyRaw: string | null;
      groupChannelRaw: string | null;
      transmitter: {
        type: string | null;
        name: string | null;
        muted: boolean | null;
      };
      warnings: Array<string>;
      observedAtUtc: string | null;
      availability: "observed" | "unavailable" | "stale";
    }>;
  }>;
};

export type ProductionSummary = {
  id: string;
  name: string;
  revision: number;
  updatedAtUtc: string | null;
  channelCount: number;
  receiverCount: number;
};

export type ProductionList = {
  schemaVersion: "0";
  activeId: string | null;
  productions: Array<ProductionSummary>;
};

export type LevelValue = number | null;

export type ChannelLevelSample = {
  atUtc: string;
  audioDbfs: LevelValue;
  rfLevelDbm: LevelValue;
  linkQualityPercent: number | null;
  batteryPercent: number | null;
  availability: "observed" | "stale" | "unknown";
};

export type ChannelLevelHistory = {
  schemaVersion: "0";
  channelId: string;
  generatedAtUtc: string;
  windowMs: number;
  intervalMs: number;
  samples: Array<ChannelLevelSample>;
};

export type NodeInputLevel = {
  index: number;
  peakDbfs: number | null;
  rmsDbfs: number | null;
  clippedSamples: number;
};

export type NodeLevels = {
  schemaVersion: "0";
  generatedAtUtc: string;
  capture: {
    status: "ready" | "configuration-required" | "starting" | "error";
    detail: string;
    device: {
      name: string;
      sampleRateHz: number;
      channelCount: number;
      simulated: boolean;
    } | null;
  };
  windowMs: number;
  inputs: Array<NodeInputLevel>;
};

export type MeterFrame = {
  schemaVersion: "0";
  sequence: number;
  intervalMs: number;
  peakDbfs: Array<number>;
  rmsDbfs: Array<number>;
  clipped: Array<boolean>;
};

export type HostOutput = {
  schemaVersion: "0";
  revision: number;
  output: {
    status: "starting" | "ready" | "error";
    detail: string;
    deviceName: string;
    outputChannels: Array<number>;
    simulated: boolean;
    underruns: number;
    droppedFrames: number;
  } | null;
  monitor: {
    channelId: string | null;
    input: number | null;
    muted: boolean;
    dimmed: boolean;
    gainDb: number;
    changedBy: string | null;
    changedAtUtc: string | null;
  };
};

export type LiveStateVerdict =
  "good" | "fault" | "caution" | "unknown" | "not-applicable";

export type LiveStateAvailability = "observed" | "stale" | "unknown";

export type LiveStateReceiverUnit = {
  id: string;
  name: string;
  model: string | null;
  status: "connecting" | "ready" | "stale" | "error";
  detail: string;
};

export type LiveStateChannel = {
  id: string;
  number: number;
  name: string;
  performer: string | null;
  kind: "wireless" | "wired";
  micType:
    | "lavalier"
    | "headset"
    | "handheld"
    | "boundary"
    | "instrument"
    | "other"
    | null;
  hasImage: boolean;
  input: {
    index: number | null;
    label: string;
  };
  receiver: {
    id: string;
    name: string;
    model: string | null;
    channelIndex: number;
    status: "connecting" | "ready" | "stale" | "error" | "missing";
    frequencyRaw: string | null;
    groupChannelRaw: string | null;
  } | null;
  monitor: {
    battery: boolean;
    rf: boolean;
    audio: boolean;
  };
  statuses: {
    rf: LiveStateVerdict;
    audio: LiveStateVerdict;
    battery: LiveStateVerdict;
    check: LiveStateVerdict;
  };
  audio: {
    availability: LiveStateAvailability;
    peakDbfs: number | null;
    rmsDbfs: number | null;
    silentForMs: number | null;
    clipping: boolean;
  };
  rf: {
    availability: LiveStateAvailability;
    levelDbm: number | null;
    linkQualityPercent: number | null;
    activeAntenna: "A" | "B" | "C" | "D" | null;
    interference: "none" | "detected" | "unavailable";
    transmitterPresent: boolean | null;
  };
  battery: {
    availability: LiveStateAvailability;
    percent: number | null;
    bars: number | null;
    runtimeMinutes: number | null;
    type: string | null;
  };
  transmitter: {
    type: string | null;
    name: string | null;
    muted: boolean | null;
    observedAtUtc: string | null;
  };
  check: {
    passed: number;
    failed: number;
    waiting: number;
    total: 8;
    stale: boolean;
    updatedAtUtc: string;
  } | null;
};

export type LiveAlert = {
  id: string;
  kind:
    | "battery-low"
    | "battery-critical"
    | "rf-low"
    | "rf-lost"
    | "link-quality-low"
    | "interference"
    | "encryption-mismatch"
    | "tx-muted"
    | "no-audio"
    | "clipping"
    | "receiver-offline"
    | "capture-error"
    | "node-unreachable";
  dimension: "RF" | "Audio" | "Battery" | "System";
  severity: "critical" | "caution";
  label: string;
  detail: string;
  channelId: string | null;
  channelNumber: number | null;
  channelName: string | null;
  receiverId: string | null;
  raisedAtUtc: string;
  acknowledgedAtUtc: string | null;
  acknowledgedBy: string | null;
  clearedAtUtc: string | null;
  overlayExpiresAtUtc: string | null;
};

export type FaultReport = {
  id: string;
  channelId: string;
  channelNumber: number;
  channelName: string;
  performer: string | null;
  faults: Array<ReportedFault>;
  note: string | null;
  urgent: boolean;
  incident: boolean;
  incidentReason: "urgent" | "telemetry" | null;
  status: "open" | "claimed" | "awaiting-confirmation" | "closed" | "cancelled";
  requestedBy: string;
  requestedAtUtc: string;
  undoUntilUtc: string;
  claimedBy: string | null;
  claimedAtUtc: string | null;
  resolvedBy: string | null;
  resolvedAtUtc: string | null;
  closedAtUtc: string | null;
};

export type ReportedFault =
  | "dropping-out"
  | "crackling"
  | "distorted"
  | "too-quiet"
  | "clothing-noise"
  | "popping"
  | "hum-buzz"
  | "nothing-at-all"
  | "other";

export type LiveState = {
  schemaVersion: "0";
  revision: number;
  generatedAtUtc: string;
  show: {
    name: string;
    showfileRevision: number;
    overlayExpiryMs: number;
  };
  node: {
    status:
      "ready" | "starting" | "configuration-required" | "error" | "unreachable";
    detail: string;
    device: {
      name: string;
      sampleRateHz: number;
      channelCount: number;
      simulated: boolean;
    } | null;
    observedAtUtc: string | null;
  };
  receivers: {
    status:
      | "unconfigured"
      | "connecting"
      | "ready"
      | "degraded"
      | "stale"
      | "error"
      | "unavailable";
    detail: string;
    units: Array<LiveStateReceiverUnit>;
  };
  channels: Array<LiveStateChannel>;
  alerts: Array<LiveAlert>;
  reports: Array<FaultReport>;
  summary: {
    active: number;
    outstanding: number;
    outstandingCritical: number;
  };
};

export type LoggedAlert = {
  id: string;
  kind:
    | "battery-low"
    | "battery-critical"
    | "rf-low"
    | "rf-lost"
    | "link-quality-low"
    | "interference"
    | "encryption-mismatch"
    | "tx-muted"
    | "no-audio"
    | "clipping"
    | "receiver-offline"
    | "capture-error"
    | "node-unreachable";
  dimension: "RF" | "Audio" | "Battery" | "System";
  severity: "critical" | "caution";
  label: string;
  detail: string;
  channelId: string | null;
  channelNumber: number | null;
  channelName: string | null;
  receiverId: string | null;
  raisedAtUtc: string;
  acknowledgedAtUtc: string | null;
  acknowledgedBy: string | null;
  clearedAtUtc: string | null;
  overlayExpiresAtUtc: string | null;
};

export type AlertLog = {
  schemaVersion: "0";
  generatedAtUtc: string;
  active: Array<LoggedAlert>;
  history: Array<LoggedAlert>;
};

export type MicCheckDimensionId =
  | "physical-identity"
  | "rf-link"
  | "captured-audio"
  | "mute-control"
  | "primary-spare"
  | "battery-window"
  | "placement-costume"
  | "operator-signoff";

export type MicCheckDimensionRecord = {
  id: MicCheckDimensionId;
  verdict: "pass" | "fail" | "waiting";
  by: string;
  atUtc: string;
  reason: string | null;
};

export type MicCheckSubject = {
  inputIndex: number | null;
  receiverId: string | null;
  receiverChannelIndex: number | null;
  performer: string | null;
};

export type ChannelMicCheck = {
  channelId: string;
  subject: MicCheckSubject;
  startedAtUtc: string;
  updatedAtUtc: string;
  dimensions: Array<MicCheckDimensionRecord>;
  stale: boolean;
};

export type MicChecks = {
  schemaVersion: "0";
  generatedAtUtc: string;
  checks: Array<ChannelMicCheck>;
};

export class ProtocolContractError extends Error {
  constructor(contract: string, path: string) {
    super(`${contract} did not match its closed schema at ${path}.`);
    this.name = "ProtocolContractError";
  }
}

export class ProtocolHttpError extends Error {
  readonly status: number;

  constructor(status: number, path: string) {
    super(`Request to ${path} failed with HTTP ${status}.`);
    this.name = "ProtocolHttpError";
    this.status = status;
  }
}

const healthResponseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pulse.local/schema/v0/http/health-response.schema.json",
  title: "Backend health response",
  type: "object",
  additionalProperties: false,
  required: ["status", "service", "version"],
  properties: {
    status: {
      const: "ok",
    },
    service: {
      const: "pulse-backend",
    },
    version: {
      type: "string",
      minLength: 1,
      maxLength: 64,
    },
  },
} as const;

const liveSnapshotSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pulse.local/schema/v0/http/live-snapshot-response.schema.json",
  title: "Live snapshot response",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "generatedAtUtc",
    "source",
    "show",
    "node",
    "channels",
  ],
  properties: {
    schemaVersion: {
      const: "0",
    },
    generatedAtUtc: {
      type: "string",
      format: "date-time",
    },
    source: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "label"],
      properties: {
        kind: {
          const: "fabricated",
        },
        label: {
          type: "string",
          minLength: 1,
          maxLength: 160,
        },
      },
    },
    show: {
      type: "object",
      additionalProperties: false,
      required: ["name", "venue", "performanceLabel"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
        venue: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
        performanceLabel: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
      },
    },
    node: {
      type: "object",
      additionalProperties: false,
      required: ["status", "channelCount", "sampleRateHz"],
      properties: {
        status: {
          enum: ["ready", "waiting", "offline"],
        },
        channelCount: {
          type: ["integer", "null"],
          minimum: 0,
          maximum: 128,
        },
        sampleRateHz: {
          type: ["integer", "null"],
          minimum: 8000,
          maximum: 384000,
        },
      },
    },
    channels: {
      type: "array",
      maxItems: 128,
      items: {
        $ref: "#/$defs/channel",
      },
    },
  },
  $defs: {
    verdict: {
      enum: ["good", "fault", "caution", "unknown", "not-applicable"],
    },
    nullableNumber: {
      type: ["number", "null"],
    },
    channel: {
      type: "object",
      additionalProperties: false,
      required: [
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
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: 64,
        },
        number: {
          type: "integer",
          minimum: 1,
          maximum: 999,
        },
        character: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
        performer: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
        kind: {
          enum: ["wireless", "wired"],
        },
        zone: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
        levelDbfs: {
          $ref: "#/$defs/nullableNumber",
        },
        statuses: {
          type: "object",
          additionalProperties: false,
          required: ["rf", "audio", "battery", "check"],
          properties: {
            rf: {
              $ref: "#/$defs/verdict",
            },
            audio: {
              $ref: "#/$defs/verdict",
            },
            battery: {
              $ref: "#/$defs/verdict",
            },
            check: {
              $ref: "#/$defs/verdict",
            },
          },
        },
        alert: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "label", "dimension"],
          properties: {
            severity: {
              enum: ["critical", "caution"],
            },
            label: {
              type: "string",
              minLength: 1,
              maxLength: 80,
            },
            dimension: {
              enum: ["RF", "Audio", "Battery"],
            },
          },
        },
        details: {
          type: "object",
          additionalProperties: false,
          required: [
            "receiver",
            "input",
            "rfLevelDbm",
            "linkQualityPercent",
            "batteryRemaining",
            "telemetryAge",
          ],
          properties: {
            receiver: {
              type: "string",
              minLength: 1,
              maxLength: 160,
            },
            input: {
              type: "string",
              minLength: 1,
              maxLength: 80,
            },
            rfLevelDbm: {
              $ref: "#/$defs/nullableNumber",
            },
            linkQualityPercent: {
              type: ["number", "null"],
              minimum: 0,
              maximum: 100,
            },
            batteryRemaining: {
              type: ["string", "null"],
              maxLength: 80,
            },
            telemetryAge: {
              type: "string",
              minLength: 1,
              maxLength: 120,
            },
          },
        },
      },
    },
  },
} as const;

const showfileSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pulse.local/schema/v0/http/showfile.schema.json",
  title: "Local showfile",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "revision",
    "updatedAtUtc",
    "show",
    "device",
    "channels",
    "shureReceivers",
  ],
  properties: {
    schemaVersion: {
      const: "0",
    },
    revision: {
      type: "integer",
      minimum: 0,
      maximum: 2147483647,
    },
    updatedAtUtc: {
      type: ["string", "null"],
      format: "date-time",
    },
    show: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
      },
    },
    alertPolicy: {
      type: "object",
      additionalProperties: false,
      required: [
        "batteryCautionPercent",
        "batteryCriticalPercent",
        "rfCautionDbm",
        "rfCriticalDbm",
        "qualityCautionPercent",
        "qualityCriticalPercent",
        "silenceFloorDbfs",
        "silenceAfterSeconds",
        "clipAlerts",
        "overlayExpiryMinutes",
      ],
      properties: {
        batteryCautionPercent: {
          type: "integer",
          minimum: 1,
          maximum: 100,
        },
        batteryCriticalPercent: {
          type: "integer",
          minimum: 0,
          maximum: 100,
        },
        rfCautionDbm: {
          type: "integer",
          minimum: -130,
          maximum: 0,
        },
        rfCriticalDbm: {
          type: "integer",
          minimum: -130,
          maximum: 0,
        },
        qualityCautionPercent: {
          type: "integer",
          minimum: 0,
          maximum: 100,
        },
        qualityCriticalPercent: {
          type: "integer",
          minimum: 0,
          maximum: 100,
        },
        silenceFloorDbfs: {
          type: "integer",
          minimum: -120,
          maximum: 0,
        },
        silenceAfterSeconds: {
          type: "integer",
          minimum: 5,
          maximum: 3600,
        },
        clipAlerts: {
          type: "boolean",
        },
        overlayExpiryMinutes: {
          type: "integer",
          minimum: 1,
          maximum: 60,
        },
      },
    },
    hostOutput: {
      description:
        "Host monitor output settings for this production (ADR 0029). outputChannels are the 1-based channels of the node's host output device that carry the shared monitor feed: at least one, all distinct. Absent means the node's own default.",
      type: "object",
      additionalProperties: false,
      required: ["outputChannels"],
      properties: {
        outputChannels: {
          type: "array",
          maxItems: 8,
          items: {
            type: "integer",
            minimum: 1,
            maximum: 256,
          },
        },
      },
    },
    device: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["name", "channelCount"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 240,
        },
        channelCount: {
          type: "integer",
          minimum: 1,
          maximum: 128,
        },
      },
    },
    shureReceivers: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "host", "model", "channelCount"],
        properties: {
          id: {
            type: "string",
            minLength: 1,
            maxLength: 64,
          },
          name: {
            type: "string",
            minLength: 1,
            maxLength: 120,
          },
          host: {
            type: "string",
            minLength: 1,
            maxLength: 45,
          },
          model: {
            enum: [
              "AD4D",
              "AD4D-DC",
              "AD4Q",
              "AD4Q-DC",
              "ANX4",
              "ULXD4",
              "ULXD4D",
              "ULXD4Q",
              "ULXD4-GV",
              "ULXD4D-GV",
              "ULXD4Q-GV",
              "QLXD4",
              "SLXD4",
              "SLXD4D",
              "SLXD4+",
              "SLXD4D+",
              "SLXD4Q+",
              "SLXD4QDAN+",
            ],
          },
          channelCount: {
            type: "integer",
            minimum: 1,
            maximum: 128,
          },
        },
      },
    },
    channels: {
      type: "array",
      maxItems: 128,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["inputIndex", "name"],
        properties: {
          id: {
            type: "string",
            minLength: 1,
            maxLength: 64,
          },
          inputIndex: {
            type: ["integer", "null"],
            minimum: 0,
            maximum: 127,
          },
          name: {
            type: "string",
            minLength: 1,
            maxLength: 120,
          },
          performer: {
            type: ["string", "null"],
            maxLength: 120,
          },
          shureChannelIndex: {
            type: ["integer", "null"],
            minimum: 0,
            maximum: 127,
          },
          shureReceiverId: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 64,
          },
          micType: {
            enum: [
              "lavalier",
              "headset",
              "handheld",
              "boundary",
              "instrument",
              "other",
              null,
            ],
          },
          imageUrl: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 300000,
          },
          monitor: {
            type: "object",
            additionalProperties: false,
            required: ["battery", "rf", "audio"],
            properties: {
              battery: {
                type: "boolean",
              },
              rf: {
                type: "boolean",
              },
              audio: {
                type: "boolean",
              },
            },
          },
        },
      },
    },
  },
} as const;

const shureTelemetrySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pulse.local/schema/v0/http/shure-telemetry.schema.json",
  title: "Shure receiver fleet telemetry",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "status", "detail", "receivers"],
  properties: {
    schemaVersion: {
      const: "0",
    },
    status: {
      enum: [
        "unconfigured",
        "connecting",
        "ready",
        "degraded",
        "stale",
        "error",
      ],
    },
    detail: {
      type: "string",
      minLength: 1,
      maxLength: 240,
    },
    receivers: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "name",
          "host",
          "model",
          "firmware",
          "compatibility",
          "status",
          "detail",
          "capabilities",
          "channels",
        ],
        properties: {
          id: {
            type: "string",
            minLength: 1,
            maxLength: 64,
          },
          name: {
            type: "string",
            minLength: 1,
            maxLength: 120,
          },
          host: {
            type: "string",
            minLength: 1,
            maxLength: 255,
          },
          model: {
            type: ["string", "null"],
            maxLength: 64,
          },
          firmware: {
            type: ["string", "null"],
            maxLength: 64,
          },
          compatibility: {
            const: "compatible-read-only",
          },
          status: {
            enum: ["connecting", "ready", "stale", "error"],
          },
          detail: {
            type: "string",
            minLength: 1,
            maxLength: 240,
          },
          capabilities: {
            type: "object",
            additionalProperties: false,
            required: [
              "antennaDiversity",
              "linkQuality",
              "interference",
              "audioMeter",
              "batteryHealth",
              "transmitterDetail",
            ],
            properties: {
              antennaDiversity: {
                type: "boolean",
              },
              linkQuality: {
                type: "boolean",
              },
              interference: {
                type: "boolean",
              },
              audioMeter: {
                type: "boolean",
              },
              batteryHealth: {
                type: "boolean",
              },
              transmitterDetail: {
                type: "boolean",
              },
            },
          },
          channels: {
            type: "array",
            maxItems: 128,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "index",
                "linkStatus",
                "batteryBars",
                "batteryChargePercent",
                "batteryType",
                "batteryCycleCount",
                "batteryRunTimeMinutes",
                "antennas",
                "rfLevelDbm",
                "rfLevelRaw",
                "linkQualityRaw",
                "interference",
                "audioLevelDbfs",
                "audioLevelRaw",
                "frequencyRaw",
                "groupChannelRaw",
                "transmitter",
                "warnings",
                "observedAtUtc",
                "availability",
              ],
              properties: {
                index: {
                  type: "integer",
                  minimum: 0,
                  maximum: 127,
                },
                linkStatus: {
                  enum: ["no-transmitter", "active", "unavailable"],
                },
                batteryBars: {
                  type: ["integer", "null"],
                  minimum: 0,
                  maximum: 5,
                },
                batteryChargePercent: {
                  type: ["integer", "null"],
                  minimum: 0,
                  maximum: 100,
                },
                batteryType: {
                  type: ["string", "null"],
                  maxLength: 32,
                },
                batteryCycleCount: {
                  type: ["integer", "null"],
                  minimum: 0,
                  maximum: 100000,
                },
                batteryRunTimeMinutes: {
                  type: ["integer", "null"],
                  minimum: 0,
                  maximum: 1440,
                },
                antennas: {
                  type: "array",
                  maxItems: 4,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["label", "active"],
                    properties: {
                      label: {
                        enum: ["A", "B", "C", "D"],
                      },
                      active: {
                        type: ["boolean", "null"],
                      },
                    },
                  },
                },
                rfLevelDbm: {
                  type: ["integer", "null"],
                  minimum: -160,
                  maximum: 0,
                },
                rfLevelRaw: {
                  type: ["integer", "null"],
                  minimum: 0,
                  maximum: 1023,
                },
                linkQualityRaw: {
                  type: ["integer", "null"],
                  minimum: 0,
                  maximum: 1023,
                },
                interference: {
                  enum: ["none", "detected", "unavailable"],
                },
                audioLevelDbfs: {
                  type: ["integer", "null"],
                  minimum: -160,
                  maximum: 0,
                },
                audioLevelRaw: {
                  type: ["integer", "null"],
                  minimum: 0,
                  maximum: 1023,
                },
                frequencyRaw: {
                  type: ["string", "null"],
                  maxLength: 16,
                },
                groupChannelRaw: {
                  type: ["string", "null"],
                  maxLength: 16,
                },
                transmitter: {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "name", "muted"],
                  properties: {
                    type: {
                      type: ["string", "null"],
                      maxLength: 64,
                    },
                    name: {
                      type: ["string", "null"],
                      maxLength: 64,
                    },
                    muted: {
                      type: ["boolean", "null"],
                    },
                  },
                },
                warnings: {
                  type: "array",
                  maxItems: 8,
                  items: {
                    type: "string",
                    minLength: 1,
                    maxLength: 120,
                  },
                },
                observedAtUtc: {
                  type: ["string", "null"],
                  format: "date-time",
                },
                availability: {
                  enum: ["observed", "unavailable", "stale"],
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const productionListSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pulse.local/schema/v0/http/production-list.schema.json",
  title: "Production list",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "activeId", "productions"],
  properties: {
    schemaVersion: {
      const: "0",
    },
    activeId: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: 64,
    },
    productions: {
      type: "array",
      maxItems: 256,
      items: {
        $ref: "#/$defs/production",
      },
    },
  },
  $defs: {
    production: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "name",
        "revision",
        "updatedAtUtc",
        "channelCount",
        "receiverCount",
      ],
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: 64,
        },
        name: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
        revision: {
          type: "integer",
          minimum: 0,
          maximum: 2147483647,
        },
        updatedAtUtc: {
          type: ["string", "null"],
          format: "date-time",
        },
        channelCount: {
          type: "integer",
          minimum: 0,
          maximum: 128,
        },
        receiverCount: {
          type: "integer",
          minimum: 0,
          maximum: 64,
        },
      },
    },
  },
} as const;

const channelLevelHistorySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pulse.local/schema/v0/http/channel-level-history.schema.json",
  title: "Channel level history",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "channelId",
    "generatedAtUtc",
    "windowMs",
    "intervalMs",
    "samples",
  ],
  properties: {
    schemaVersion: {
      const: "0",
    },
    channelId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
    },
    generatedAtUtc: {
      type: "string",
      format: "date-time",
    },
    windowMs: {
      type: "integer",
      minimum: 1000,
      maximum: 3600000,
    },
    intervalMs: {
      type: "integer",
      minimum: 100,
      maximum: 60000,
    },
    samples: {
      type: "array",
      maxItems: 3600,
      items: {
        $ref: "#/$defs/sample",
      },
    },
  },
  $defs: {
    levelValue: {
      type: ["number", "null"],
    },
    sample: {
      type: "object",
      additionalProperties: false,
      required: [
        "atUtc",
        "audioDbfs",
        "rfLevelDbm",
        "linkQualityPercent",
        "batteryPercent",
        "availability",
      ],
      properties: {
        atUtc: {
          type: "string",
          format: "date-time",
        },
        audioDbfs: {
          $ref: "#/$defs/levelValue",
        },
        rfLevelDbm: {
          $ref: "#/$defs/levelValue",
        },
        linkQualityPercent: {
          type: ["number", "null"],
          minimum: 0,
          maximum: 100,
        },
        batteryPercent: {
          type: ["number", "null"],
          minimum: 0,
          maximum: 100,
        },
        availability: {
          enum: ["observed", "stale", "unknown"],
        },
      },
    },
  },
} as const;

const nodeLevelsSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pulse.local/schema/v0/http/node-levels.schema.json",
  title: "Audio node capture state and input level summary",
  description:
    "Served by the audio node at GET /audio/v0/levels. Levels are the peak and RMS of each captured input over the trailing window, in dBFS, floored at -120 for digital silence and ceilinged at 0. A null level means no audio was captured for that input inside the window.",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "generatedAtUtc",
    "capture",
    "windowMs",
    "inputs",
  ],
  properties: {
    schemaVersion: {
      const: "0",
    },
    generatedAtUtc: {
      type: "string",
      format: "date-time",
    },
    capture: {
      type: "object",
      additionalProperties: false,
      required: ["status", "detail", "device"],
      properties: {
        status: {
          enum: ["ready", "configuration-required", "starting", "error"],
        },
        detail: {
          type: "string",
          minLength: 1,
          maxLength: 240,
        },
        device: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["name", "sampleRateHz", "channelCount", "simulated"],
          properties: {
            name: {
              type: "string",
              minLength: 1,
              maxLength: 512,
            },
            sampleRateHz: {
              type: "integer",
              minimum: 8000,
              maximum: 384000,
            },
            channelCount: {
              type: "integer",
              minimum: 1,
              maximum: 256,
            },
            simulated: {
              type: "boolean",
            },
          },
        },
      },
    },
    windowMs: {
      type: "integer",
      minimum: 100,
      maximum: 10000,
    },
    inputs: {
      type: "array",
      maxItems: 256,
      items: {
        $ref: "#/$defs/inputLevel",
      },
    },
  },
  $defs: {
    inputLevel: {
      type: "object",
      additionalProperties: false,
      required: ["index", "peakDbfs", "rmsDbfs", "clippedSamples"],
      properties: {
        index: {
          type: "integer",
          minimum: 0,
          maximum: 255,
        },
        peakDbfs: {
          type: ["number", "null"],
          minimum: -120,
          maximum: 0,
        },
        rmsDbfs: {
          type: ["number", "null"],
          minimum: -120,
          maximum: 0,
        },
        clippedSamples: {
          type: "integer",
          minimum: 0,
          maximum: 10000000,
        },
      },
    },
  },
} as const;

const meterFrameSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pulse.local/schema/v0/http/meter-frame.schema.json",
  title: "Audio node meter frame",
  description:
    "The data of one `meters` event on the audio node's /audio/v0/meters Server-Sent Events stream. Each array holds one value per captured input, indexed by input. Levels are dBFS over the frame interval, floored at -120 for digital silence. Meters are measurements of captured audio, never samples.",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "sequence",
    "intervalMs",
    "peakDbfs",
    "rmsDbfs",
    "clipped",
  ],
  properties: {
    schemaVersion: {
      const: "0",
    },
    sequence: {
      type: "integer",
      minimum: 0,
      maximum: 9007199254740991,
    },
    intervalMs: {
      type: "integer",
      minimum: 10,
      maximum: 1000,
    },
    peakDbfs: {
      type: "array",
      maxItems: 256,
      items: {
        type: "number",
        minimum: -120,
        maximum: 0,
      },
    },
    rmsDbfs: {
      type: "array",
      maxItems: 256,
      items: {
        type: "number",
        minimum: -120,
        maximum: 0,
      },
    },
    clipped: {
      type: "array",
      maxItems: 256,
      items: {
        type: "boolean",
      },
    },
  },
} as const;

const hostOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pulse.local/schema/v0/http/host-output.schema.json",
  title: "Audio node host output",
  description:
    "The audio node's shared host monitor output (ADR 0029), served at GET /audio/v0/output and as `output` events on /audio/v0/output/events. `output` is null when the node has no output device configured. `monitor` is the one mix every Live client in host-output mode shares: a change by any client is heard on the host output and shown to every client. `revision` increases with every monitor change.",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "revision", "output", "monitor"],
  properties: {
    schemaVersion: {
      const: "0",
    },
    revision: {
      type: "integer",
      minimum: 0,
      maximum: 9007199254740991,
    },
    output: {
      type: ["object", "null"],
      additionalProperties: false,
      required: [
        "status",
        "detail",
        "deviceName",
        "outputChannels",
        "simulated",
        "underruns",
        "droppedFrames",
      ],
      properties: {
        status: {
          enum: ["starting", "ready", "error"],
        },
        detail: {
          type: "string",
          minLength: 1,
          maxLength: 240,
        },
        deviceName: {
          type: "string",
          minLength: 1,
          maxLength: 512,
        },
        outputChannels: {
          description:
            "1-based device output channels that carry the mono monitor feed.",
          type: "array",
          maxItems: 8,
          items: {
            type: "integer",
            minimum: 1,
            maximum: 256,
          },
        },
        simulated: {
          type: "boolean",
        },
        underruns: {
          description:
            "Device callbacks that found no audio queued since the output last started.",
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        droppedFrames: {
          description:
            "Frames skipped or dropped to bound latency since the output last started.",
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
      },
    },
    monitor: {
      type: "object",
      additionalProperties: false,
      required: [
        "channelId",
        "input",
        "muted",
        "dimmed",
        "gainDb",
        "changedBy",
        "changedAtUtc",
      ],
      properties: {
        channelId: {
          description:
            "The show channel whose input is selected, as the selecting client named it. Null when nothing is selected.",
          type: ["string", "null"],
          minLength: 1,
          maxLength: 128,
        },
        input: {
          description:
            "0-based captured input that is playing. Null when nothing is selected.",
          type: ["integer", "null"],
          minimum: 0,
          maximum: 255,
        },
        muted: {
          type: "boolean",
        },
        dimmed: {
          type: "boolean",
        },
        gainDb: {
          type: "number",
          minimum: -60,
          maximum: 12,
        },
        changedBy: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 80,
        },
        changedAtUtc: {
          type: ["string", "null"],
          format: "date-time",
        },
      },
    },
  },
} as const;

const liveStateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pulse.local/schema/v0/http/live-state.schema.json",
  title: "Live monitoring state",
  description:
    "The backend's shared monitoring truth for the active show: channel identity from the showfile, per-dimension verdicts and measurements from the audio node and receiver telemetry, and the active alert set. Served at GET /api/v1/live/state and as the data of each 'state' event on GET /api/v1/live/events.",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "revision",
    "generatedAtUtc",
    "show",
    "node",
    "receivers",
    "channels",
    "alerts",
    "summary",
    "reports",
  ],
  properties: {
    schemaVersion: {
      const: "0",
    },
    revision: {
      type: "integer",
      minimum: 0,
      maximum: 9007199254740991,
    },
    generatedAtUtc: {
      type: "string",
      format: "date-time",
    },
    show: {
      type: "object",
      additionalProperties: false,
      required: ["name", "showfileRevision", "overlayExpiryMs"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
        showfileRevision: {
          type: "integer",
          minimum: 0,
          maximum: 2147483647,
        },
        overlayExpiryMs: {
          type: "integer",
          minimum: 60000,
          maximum: 3600000,
        },
      },
    },
    node: {
      type: "object",
      additionalProperties: false,
      required: ["status", "detail", "device", "observedAtUtc"],
      properties: {
        status: {
          enum: [
            "ready",
            "starting",
            "configuration-required",
            "error",
            "unreachable",
          ],
        },
        detail: {
          type: "string",
          minLength: 1,
          maxLength: 240,
        },
        device: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["name", "sampleRateHz", "channelCount", "simulated"],
          properties: {
            name: {
              type: "string",
              minLength: 1,
              maxLength: 512,
            },
            sampleRateHz: {
              type: "integer",
              minimum: 8000,
              maximum: 384000,
            },
            channelCount: {
              type: "integer",
              minimum: 1,
              maximum: 256,
            },
            simulated: {
              type: "boolean",
            },
          },
        },
        observedAtUtc: {
          type: ["string", "null"],
          format: "date-time",
        },
      },
    },
    receivers: {
      type: "object",
      additionalProperties: false,
      required: ["status", "detail", "units"],
      properties: {
        status: {
          enum: [
            "unconfigured",
            "connecting",
            "ready",
            "degraded",
            "stale",
            "error",
            "unavailable",
          ],
        },
        detail: {
          type: "string",
          minLength: 1,
          maxLength: 240,
        },
        units: {
          type: "array",
          maxItems: 64,
          items: {
            $ref: "#/$defs/receiverUnit",
          },
        },
      },
    },
    channels: {
      type: "array",
      maxItems: 128,
      items: {
        $ref: "#/$defs/channel",
      },
    },
    alerts: {
      type: "array",
      maxItems: 512,
      items: {
        $ref: "#/$defs/alert",
      },
    },
    reports: {
      description:
        "A1 fault reports that are open, being worked, awaiting the A1's confirmation, or closed within the last few minutes.",
      type: "array",
      maxItems: 256,
      items: {
        $ref: "#/$defs/faultReport",
      },
    },
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["active", "outstanding", "outstandingCritical"],
      properties: {
        active: {
          type: "integer",
          minimum: 0,
          maximum: 512,
        },
        outstanding: {
          type: "integer",
          minimum: 0,
          maximum: 512,
        },
        outstandingCritical: {
          type: "integer",
          minimum: 0,
          maximum: 512,
        },
      },
    },
  },
  $defs: {
    verdict: {
      enum: ["good", "fault", "caution", "unknown", "not-applicable"],
    },
    availability: {
      enum: ["observed", "stale", "unknown"],
    },
    receiverUnit: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "model", "status", "detail"],
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: 64,
        },
        name: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
        model: {
          type: ["string", "null"],
          maxLength: 64,
        },
        status: {
          enum: ["connecting", "ready", "stale", "error"],
        },
        detail: {
          type: "string",
          minLength: 1,
          maxLength: 240,
        },
      },
    },
    channel: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "number",
        "name",
        "performer",
        "kind",
        "micType",
        "hasImage",
        "input",
        "receiver",
        "monitor",
        "statuses",
        "audio",
        "rf",
        "battery",
        "transmitter",
        "check",
      ],
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: 64,
        },
        number: {
          type: "integer",
          minimum: 1,
          maximum: 999,
        },
        name: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
        performer: {
          type: ["string", "null"],
          maxLength: 120,
        },
        kind: {
          enum: ["wireless", "wired"],
        },
        micType: {
          enum: [
            "lavalier",
            "headset",
            "handheld",
            "boundary",
            "instrument",
            "other",
            null,
          ],
        },
        hasImage: {
          type: "boolean",
        },
        input: {
          type: "object",
          additionalProperties: false,
          required: ["index", "label"],
          properties: {
            index: {
              type: ["integer", "null"],
              minimum: 0,
              maximum: 255,
            },
            label: {
              type: "string",
              minLength: 1,
              maxLength: 160,
            },
          },
        },
        receiver: {
          type: ["object", "null"],
          additionalProperties: false,
          required: [
            "id",
            "name",
            "model",
            "channelIndex",
            "status",
            "frequencyRaw",
            "groupChannelRaw",
          ],
          properties: {
            id: {
              type: "string",
              minLength: 1,
              maxLength: 64,
            },
            name: {
              type: "string",
              minLength: 1,
              maxLength: 120,
            },
            model: {
              type: ["string", "null"],
              maxLength: 64,
            },
            channelIndex: {
              type: "integer",
              minimum: 0,
              maximum: 127,
            },
            status: {
              enum: ["connecting", "ready", "stale", "error", "missing"],
            },
            frequencyRaw: {
              type: ["string", "null"],
              maxLength: 16,
            },
            groupChannelRaw: {
              type: ["string", "null"],
              maxLength: 16,
            },
          },
        },
        monitor: {
          type: "object",
          additionalProperties: false,
          required: ["battery", "rf", "audio"],
          properties: {
            battery: {
              type: "boolean",
            },
            rf: {
              type: "boolean",
            },
            audio: {
              type: "boolean",
            },
          },
        },
        statuses: {
          type: "object",
          additionalProperties: false,
          required: ["rf", "audio", "battery", "check"],
          properties: {
            rf: {
              $ref: "#/$defs/verdict",
            },
            audio: {
              $ref: "#/$defs/verdict",
            },
            battery: {
              $ref: "#/$defs/verdict",
            },
            check: {
              $ref: "#/$defs/verdict",
            },
          },
        },
        audio: {
          type: "object",
          additionalProperties: false,
          required: [
            "availability",
            "peakDbfs",
            "rmsDbfs",
            "silentForMs",
            "clipping",
          ],
          properties: {
            availability: {
              $ref: "#/$defs/availability",
            },
            peakDbfs: {
              type: ["number", "null"],
              minimum: -120,
              maximum: 0,
            },
            rmsDbfs: {
              type: ["number", "null"],
              minimum: -120,
              maximum: 0,
            },
            silentForMs: {
              type: ["integer", "null"],
              minimum: 0,
              maximum: 9007199254740991,
            },
            clipping: {
              type: "boolean",
            },
          },
        },
        rf: {
          type: "object",
          additionalProperties: false,
          required: [
            "availability",
            "levelDbm",
            "linkQualityPercent",
            "activeAntenna",
            "interference",
            "transmitterPresent",
          ],
          properties: {
            availability: {
              $ref: "#/$defs/availability",
            },
            levelDbm: {
              type: ["number", "null"],
              minimum: -160,
              maximum: 0,
            },
            linkQualityPercent: {
              type: ["number", "null"],
              minimum: 0,
              maximum: 100,
            },
            activeAntenna: {
              enum: ["A", "B", "C", "D", null],
            },
            interference: {
              enum: ["none", "detected", "unavailable"],
            },
            transmitterPresent: {
              type: ["boolean", "null"],
            },
          },
        },
        battery: {
          type: "object",
          additionalProperties: false,
          required: [
            "availability",
            "percent",
            "bars",
            "runtimeMinutes",
            "type",
          ],
          properties: {
            availability: {
              $ref: "#/$defs/availability",
            },
            percent: {
              type: ["integer", "null"],
              minimum: 0,
              maximum: 100,
            },
            bars: {
              type: ["integer", "null"],
              minimum: 0,
              maximum: 5,
            },
            runtimeMinutes: {
              type: ["integer", "null"],
              minimum: 0,
              maximum: 1440,
            },
            type: {
              type: ["string", "null"],
              maxLength: 32,
            },
          },
        },
        transmitter: {
          type: "object",
          additionalProperties: false,
          required: ["type", "name", "muted", "observedAtUtc"],
          properties: {
            type: {
              type: ["string", "null"],
              maxLength: 64,
            },
            name: {
              type: ["string", "null"],
              maxLength: 64,
            },
            muted: {
              type: ["boolean", "null"],
            },
            observedAtUtc: {
              type: ["string", "null"],
              format: "date-time",
            },
          },
        },
        check: {
          description:
            "Summary of this channel's guided mic check against its current subject; null when no check exists.",
          type: ["object", "null"],
          additionalProperties: false,
          required: [
            "passed",
            "failed",
            "waiting",
            "total",
            "stale",
            "updatedAtUtc",
          ],
          properties: {
            passed: {
              type: "integer",
              minimum: 0,
              maximum: 8,
            },
            failed: {
              type: "integer",
              minimum: 0,
              maximum: 8,
            },
            waiting: {
              type: "integer",
              minimum: 0,
              maximum: 8,
            },
            total: {
              const: 8,
            },
            stale: {
              type: "boolean",
            },
            updatedAtUtc: {
              type: "string",
              format: "date-time",
            },
          },
        },
      },
    },
    alert: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "kind",
        "dimension",
        "severity",
        "label",
        "detail",
        "channelId",
        "channelNumber",
        "channelName",
        "receiverId",
        "raisedAtUtc",
        "acknowledgedAtUtc",
        "acknowledgedBy",
        "clearedAtUtc",
        "overlayExpiresAtUtc",
      ],
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: 64,
        },
        kind: {
          enum: [
            "battery-low",
            "battery-critical",
            "rf-low",
            "rf-lost",
            "link-quality-low",
            "interference",
            "encryption-mismatch",
            "tx-muted",
            "no-audio",
            "clipping",
            "receiver-offline",
            "capture-error",
            "node-unreachable",
          ],
        },
        dimension: {
          enum: ["RF", "Audio", "Battery", "System"],
        },
        severity: {
          enum: ["critical", "caution"],
        },
        label: {
          type: "string",
          minLength: 1,
          maxLength: 40,
        },
        detail: {
          type: "string",
          minLength: 1,
          maxLength: 240,
        },
        channelId: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 64,
        },
        channelNumber: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: 999,
        },
        channelName: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 120,
        },
        receiverId: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 64,
        },
        raisedAtUtc: {
          type: "string",
          format: "date-time",
        },
        acknowledgedAtUtc: {
          type: ["string", "null"],
          format: "date-time",
        },
        acknowledgedBy: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 80,
        },
        clearedAtUtc: {
          type: ["string", "null"],
          format: "date-time",
        },
        overlayExpiresAtUtc: {
          type: ["string", "null"],
          format: "date-time",
        },
      },
    },
    faultReport: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "channelId",
        "channelNumber",
        "channelName",
        "performer",
        "faults",
        "note",
        "urgent",
        "incident",
        "incidentReason",
        "status",
        "requestedBy",
        "requestedAtUtc",
        "undoUntilUtc",
        "claimedBy",
        "claimedAtUtc",
        "resolvedBy",
        "resolvedAtUtc",
        "closedAtUtc",
      ],
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: 64,
        },
        channelId: {
          type: "string",
          minLength: 1,
          maxLength: 64,
        },
        channelNumber: {
          type: "integer",
          minimum: 1,
          maximum: 999,
        },
        channelName: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
        performer: {
          type: ["string", "null"],
          maxLength: 120,
        },
        faults: {
          type: "array",
          maxItems: 9,
          items: {
            $ref: "#/$defs/reportedFault",
          },
        },
        note: {
          type: ["string", "null"],
          maxLength: 200,
        },
        urgent: {
          type: "boolean",
        },
        incident: {
          type: "boolean",
        },
        incidentReason: {
          enum: ["urgent", "telemetry", null],
        },
        status: {
          enum: [
            "open",
            "claimed",
            "awaiting-confirmation",
            "closed",
            "cancelled",
          ],
        },
        requestedBy: {
          type: "string",
          minLength: 1,
          maxLength: 80,
        },
        requestedAtUtc: {
          type: "string",
          format: "date-time",
        },
        undoUntilUtc: {
          type: "string",
          format: "date-time",
        },
        claimedBy: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 80,
        },
        claimedAtUtc: {
          type: ["string", "null"],
          format: "date-time",
        },
        resolvedBy: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 80,
        },
        resolvedAtUtc: {
          type: ["string", "null"],
          format: "date-time",
        },
        closedAtUtc: {
          type: ["string", "null"],
          format: "date-time",
        },
      },
    },
    reportedFault: {
      enum: [
        "dropping-out",
        "crackling",
        "distorted",
        "too-quiet",
        "clothing-noise",
        "popping",
        "hum-buzz",
        "nothing-at-all",
        "other",
      ],
    },
  },
} as const;

const alertLogSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pulse.local/schema/v0/http/alert-log.schema.json",
  title: "Alert log",
  description:
    "Served at GET /api/v1/alerts: every active alert plus bounded history of cleared alerts, newest first. Each record keeps the channel identity captured when it was raised, so later showfile edits do not rewrite history.",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "generatedAtUtc", "active", "history"],
  properties: {
    schemaVersion: {
      const: "0",
    },
    generatedAtUtc: {
      type: "string",
      format: "date-time",
    },
    active: {
      type: "array",
      maxItems: 512,
      items: {
        $ref: "#/$defs/loggedAlert",
      },
    },
    history: {
      type: "array",
      maxItems: 1000,
      items: {
        $ref: "#/$defs/loggedAlert",
      },
    },
  },
  $defs: {
    loggedAlert: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "kind",
        "dimension",
        "severity",
        "label",
        "detail",
        "channelId",
        "channelNumber",
        "channelName",
        "receiverId",
        "raisedAtUtc",
        "acknowledgedAtUtc",
        "acknowledgedBy",
        "clearedAtUtc",
        "overlayExpiresAtUtc",
      ],
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: 64,
        },
        kind: {
          enum: [
            "battery-low",
            "battery-critical",
            "rf-low",
            "rf-lost",
            "link-quality-low",
            "interference",
            "encryption-mismatch",
            "tx-muted",
            "no-audio",
            "clipping",
            "receiver-offline",
            "capture-error",
            "node-unreachable",
          ],
        },
        dimension: {
          enum: ["RF", "Audio", "Battery", "System"],
        },
        severity: {
          enum: ["critical", "caution"],
        },
        label: {
          type: "string",
          minLength: 1,
          maxLength: 40,
        },
        detail: {
          type: "string",
          minLength: 1,
          maxLength: 240,
        },
        channelId: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 64,
        },
        channelNumber: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: 999,
        },
        channelName: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 120,
        },
        receiverId: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 64,
        },
        raisedAtUtc: {
          type: "string",
          format: "date-time",
        },
        acknowledgedAtUtc: {
          type: ["string", "null"],
          format: "date-time",
        },
        acknowledgedBy: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 80,
        },
        clearedAtUtc: {
          type: ["string", "null"],
          format: "date-time",
        },
        overlayExpiresAtUtc: {
          type: ["string", "null"],
          format: "date-time",
        },
      },
    },
  },
} as const;

const micChecksSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pulse.local/schema/v0/http/mic-checks.schema.json",
  title: "Guided mic checks",
  description:
    "Served at GET /api/v1/checks and returned by check mutations. Each check belongs to one show channel and records the subject it was made against (patch and performer); a check whose subject has since changed is stale and no longer counts. Every verdict records who gave it and when.",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "generatedAtUtc", "checks"],
  properties: {
    schemaVersion: {
      const: "0",
    },
    generatedAtUtc: {
      type: "string",
      format: "date-time",
    },
    checks: {
      type: "array",
      maxItems: 128,
      items: {
        $ref: "#/$defs/channelCheck",
      },
    },
  },
  $defs: {
    dimensionId: {
      enum: [
        "physical-identity",
        "rf-link",
        "captured-audio",
        "mute-control",
        "primary-spare",
        "battery-window",
        "placement-costume",
        "operator-signoff",
      ],
    },
    dimensionRecord: {
      type: "object",
      additionalProperties: false,
      required: ["id", "verdict", "by", "atUtc", "reason"],
      properties: {
        id: {
          $ref: "#/$defs/dimensionId",
        },
        verdict: {
          enum: ["pass", "fail", "waiting"],
        },
        by: {
          type: "string",
          minLength: 1,
          maxLength: 80,
        },
        atUtc: {
          type: "string",
          format: "date-time",
        },
        reason: {
          type: ["string", "null"],
          maxLength: 200,
        },
      },
    },
    checkSubject: {
      type: "object",
      additionalProperties: false,
      required: [
        "inputIndex",
        "receiverId",
        "receiverChannelIndex",
        "performer",
      ],
      properties: {
        inputIndex: {
          type: ["integer", "null"],
          minimum: 0,
          maximum: 255,
        },
        receiverId: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 64,
        },
        receiverChannelIndex: {
          type: ["integer", "null"],
          minimum: 0,
          maximum: 127,
        },
        performer: {
          type: ["string", "null"],
          maxLength: 120,
        },
      },
    },
    channelCheck: {
      type: "object",
      additionalProperties: false,
      required: [
        "channelId",
        "subject",
        "startedAtUtc",
        "updatedAtUtc",
        "dimensions",
        "stale",
      ],
      properties: {
        channelId: {
          type: "string",
          minLength: 1,
          maxLength: 64,
        },
        subject: {
          $ref: "#/$defs/checkSubject",
        },
        startedAtUtc: {
          type: "string",
          format: "date-time",
        },
        updatedAtUtc: {
          type: "string",
          format: "date-time",
        },
        dimensions: {
          type: "array",
          maxItems: 8,
          items: {
            $ref: "#/$defs/dimensionRecord",
          },
        },
        stale: {
          type: "boolean",
        },
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day
  );
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function resolveReference(
  root: Record<string, unknown>,
  reference: string,
): unknown {
  if (!reference.startsWith("#/")) return undefined;
  return reference
    .slice(2)
    .split("/")
    .reduce<unknown>(
      (current, segment) =>
        isRecord(current)
          ? current[segment.replaceAll("~1", "/").replaceAll("~0", "~")]
          : undefined,
      root,
    );
}

function matchesSchema(
  value: unknown,
  schemaValue: unknown,
  root: Record<string, unknown>,
  path: string,
): string | null {
  if (!isRecord(schemaValue)) return path;
  if (typeof schemaValue.$ref === "string") {
    return matchesSchema(
      value,
      resolveReference(root, schemaValue.$ref),
      root,
      path,
    );
  }
  if (Object.hasOwn(schemaValue, "const") && value !== schemaValue.const)
    return path;
  if (Array.isArray(schemaValue.enum) && !schemaValue.enum.includes(value))
    return path;

  const declaredTypes = Array.isArray(schemaValue.type)
    ? schemaValue.type
    : schemaValue.type === undefined
      ? []
      : [schemaValue.type];
  if (declaredTypes.length > 1) {
    const matchesAny = declaredTypes.some(
      (type) =>
        matchesSchema(value, { ...schemaValue, type }, root, path) === null,
    );
    return matchesAny ? null : path;
  }

  switch (declaredTypes[0]) {
    case "null":
      return value === null ? null : path;
    case "boolean":
      return typeof value === "boolean" ? null : path;
    case "string": {
      if (typeof value !== "string") return path;
      const length = codePointLength(value);
      if (
        typeof schemaValue.minLength === "number" &&
        length < schemaValue.minLength
      )
        return path;
      if (
        typeof schemaValue.maxLength === "number" &&
        length > schemaValue.maxLength
      )
        return path;
      if (schemaValue.format === "date-time" && !isDateTime(value)) return path;
      return null;
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) return path;
      if (declaredTypes[0] === "integer" && !Number.isInteger(value))
        return path;
      if (
        typeof schemaValue.minimum === "number" &&
        value < schemaValue.minimum
      )
        return path;
      if (
        typeof schemaValue.maximum === "number" &&
        value > schemaValue.maximum
      )
        return path;
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return path;
      if (
        typeof schemaValue.maxItems === "number" &&
        value.length > schemaValue.maxItems
      )
        return path;
      for (let index = 0; index < value.length; index += 1) {
        const error = matchesSchema(
          value[index],
          schemaValue.items,
          root,
          `${path}/${index}`,
        );
        if (error) return error;
      }
      return null;
    }
    case "object": {
      if (!isRecord(value)) return path;
      const properties = isRecord(schemaValue.properties)
        ? schemaValue.properties
        : {};
      const required = Array.isArray(schemaValue.required)
        ? schemaValue.required
        : [];
      for (const name of required) {
        if (typeof name !== "string" || !Object.hasOwn(value, name))
          return `${path}/${String(name)}`;
      }
      if (schemaValue.additionalProperties === false) {
        const unknown = Object.keys(value).find(
          (name) => !Object.hasOwn(properties, name),
        );
        if (unknown) return `${path}/${unknown}`;
      }
      for (const [name, propertySchema] of Object.entries(properties)) {
        if (!Object.hasOwn(value, name)) continue;
        const error = matchesSchema(
          value[name],
          propertySchema,
          root,
          `${path}/${name}`,
        );
        if (error) return error;
      }
      return null;
    }
    default:
      return null;
  }
}

function parseWithSchema<T>(
  value: unknown,
  schema: object,
  contract: string,
): T {
  const errorPath = matchesSchema(
    value,
    schema,
    schema as Record<string, unknown>,
    "",
  );
  if (errorPath !== null)
    throw new ProtocolContractError(contract, errorPath || "/");
  return value as T;
}

export function parseHealthResponse(value: unknown): HealthResponse {
  return parseWithSchema<HealthResponse>(
    value,
    healthResponseSchema,
    "HealthResponse",
  );
}

export function parseLiveSnapshot(value: unknown): LiveSnapshot {
  return parseWithSchema<LiveSnapshot>(
    value,
    liveSnapshotSchema,
    "LiveSnapshot",
  );
}

export function parseShowfile(value: unknown): Showfile {
  return parseWithSchema<Showfile>(value, showfileSchema, "Showfile");
}

export function parseShureTelemetry(value: unknown): ShureTelemetry {
  return parseWithSchema<ShureTelemetry>(
    value,
    shureTelemetrySchema,
    "ShureTelemetry",
  );
}

export function parseProductionList(value: unknown): ProductionList {
  return parseWithSchema<ProductionList>(
    value,
    productionListSchema,
    "ProductionList",
  );
}

export function parseChannelLevelHistory(value: unknown): ChannelLevelHistory {
  return parseWithSchema<ChannelLevelHistory>(
    value,
    channelLevelHistorySchema,
    "ChannelLevelHistory",
  );
}

export function parseNodeLevels(value: unknown): NodeLevels {
  return parseWithSchema<NodeLevels>(value, nodeLevelsSchema, "NodeLevels");
}

export function parseMeterFrame(value: unknown): MeterFrame {
  return parseWithSchema<MeterFrame>(value, meterFrameSchema, "MeterFrame");
}

export function parseHostOutput(value: unknown): HostOutput {
  return parseWithSchema<HostOutput>(value, hostOutputSchema, "HostOutput");
}

export function parseLiveState(value: unknown): LiveState {
  return parseWithSchema<LiveState>(value, liveStateSchema, "LiveState");
}

export function parseAlertLog(value: unknown): AlertLog {
  return parseWithSchema<AlertLog>(value, alertLogSchema, "AlertLog");
}

export function parseMicChecks(value: unknown): MicChecks {
  return parseWithSchema<MicChecks>(value, micChecksSchema, "MicChecks");
}

export type ProtocolFetch = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<Response>;

export interface HttpContractClient {
  getHealth(signal?: AbortSignal): Promise<HealthResponse>;
  getLiveSnapshot(signal?: AbortSignal): Promise<LiveSnapshot>;
}

export const HTTP_RESPONSE_LIMITS = {
  healthBytes: 4096,
  liveSnapshotBytes: 1048576,
} as const;

async function readBoundedJson(
  response: Response,
  contract: string,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    throw new ProtocolContractError(contract, "/response-bytes");
  }
  if (!response.body) throw new ProtocolContractError(contract, "/body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let chunks = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      chunks += 1;
      if (bytes > maxBytes || chunks > 4096) {
        await reader.cancel();
        throw new ProtocolContractError(contract, "/response-bytes");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ProtocolContractError) throw error;
    throw new ProtocolContractError(contract, "/json");
  }
}

export function createHttpContractClient(
  fetchResponse: ProtocolFetch = fetch,
): HttpContractClient {
  async function request<T>(
    path: string,
    contract: string,
    maxBytes: number,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetchResponse(path, { signal });
    if (!response.ok) throw new ProtocolHttpError(response.status, path);
    return parse(await readBoundedJson(response, contract, maxBytes));
  }

  return {
    getHealth: (signal) =>
      request(
        "/healthz",
        "HealthResponse",
        HTTP_RESPONSE_LIMITS.healthBytes,
        parseHealthResponse,
        signal,
      ),
    getLiveSnapshot: (signal) =>
      request(
        "/api/v1/live/snapshot",
        "LiveSnapshot",
        HTTP_RESPONSE_LIMITS.liveSnapshotBytes,
        parseLiveSnapshot,
        signal,
      ),
  };
}
