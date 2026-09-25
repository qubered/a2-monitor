import { describe, expect, it } from "vitest";
import { classifyShureTransmitter } from "../receivers/shure-models";

describe("classifyShureTransmitter", () => {
  it("classifies bodypack/beltpack model codes across every family", () => {
    for (const model of ["AD1", "ADX1", "ADX1M", "ULXD1", "QLXD1", "SLXD1"]) {
      expect(classifyShureTransmitter(model)).toBe("beltpack");
    }
  });

  it("classifies handheld model codes across every family", () => {
    for (const model of ["AD2", "ADX2", "ULXD2", "QLXD2", "SLXD2"]) {
      expect(classifyShureTransmitter(model)).toBe("handheld");
    }
  });

  it("is case- and separator-insensitive", () => {
    expect(classifyShureTransmitter("adx-1m")).toBe("beltpack");
  });

  it("returns null for unrecognized or absent model codes", () => {
    expect(classifyShureTransmitter("UNKNOWN")).toBeNull();
    expect(classifyShureTransmitter(null)).toBeNull();
    expect(classifyShureTransmitter("")).toBeNull();
  });
});
