// Sennheiser receiver model catalogue shared by Manager (inventory) and the
// listen-gateway EW-DX adapter (identity and firmware gating).
//
// Scope is deliberately one chassis: the two-channel EW-DX EM 2 Dante over
// authenticated SSCv2 (firmware 4.0.0 and later). The analogue EW-DX EM 2 and
// the four-channel EW-DX EM 4 Dante are different products and are not
// accepted. Sources: Sennheiser "Sound Control Protocol" page (SSCv2 for
// Evolution Wireless Digital firmware >= 4.0.0) and the EW-DX 3rd-party
// OpenAPI release 1.7. Unverified until it passes a hardware acceptance test.

export type SennheiserReceiverModel = "EW-DX EM 2 Dante";

export type SennheiserModelInfo = {
  model: SennheiserReceiverModel;
  label: string;
  channelCount: number;
  /**
   * The `product` value `/api/device/identity` must report. The OpenAPI lists
   * EWDX2CHS, EWDX2CHDS and EWDX4CHDS without naming each one; EWDX2CHDS for
   * the EM 2 Dante is inferred from the Dante "D" that the only four-channel
   * (always Dante) code also carries, and is a hardware acceptance gate.
   */
  identityProduct: string;
  /** Oldest firmware that speaks SSCv2; older firmware is SSCv1 only. */
  minimumFirmware: string;
};

export const SENNHEISER_MODEL_INFO: Record<
  SennheiserReceiverModel,
  SennheiserModelInfo
> = {
  "EW-DX EM 2 Dante": {
    model: "EW-DX EM 2 Dante",
    label: "Sennheiser EW-DX EM 2 Dante",
    channelCount: 2,
    identityProduct: "EWDX2CHDS",
    minimumFirmware: "4.0.0",
  },
};

export const SENNHEISER_RECEIVER_MODELS: readonly SennheiserReceiverModel[] =
  Object.keys(SENNHEISER_MODEL_INFO) as SennheiserReceiverModel[];

export function isSennheiserReceiverModel(
  value: string,
): value is SennheiserReceiverModel {
  return Object.hasOwn(SENNHEISER_MODEL_INFO, value);
}

/** A receiver TLS certificate pin: exactly 64 lower-case hex digits (SHA-256). */
export function isTlsCertificatePin(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

// Transmitter `type` values from the EW-DX OpenAPI. SKM is the handheld and
// SK the bodypack; table stands and plug-on (SKP) transmitters have no Live
// form factor, so they stay unclassified rather than guessed.
const HANDHELD_TYPES = new Set(["EW_DX_SKM", "EW_DX_SKM_S", "EW_D_SKM_S"]);
const BODYPACK_TYPES = new Set(["EW_DX_SK", "EW_DX_SK_3_PIN", "EW_D_SK"]);

/** Classifies a reported EW-DX transmitter type, or `null` when it has no documented form factor. */
export function classifySennheiserTransmitter(
  type: string | null,
): "handheld" | "beltpack" | null {
  if (!type) return null;
  if (HANDHELD_TYPES.has(type)) return "handheld";
  if (BODYPACK_TYPES.has(type)) return "beltpack";
  return null;
}
