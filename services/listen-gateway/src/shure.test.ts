import { describe, expect, it } from "vitest";
import {
  applyChannelProperty,
  AXIENT_COMMANDS,
  QLXD_COMMANDS,
  ShureFrameParser,
  SLXD_COMMANDS,
  ULXD_COMMANDS,
} from "./shure.js";

describe("ShureFrameParser", () => {
  it("accepts fragmented and coalesced read-only receiver reports", () => {
    const parser = new ShureFrameParser();
    expect(parser.push("noise< REP 1 BATT_")).toEqual([]);
    expect(
      parser.push("BARS 004 >< REP MODEL {ULXD4D} >< REP FW_VER 2.7.10 >"),
    ).toEqual([
      { channelIndex: 0, property: "BATT_BARS", value: "004" },
      { property: "MODEL", value: "ULXD4D" },
      { property: "FW_VER", value: "2.7.10" },
    ]);
  });

  it("ignores malformed and invalid-channel reports", () => {
    const parser = new ShureFrameParser();
    expect(
      parser.push("< SET 1 BATT_BARS 005 >< REP 0 BATT_BARS 005 >"),
    ).toEqual([]);
  });
});

type Channel = NonNullable<ReturnType<typeof applyChannelProperty>>;

function baseChannel(): Channel {
  return {
    index: 0,
    linkStatus: "unavailable",
    batteryBars: null,
    batteryChargePercent: null,
    batteryType: null,
    batteryCycleCount: null,
    batteryRunTimeMinutes: null,
    antennas: [
      { label: "A", active: null },
      { label: "B", active: null },
    ],
    rfLevelDbm: null,
    rfLevelRaw: null,
    linkQualityRaw: null,
    interference: "unavailable",
    audioLevelDbfs: null,
    audioLevelRaw: null,
    frequencyRaw: null,
    groupChannelRaw: null,
    transmitter: { type: null, name: null, muted: null },
    warnings: [],
    observedAtUtc: null,
    availability: "unavailable",
  };
}

describe("applyChannelProperty", () => {
  it("converts Axient Digital RSSI and audio peak to dBm/dBFS using the documented offsets", () => {
    const channel = baseChannel();
    const withRf = applyChannelProperty(
      channel,
      AXIENT_COMMANDS,
      "RSSI",
      "062",
    );
    expect(withRf).toMatchObject({ rfLevelRaw: 62, rfLevelDbm: -58 });

    const withAudio = applyChannelProperty(
      channel,
      AXIENT_COMMANDS,
      "AUDIO_LEVEL_PEAK",
      "034",
    );
    expect(withAudio).toMatchObject({ audioLevelRaw: 34, audioLevelDbfs: -86 });
  });

  it("parses Axient Digital antenna letter states onto A/B labels", () => {
    const updated = applyChannelProperty(
      baseChannel(),
      AXIENT_COMMANDS,
      "ANTENNA_STATUS",
      "BR",
    );
    expect(updated?.antennas).toEqual([
      { label: "A", active: true },
      { label: "B", active: false },
    ]);
  });

  it("parses ULX-D RF_ANTENNA pair states and RF_INT_DET", () => {
    const withAntenna = applyChannelProperty(
      baseChannel(),
      ULXD_COMMANDS,
      "RF_ANTENNA",
      "AX",
    );
    expect(withAntenna?.antennas).toEqual([
      { label: "A", active: true },
      { label: "B", active: false },
    ]);

    const withInterference = applyChannelProperty(
      baseChannel(),
      ULXD_COMMANDS,
      "RF_INT_DET",
      "CRITICAL",
    );
    expect(withInterference?.interference).toBe("detected");
  });

  it("leaves QLX-D RF level unavailable since no scalar GET is documented", () => {
    const updated = applyChannelProperty(
      baseChannel(),
      QLXD_COMMANDS,
      "AUDIO_LVL",
      "030",
    );
    expect(updated).toMatchObject({ audioLevelRaw: 30, audioLevelDbfs: null });
  });

  it("parses SLX-D transmitter battery and mute state", () => {
    const withBattery = applyChannelProperty(
      baseChannel(),
      SLXD_COMMANDS,
      "TX_BATT_BARS",
      "3",
    );
    expect(withBattery?.batteryBars).toBe(3);

    const withMute = applyChannelProperty(
      baseChannel(),
      SLXD_COMMANDS,
      "TX_MUTE_STATUS",
      "ON",
    );
    expect(withMute?.transmitter.muted).toBe(true);
  });

  it("ignores properties that do not belong to the receiver's family", () => {
    expect(
      applyChannelProperty(baseChannel(), QLXD_COMMANDS, "RSSI", "062"),
    ).toBeNull();
  });

  it("rejects out-of-range and non-numeric values instead of fabricating a reading", () => {
    const updated = applyChannelProperty(
      baseChannel(),
      AXIENT_COMMANDS,
      "RSSI",
      "not-a-number",
    );
    expect(updated).toMatchObject({ rfLevelRaw: null, rfLevelDbm: null });
  });
});
