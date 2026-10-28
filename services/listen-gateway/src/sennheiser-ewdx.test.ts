import { describe, expect, it } from "vitest";
import {
  checkEwdxIdentity,
  emptyEwdxChannel,
  ewdxPortFor,
  normalizeEwdxChannel,
  type EwdxChannelReadings,
  type EwdxReading,
} from "./sennheiser-ewdx.js";

// Small original fixtures shaped after the EW-DX 3rd-party OpenAPI release 1.7
// (resource paths /api/ssc/version, /api/device/identity,
// /api/firmware/update/state and the per-channel /api/channel/*,
// /api/rf/channels/* and /api/transmitters/* resources). Values are synthetic.
const ok = (body: unknown): EwdxReading => ({ status: 200, body });
const NOW = "2026-10-28T10:00:00.000Z";

const IDENTITY = {
  version: ok({ protocol: "2.3", schema: "1.7" }),
  identity: ok({
    product: "EWDX2CHDS",
    hardwareRevision: "0000000-00",
    serial: "1000000001",
    vendor: "Sennheiser electronic SE & Co. KG",
  }),
  firmware: ok({ deviceVersion: "4.1.2", state: "Idle", progress: 0 }),
};

function readings(
  overrides: Partial<EwdxChannelReadings> = {},
): EwdxChannelReadings {
  return {
    channel: ok({ name: "LEAD", mute: false, gain: 21, outputLevel: 0 }),
    warnings: ok([]),
    rssi: ok({ value: -61.4 }),
    rsqi: ok({ value: 96 }),
    level: ok({ value: -32.6 }),
    rf: ok({ frequency: 550_125, presets: { type: "None" } }),
    transmitter: ok({ type: "EW_DX_SKM", name: "LEAD", mute: false }),
    battery: ok({ type: "Battery", lifetime: 315, gauge: 80 }),
    transmitterWarnings: ok([]),
    ...overrides,
  };
}

describe("EW-DX identity, protocol and firmware gating", () => {
  it("accepts an SSCv2 EWDX2CHDS on firmware 4.x and reports the observed product code", () => {
    expect(checkEwdxIdentity(IDENTITY)).toEqual({
      ok: true,
      product: "EWDX2CHDS",
      serial: "1000000001",
      firmware: "4.1.2",
      protocol: "2.3",
      schema: "1.7",
    });
  });

  it.each([
    [
      "the analogue EM 2 product code",
      { identity: ok({ ...IDENTITY.identity.body!, product: "EWDX2CHS" }) },
      /EWDX2CHS.*not.*EWDX2CHDS/,
    ],
    [
      "the four-channel EM 4 Dante product code",
      { identity: ok({ ...IDENTITY.identity.body!, product: "EWDX4CHDS" }) },
      /EWDX4CHDS/,
    ],
    [
      "a different vendor",
      { identity: ok({ ...IDENTITY.identity.body!, vendor: "Someone else" }) },
      /vendor/i,
    ],
    [
      "SSCv1-era firmware",
      { firmware: ok({ deviceVersion: "3.9.0" }) },
      /3\.9\.0.*SSCv1.*not enabled/,
    ],
    [
      "an unreviewed future firmware major",
      { firmware: ok({ deviceVersion: "5.0.0" }) },
      /5\.0\.0.*not been reviewed/,
    ],
    [
      "an unreadable firmware version",
      { firmware: ok({ deviceVersion: "beta" }) },
      /firmware version.*unknown/i,
    ],
    [
      "a non-SSCv2 protocol",
      { version: ok({ protocol: "1.0", schema: "1.7" }) },
      /SSCv2/,
    ],
    [
      "an incompatible API schema major",
      { version: ok({ protocol: "2.3", schema: "2.0" }) },
      /schema 2\.0/,
    ],
    [
      "a rejected password",
      { firmware: { status: 401, body: null } },
      /password was rejected/,
    ],
    [
      "a user without third-party rights",
      { firmware: { status: 403, body: null } },
      /not allowed/,
    ],
    ["a malformed identity body", { identity: ok("<html>") }, /identity/i],
  ])("refuses %s", (_label, override, detail) => {
    const result = checkEwdxIdentity({ ...IDENTITY, ...override });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(detail);
  });
});

