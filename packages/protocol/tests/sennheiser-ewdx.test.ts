import { describe, expect, it } from "vitest";
import {
  parseShowfile,
  parseShureTelemetry,
  ProtocolContractError,
} from "../generated/http-contracts";
import {
  classifySennheiserTransmitter,
  isSennheiserReceiverModel,
  isTlsCertificatePin,
  SENNHEISER_MODEL_INFO,
  SENNHEISER_RECEIVER_MODELS,
} from "../receivers/sennheiser-models";

const PIN = "a".repeat(64);

function showfileWith(receiver: Record<string, unknown>): unknown {
  return {
    schemaVersion: "0",
    revision: 1,
    updatedAtUtc: null,
    show: { name: "Show" },
    device: null,
    shureReceivers: [],
    sennheiserReceivers: [receiver],
    channels: [
      {
        inputIndex: null,
        name: "Lead",
        shureReceiverId: "ewdx-a",
        shureChannelIndex: 1,
      },
    ],
  };
}

const EM2_DANTE = {
  id: "ewdx-a",
  name: "EW-DX rack",
  host: "192.168.10.40",
  model: "EW-DX EM 2 Dante",
  channelCount: 2,
  tlsCertificateSha256: PIN,
};

describe("EW-DX EM 2 Dante model catalogue", () => {
  it("lists exactly the two-channel EM 2 Dante", () => {
    expect(SENNHEISER_RECEIVER_MODELS).toEqual(["EW-DX EM 2 Dante"]);
    expect(SENNHEISER_MODEL_INFO["EW-DX EM 2 Dante"]).toMatchObject({
      channelCount: 2,
      identityProduct: "EWDX2CHDS",
      minimumFirmware: "4.0.0",
    });
  });

  it("does not accept the analogue EM 2 or the four-channel EM 4 Dante", () => {
    expect(isSennheiserReceiverModel("EW-DX EM 2 Dante")).toBe(true);
    expect(isSennheiserReceiverModel("EW-DX EM 2")).toBe(false);
    expect(isSennheiserReceiverModel("EW-DX EM 4 Dante")).toBe(false);
  });

  it("accepts only a lower-case hex SHA-256 certificate pin", () => {
    expect(isTlsCertificatePin(PIN)).toBe(true);
    expect(isTlsCertificatePin("0123456789abcdef".repeat(4))).toBe(true);
    expect(isTlsCertificatePin("A".repeat(64))).toBe(false);
    expect(isTlsCertificatePin("g".repeat(64))).toBe(false);
    expect(isTlsCertificatePin("a".repeat(63))).toBe(false);
    expect(isTlsCertificatePin(`${"a".repeat(64)}\n`)).toBe(false);
  });

  it("only infers a form factor from documented handheld and bodypack types", () => {
    expect(classifySennheiserTransmitter("EW_DX_SKM")).toBe("handheld");
    expect(classifySennheiserTransmitter("EW_DX_SKM_S")).toBe("handheld");
    expect(classifySennheiserTransmitter("EW_DX_SK")).toBe("beltpack");
    expect(classifySennheiserTransmitter("EW_DX_SK_3_PIN")).toBe("beltpack");
    expect(classifySennheiserTransmitter("EW_DX_TS_5_PIN")).toBeNull();
    expect(classifySennheiserTransmitter("EW_D_SKP")).toBeNull();
    expect(classifySennheiserTransmitter(null)).toBeNull();
  });
});

describe("showfile EW-DX inventory", () => {
  it("accepts an EM 2 Dante with an explicit IP and certificate pin", () => {
    const value = showfileWith(EM2_DANTE);
    expect(parseShowfile(value)).toEqual(value);
  });

  it("accepts an empty pin, meaning the certificate is trusted unverified", () => {
    const value = showfileWith({ ...EM2_DANTE, tlsCertificateSha256: "" });
    expect(parseShowfile(value)).toEqual(value);
  });

  it("still accepts a showfile written before EW-DX support", () => {
    const value = showfileWith(EM2_DANTE) as Record<string, unknown>;
    delete value.sennheiserReceivers;
    value.channels = [];
    expect(parseShowfile(value)).toEqual(value);
  });

  it.each([
    ["four channels", { channelCount: 4 }],
    ["the EM 4 Dante", { model: "EW-DX EM 4 Dante" }],
    ["the analogue EM 2", { model: "EW-DX EM 2" }],
    ["a missing pin", { tlsCertificateSha256: undefined }],
    ["a stored password", { password: "secret" }],
    ["a stored username", { username: "api" }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      parseShowfile(showfileWith({ ...EM2_DANTE, ...override })),
    ).toThrow(ProtocolContractError);
  });
});

describe("fleet telemetry for EW-DX", () => {
  function telemetry(channel: Record<string, unknown>): unknown {
    return {
      schemaVersion: "0",
      status: "ready",
      detail: "All configured receivers are reporting.",
      receivers: [
        {
          id: "ewdx-a",
          vendor: "sennheiser",
          name: "EW-DX rack",
          host: "192.168.10.40",
          model: "EW-DX EM 2 Dante",
          firmware: "4.1.0",
          compatibility: "compatible-read-only",
          status: "ready",
          detail: "Read-only SSCv2 telemetry is current.",
          capabilities: {
            antennaDiversity: false,
            linkQuality: true,
            interference: false,
            audioMeter: true,
            batteryHealth: true,
            transmitterDetail: true,
          },
          channels: [
            {
              index: 0,
              linkStatus: "active",
              batteryBars: null,
              batteryChargePercent: 80,
              batteryType: "Battery",
              batteryCycleCount: null,
              batteryRunTimeMinutes: 300,
              antennas: [],
              rfLevelDbm: -60,
              rfLevelRaw: null,
              linkQualityRaw: null,
              linkQualityPercent: 95,
              interference: "unavailable",
              audioLevelDbfs: -30,
              audioLevelRaw: null,
              frequencyRaw: "550000",
              groupChannelRaw: null,
              transmitter: { type: "EW_DX_SKM", name: "LEAD", muted: false },
              warnings: [],
              observedAtUtc: "2026-10-28T10:00:00.000Z",
              availability: "observed",
              ...channel,
            },
          ],
        },
      ],
    };
  }

  it("accepts a percent link quality and a vendor marker", () => {
    const value = telemetry({});
    expect(parseShureTelemetry(value)).toEqual(value);
  });

  it("rejects a link quality above 100 %", () => {
    expect(() =>
      parseShureTelemetry(telemetry({ linkQualityPercent: 101 })),
    ).toThrow(ProtocolContractError);
  });
});
