// Shure receiver model catalogue shared by Manager (model picker) and the
// listen-gateway Shure adapter (capability-gated command selection).
//
// Scope matches docs/integrations/shure-wireless.md: only receivers with an
// ordinary receiver-Ethernet control path (TCP 2202) are listed. Portable
// ADX5D/SLXD5/SLXD5+ and legacy AXT400/UR4 receivers are out of scope until a
// direct node path exists.

export type ShureReceiverFamily =
  "axient-digital" | "anx4" | "ulxd" | "qlxd" | "slxd" | "slxd-plus";

export type ShureReceiverModel =
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

export type ShureCapabilityProfile = {
  /** Per-antenna RF level and active-antenna diversity indicator. */
  antennaDiversity: boolean;
  /** Aggregate channel/link quality metric distinct from raw RF level. */
  linkQuality: boolean;
  /** Explicit RF interference detection/classification. */
  interference: boolean;
  /** Receiver audio metering (peak). */
  audioMeter: boolean;
  /** Transmitter battery type, cycle count, and runtime beyond bars/charge. */
  batteryHealth: boolean;
  /** Linked transmitter identity (type/name) and mute state. */
  transmitterDetail: boolean;
};

export type ShureModelInfo = {
  model: ShureReceiverModel;
  label: string;
  family: ShureReceiverFamily;
  defaultChannelCount: number;
  maxChannelCount: number;
  dynamicChannelCount: boolean;
  capabilities: ShureCapabilityProfile;
};

const axientCapabilities: ShureCapabilityProfile = {
  antennaDiversity: true,
  linkQuality: true,
  interference: true,
  audioMeter: true,
  batteryHealth: true,
  transmitterDetail: true,
};

const ulxdCapabilities: ShureCapabilityProfile = {
  antennaDiversity: true,
  linkQuality: false,
  interference: true,
  audioMeter: true,
  batteryHealth: true,
  transmitterDetail: true,
};

const qlxdCapabilities: ShureCapabilityProfile = {
  antennaDiversity: true,
  linkQuality: false,
  interference: false,
  audioMeter: true,
  batteryHealth: true,
  transmitterDetail: true,
};

const slxdCapabilities: ShureCapabilityProfile = {
  antennaDiversity: true,
  linkQuality: false,
  interference: false,
  audioMeter: true,
  batteryHealth: false,
  transmitterDetail: false,
};

const slxdPlusCapabilities: ShureCapabilityProfile = {
  antennaDiversity: true,
  linkQuality: false,
  interference: true,
  audioMeter: true,
  batteryHealth: false,
  transmitterDetail: true,
};

function model(
  id: ShureReceiverModel,
  label: string,
  family: ShureReceiverFamily,
  defaultChannelCount: number,
  capabilities: ShureCapabilityProfile,
  options: { dynamicChannelCount?: boolean; maxChannelCount?: number } = {},
): ShureModelInfo {
  return {
    model: id,
    label,
    family,
    defaultChannelCount,
    maxChannelCount: options.maxChannelCount ?? defaultChannelCount,
    dynamicChannelCount: options.dynamicChannelCount ?? false,
    capabilities,
  };
}

