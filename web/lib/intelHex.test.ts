import { describe, expect, it } from "vitest";
import { parseIntelHex } from "./intelHex";

describe("parseIntelHex", () => {
  it("reads data records into one image starting at address 0", () => {
    const image = parseIntelHex(
      [":100000000C949E000C94C6000C94C6000C94C60080", ":0400100001020304E2", ":00000001FF"].join("\n"),
    );
    expect(image.length).toBe(20);
    expect([...image.slice(0, 4)]).toEqual([0x0c, 0x94, 0x9e, 0x00]);
    expect([...image.slice(16)]).toEqual([1, 2, 3, 4]);
  });

  it("fills gaps between records with 0xFF, like erased flash", () => {
    const image = parseIntelHex([":0100040055A6", ":00000001FF"].join("\r\n"));
    expect([...image]).toEqual([0xff, 0xff, 0xff, 0xff, 0x55]);
  });

  it("rejects a record with a bad checksum", () =>
    expect(() => parseIntelHex(":0400100001020304E3\n:00000001FF")).toThrow(/checksum/));

  it("rejects text that isn't a hex file", () =>
    expect(() => parseIntelHex("<!DOCTYPE html>")).toThrow());

  it("rejects a file with no end record", () =>
    expect(() => parseIntelHex(":0400100001020304E2")).toThrow(/end/));
});
