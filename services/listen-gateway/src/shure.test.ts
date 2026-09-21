import { describe, expect, it } from "vitest";
import { ShureFrameParser } from "./shure.js";

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
