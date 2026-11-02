import { describe, expect, it } from "vitest";
import { DEFAULT_CALIBRATION, type Sample } from "./convert";
import { parseScan, serializeScan } from "./scanFile";

const calibration = { ...DEFAULT_CALIBRATION, tiltDegPerStep: 0.5 };
const samples: Sample[] = [{ panSteps: -1, tiltSteps: 2, raw: 300 }];
const valid = { version: 1, createdAt: "2026-11-02T00:00:00.000Z", calibration, samples };
const withFile = (patch: object) => JSON.stringify({ ...valid, ...patch });

describe("scan files", () => {
  it("round-trips a scan", () => {
    const text = serializeScan(calibration, samples, new Date("2026-11-02T00:00:00Z"));
    expect(parseScan(text)).toEqual(valid);
  });

  it.each([
    ["not json", "not json"],
    ["an array", "[]"],
    ["an empty object", "{}"],
    ["a newer version", withFile({ version: 2 })],
    ["no calibration", withFile({ calibration: undefined })],
    ["no tilt calibration", withFile({ calibration: { ...calibration, tiltDegPerStep: null } })],
    ["no samples", withFile({ samples: undefined })],
    ["a string raw value", withFile({ samples: [{ panSteps: 0, tiltSteps: 0, raw: "300" }] })],
    ["a raw value past 1023", withFile({ samples: [{ panSteps: 0, tiltSteps: 0, raw: 2000 }] })],
    ["fractional steps", withFile({ samples: [{ panSteps: 0.5, tiltSteps: 0, raw: 300 }] })],
    ["a null sample", withFile({ samples: [null] })],
  ])("rejects %s with a message", (_, text) => {
    expect(() => parseScan(text)).toThrow(/scan file/i);
  });
});