export const SHURE_MODEL_INFO: Record<ShureReceiverModel, ShureModelInfo> = {
  AD4D: model(
    "AD4D",
    "Axient Digital AD4D",
    "axient-digital",
    2,
    axientCapabilities,
  ),
  "AD4D-DC": model(
    "AD4D-DC",
    "Axient Digital AD4D-DC",
    "axient-digital",
    2,
    axientCapabilities,
  ),
  AD4Q: model(
    "AD4Q",
    "Axient Digital AD4Q",
    "axient-digital",
    4,
    axientCapabilities,
  ),
  "AD4Q-DC": model(
    "AD4Q-DC",
    "Axient Digital AD4Q-DC",
    "axient-digital",
    4,
    axientCapabilities,
  ),
  ANX4: model(
    "ANX4",
    "Axient Digital / ULX-D ANX4",
    "anx4",
    4,
    axientCapabilities,
    {
      dynamicChannelCount: true,
      maxChannelCount: 24,
    },
  ),
  ULXD4: model("ULXD4", "ULX-D ULXD4", "ulxd", 1, ulxdCapabilities),
  ULXD4D: model("ULXD4D", "ULX-D ULXD4D", "ulxd", 2, ulxdCapabilities),
  ULXD4Q: model("ULXD4Q", "ULX-D ULXD4Q", "ulxd", 4, ulxdCapabilities),
  "ULXD4-GV": model(
    "ULXD4-GV",
    "ULX-D Government ULXD4-GV",
    "ulxd",
    1,
    ulxdCapabilities,
  ),
  "ULXD4D-GV": model(
    "ULXD4D-GV",
    "ULX-D Government ULXD4D-GV",
    "ulxd",
    2,
    ulxdCapabilities,
  ),
  "ULXD4Q-GV": model(
    "ULXD4Q-GV",
    "ULX-D Government ULXD4Q-GV",
    "ulxd",
    4,
    ulxdCapabilities,
  ),
  QLXD4: model("QLXD4", "QLX-D QLXD4", "qlxd", 1, qlxdCapabilities),
  SLXD4: model("SLXD4", "SLX-D SLXD4", "slxd", 1, slxdCapabilities),
  SLXD4D: model("SLXD4D", "SLX-D SLXD4D", "slxd", 2, slxdCapabilities),
  "SLXD4+": model(
    "SLXD4+",
    "SLX-D+ SLXD4+",
    "slxd-plus",
    1,
    slxdPlusCapabilities,
  ),
  "SLXD4D+": model(
    "SLXD4D+",
    "SLX-D+ SLXD4D+",
    "slxd-plus",
    2,
    slxdPlusCapabilities,
  ),
  "SLXD4Q+": model(
    "SLXD4Q+",
    "SLX-D+ SLXD4Q+",
    "slxd-plus",
    4,
    slxdPlusCapabilities,
  ),
  "SLXD4QDAN+": model(
    "SLXD4QDAN+",
    "SLX-D+ SLXD4QDAN+ (Dante)",
    "slxd-plus",
    4,
    slxdPlusCapabilities,
  ),
};

export const SHURE_RECEIVER_MODELS: readonly ShureReceiverModel[] = Object.keys(
  SHURE_MODEL_INFO,
) as ShureReceiverModel[];

export function isShureReceiverModel(
  value: string,
): value is ShureReceiverModel {
  return Object.hasOwn(SHURE_MODEL_INFO, value);
}

/** Physical form factor of a Shure transmitter, as distinct from its receiver. */
export type ShureTransmitterFormFactor = "handheld" | "beltpack";

// Shure's transmitter model codes end in "1" for a bodypack/beltpack
// transmitter and "2" for a handheld across every family that reports one
// (AD/ADX, ULX-D, QLX-D, SLX-D), independent of any receiver-specific
// prefix or trailing capsule/module suffix (e.g. "ADX1M"). Built from
// Shure's published transmitter model lists; `compatible-read-only` and
// unverified until it passes a hardware acceptance test, same as the
// receiver command tables in listen-gateway.
const TRANSMITTER_MODEL_PATTERN = /^(?:ADX|AD|ULXD|QLXD|SLXD)([12])/;

/**
 * Classifies a raw TX_MODEL/TX_TYPE command-string value into a transmitter
 * form factor, or `null` when the value doesn't match a known pattern (an
 * unrecognized or third-party transmitter). This is an inference from the
 * vendor's model code, not a value the receiver reports directly.
 */
export function classifyShureTransmitter(
  rawModel: string | null,
): ShureTransmitterFormFactor | null {
  if (!rawModel) return null;
  const normalized = rawModel
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const match = TRANSMITTER_MODEL_PATTERN.exec(normalized);
  if (!match) return null;
  return match[1] === "1" ? "beltpack" : "handheld";
}
