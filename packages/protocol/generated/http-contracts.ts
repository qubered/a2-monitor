// Generated file. Do not edit by hand.
// Sources:
//   - schema/v0/http/health-response.schema.json
//   - schema/v0/http/live-snapshot-response.schema.json
//   - schema/v0/http/showfile.schema.json
//   - schema/v0/http/shure-telemetry.schema.json
// Regenerate: npm run generate --workspace @rvlt/pulse-protocol
// Schema-SHA256: 9caa1991c624e9c686cde4f84b80736d8ee34a100bdc2bddd0ce4b0e1bb520bd
// Generator-SHA256: 7332ccaa39a3356f13cd579a0ec27fa08c2d30c34329709ecb964ba326edb8a9
// Body-SHA256: 3a37c556453004a8a9ba8a351bcdb78e1abfe4dc6352c6a68234724d9eeb3ef8

export type HealthResponse = {
  status: "ok";
  service: "a2-backend";
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
    inputIndex: number | null;
    name: string;
    shureChannelIndex?: number | null;
    shureReceiverId?: string | null;
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
  $id: "https://a2-monitor.local/schema/v0/http/health-response.schema.json",
  title: "Backend health response",
  type: "object",
  additionalProperties: false,
  required: ["status", "service", "version"],
  properties: {
    status: {
      const: "ok",
    },
    service: {
      const: "a2-backend",
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
  $id: "https://a2-monitor.local/schema/v0/http/live-snapshot-response.schema.json",
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
  $id: "https://a2-monitor.local/schema/v0/http/showfile.schema.json",
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
        },
      },
    },
  },
} as const;

const shureTelemetrySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://a2-monitor.local/schema/v0/http/shure-telemetry.schema.json",
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