describe("EW-DX channel normalization", () => {
  const empty = emptyEwdxChannel(1);

  it("maps documented units without inventing unavailable fields", () => {
    expect(normalizeEwdxChannel(empty, readings(), NOW)).toEqual({
      index: 1,
      linkStatus: "active",
      batteryBars: null,
      batteryChargePercent: 80,
      batteryType: "Battery",
      batteryCycleCount: null,
      batteryRunTimeMinutes: 315,
      antennas: [],
      rfLevelDbm: -61,
      rfLevelRaw: null,
      linkQualityRaw: null,
      linkQualityPercent: 96,
      interference: "unavailable",
      audioLevelDbfs: -33,
      audioLevelRaw: null,
      frequencyRaw: "550125",
      groupChannelRaw: null,
      transmitter: { type: "EW_DX_SKM", name: "LEAD", muted: false },
      warnings: [],
      observedAtUtc: NOW,
      availability: "observed",
    });
  });

  it("does not treat the receiver's own output mute as transmitter mute", () => {
    const channel = normalizeEwdxChannel(
      empty,
      readings({
        channel: ok({ name: "LEAD", mute: true }),
        transmitter: ok({ type: "EW_DX_SK", mute: false }),
      }),
      NOW,
    );
    expect(channel.transmitter.muted).toBe(false);
  });

  it("reports a transmitter mute and warns about it", () => {
    const channel = normalizeEwdxChannel(
      empty,
      readings({ transmitter: ok({ type: "EW_DX_SK", mute: true }) }),
      NOW,
    );
    expect(channel.transmitter.muted).toBe(true);
    expect(channel.warnings).toContain("Transmitter is muted.");
  });

  it("marks an unlinked transmitter (HTTP 422) as no-transmitter and clears its battery", () => {
    const linked = normalizeEwdxChannel(empty, readings(), NOW);
    const gone = normalizeEwdxChannel(
      linked,
      readings({
        transmitter: { status: 422, body: null },
        battery: { status: 422, body: null },
        transmitterWarnings: { status: 422, body: null },
        warnings: ok(["NoLink"]),
      }),
      NOW,
    );
    expect(gone).toMatchObject({
      linkStatus: "no-transmitter",
      batteryChargePercent: null,
      batteryRunTimeMinutes: null,
      batteryType: null,
      // The last confirmed transmitter type is retained, as on Shure.
      transmitter: { type: "EW_DX_SKM", muted: null },
      availability: "observed",
    });
  });

  it("follows a transmitter swap to a different type", () => {
    const first = normalizeEwdxChannel(empty, readings(), NOW);
    const swapped = normalizeEwdxChannel(
      first,
      readings({
        transmitter: ok({ type: "EW_DX_SK", mute: false }),
        battery: ok({ type: "PrimaryCell", lifetime: 120, gauge: 40 }),
      }),
      NOW,
    );
    expect(swapped).toMatchObject({
      transmitter: { type: "EW_DX_SK" },
      batteryType: "PrimaryCell",
      batteryChargePercent: 40,
      batteryRunTimeMinutes: 120,
    });
  });

  it.each([
    ["a nonfinite RSSI", { rssi: ok({ value: Number.NaN }) }, "rfLevelDbm"],
    ["an RSSI above 0 dBm", { rssi: ok({ value: 3 }) }, "rfLevelDbm"],
    [
      "an RSSI below the documented floor",
      { rssi: ok({ value: -140 }) },
      "rfLevelDbm",
    ],
    ["a string RSSI", { rssi: ok({ value: "-60" }) }, "rfLevelDbm"],
    ["an RSQI above 100 %", { rsqi: ok({ value: 140 }) }, "linkQualityPercent"],
    ["a negative RSQI", { rsqi: ok({ value: -1 }) }, "linkQualityPercent"],
    [
      "an infinite audio level",
      { level: ok({ value: Infinity }) },
      "audioLevelDbfs",
    ],
    ["a positive audio level", { level: ok({ value: 2 }) }, "audioLevelDbfs"],
    [
      "a fractional frequency",
      { rf: ok({ frequency: 550_000.5 }) },
      "frequencyRaw",
    ],
    ["a zero frequency", { rf: ok({ frequency: 0 }) }, "frequencyRaw"],
    [
      "a gauge above 100 %",
      { battery: ok({ type: "Battery", gauge: 250, lifetime: 30 }) },
      "batteryChargePercent",
    ],
    [
      "a negative lifetime",
      { battery: ok({ type: "Battery", gauge: 50, lifetime: -5 }) },
      "batteryRunTimeMinutes",
    ],
    [
      "a lifetime beyond a day",
      { battery: ok({ type: "Battery", gauge: 50, lifetime: 99_999 }) },
      "batteryRunTimeMinutes",
    ],
    [
      "a failed RSSI request",
      { rssi: { status: 500, body: null } },
      "rfLevelDbm",
    ],
    ["a timed-out RSSI request", { rssi: { error: "timeout" } }, "rfLevelDbm"],
  ] as const)(
    "keeps %s unavailable instead of zero",
    (_label, override, field) => {
      const channel = normalizeEwdxChannel(empty, readings(override), NOW);
      expect(channel[field]).toBeNull();
    },
  );

  it("treats a NoBattery report as no charge reading rather than an empty battery", () => {
    const channel = normalizeEwdxChannel(
      empty,
      readings({ battery: ok({ type: "NoBattery", gauge: 0, lifetime: 0 }) }),
      NOW,
    );
    expect(channel).toMatchObject({
      batteryType: "NoBattery",
      batteryChargePercent: null,
      batteryRunTimeMinutes: null,
    });
    expect(channel.warnings).not.toContain(
      "Transmitter battery critically low.",
    );
  });

  it("bounds oversized names and transmitter types", () => {
    const channel = normalizeEwdxChannel(
      empty,
      readings({
        channel: ok({ name: "X".repeat(5_000) }),
        transmitter: ok({ type: "T".repeat(5_000), mute: false }),
      }),
      NOW,
    );
    expect(channel.transmitter.name).toHaveLength(64);
    expect(channel.transmitter.type).toHaveLength(64);
  });

  it("maps documented warnings and ignores undocumented ones", () => {
    const channel = normalizeEwdxChannel(
      empty,
      readings({
        warnings: ok(["Aes256Error", "LowSignal", "RfPeak", "Mystery", 7]),
        transmitterWarnings: ok(["LowBattery", "AfPeak"]),
      }),
      NOW,
    );
    expect(channel.warnings).toEqual([
      "Encryption mismatch detected.",
      "Low RF signal reported by the receiver.",
      "RF peak reported by the receiver.",
      "Transmitter reports a low battery.",
      "Audio peak reported by the transmitter.",
    ]);
  });

  it("keeps the previous observation but marks it stale when every request failed", () => {
    const observed = normalizeEwdxChannel(empty, readings(), NOW);
    const failed: EwdxChannelReadings = {
      channel: { error: "timeout" },
      warnings: { error: "timeout" },
      rssi: { error: "timeout" },
      rsqi: { error: "timeout" },
      level: { error: "timeout" },
      rf: { error: "timeout" },
      transmitter: { error: "timeout" },
      battery: { error: "timeout" },
      transmitterWarnings: { error: "timeout" },
    };
    expect(
      normalizeEwdxChannel(observed, failed, "2026-10-28T10:00:05.000Z"),
    ).toEqual({ ...observed, availability: "stale" });
    expect(normalizeEwdxChannel(empty, failed, NOW)).toEqual(empty);
  });

  it("does not count well-formed but wrongly shaped bodies as an observation", () => {
    const shapeless = Object.fromEntries(
      Object.keys(readings()).map((key) => [key, ok("unexpected")]),
    ) as EwdxChannelReadings;
    expect(normalizeEwdxChannel(empty, shapeless, NOW)).toEqual(empty);
    const observed = normalizeEwdxChannel(empty, readings(), NOW);
    expect(normalizeEwdxChannel(observed, shapeless, NOW)).toEqual({
      ...observed,
      availability: "stale",
    });
  });

  it("does not count a transmitter body without its documented type as a link", () => {
    const channel = normalizeEwdxChannel(
      empty,
      readings({ transmitter: ok({}), battery: ok({ gauge: 50 }) }),
      NOW,
    );
    expect(channel.linkStatus).toBe("unavailable");
    expect(channel.batteryChargePercent).toBeNull();
  });

  it("does not claim a link when the transmitter request itself failed", () => {
    const channel = normalizeEwdxChannel(
      empty,
      readings({
        transmitter: { status: 500, body: null },
        battery: { status: 500, body: null },
      }),
      NOW,
    );
    expect(channel.linkStatus).toBe("unavailable");
    expect(channel.batteryChargePercent).toBeNull();
  });
});

describe("ewdxPortFor", () => {
  it("only lets a loopback simulator use a port other than 443", () => {
    expect(ewdxPortFor("127.0.0.1", 8443)).toBe(8443);
    expect(ewdxPortFor("::1", 8443)).toBe(8443);
    expect(ewdxPortFor("192.168.1.40", 8443)).toBe(443);
    expect(ewdxPortFor("10.0.0.5", undefined)).toBe(443);
    expect(ewdxPortFor("127.0.0.1", undefined)).toBe(443);
  });
});
