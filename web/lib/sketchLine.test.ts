import { describe, expect, it } from "vitest";
import {
  parseLine,
  type Reading,
  scanSettingsProblem,
  scanSize,
  sweepMicrosteps,
  toCsv,
  toPoint,
} from "./sketchLine";

const ROW =
  "Row 3/46 | X: 12.4 deg | Y: 20 microsteps | ADC: 412 | Voltage: 2.013 V | Distance: 34.2 cm (approx)";

const reading = (patch: Partial<Reading>): Reading => ({
  row: 1,
  rows: 46,
  xDeg: 22.5,
  yMicrosteps: 225,
  adc: 300,
  volts: 1.466,
  cm: 30,
  ...patch,
});

describe("parseLine", () => {
  it("reads every field of a point line", () =>
    expect(parseLine(ROW)).toEqual({
      row: 3,
      rows: 46,
      xDeg: 12.4,
      yMicrosteps: 20,
      adc: 412,
      volts: 2.013,
      cm: 34.2,
    }));

  it("reads a test line with no position", () =>
    expect(
      parseLine("ADC: 300 | Voltage: 1.466 V | Distance: 18.1 cm (approx)"),
    ).toEqual({ row: null, rows: null, xDeg: null, yMicrosteps: null, adc: 300, volts: 1.466, cm: 18.1 }));

  it("reads out-of-range as a reading with no distance", () =>
    expect(
      parseLine(
        "Row 1/46 | X: 0.0 deg | Y: 0 microsteps | ADC: 40 | Voltage: 0.196 V | Distance: Outside nominal measuring range",
      )?.cm,
    ).toBeNull());

  it("reads an invalid signal as a reading with no distance", () =>
    expect(
      parseLine("ADC: 3 | Voltage: 0.015 V | Distance: Invalid signal - check wiring/power"),
    ).toMatchObject({ adc: 3, cm: null }));

  it("reads a negative position", () =>
    expect(parseLine(ROW.replace("X: 12.4", "X: -1.5"))?.xDeg).toBe(-1.5));

  it("ignores a junk byte stuck to the front", () =>
    expect(parseLine(`�${ROW}`)?.row).toBe(3));

  it.each([
    "Sharp IR scanner ready.",
    "Scan started.",
    "Scan complete: 46 rows.",
    "Final X microsteps: 400",
    "t = test distance without moving",
    "",
  ])("ignores status line %j", (line) => expect(parseLine(line)).toBeNull());
});

describe("toPoint", () => {
  it("the middle of the sweep and travel is straight ahead", () => {
    const p = toPoint(reading({}), 30, 45)!;
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(30);
  });

  it("the start of the sweep is half the sweep to one side", () => {
    const p = toPoint(reading({ xDeg: 0 }), 30, 45)!;
    expect(p.x).toBeCloseTo(-30 * Math.sin((22.5 * Math.PI) / 180));
  });

  it("centres a wider sweep", () => {
    const p = toPoint(reading({ xDeg: 45 }), 30, 90)!;
    expect(p.x).toBeCloseTo(0);
  });

  it("the top of the travel is half the span up", () => {
    const p = toPoint(reading({ yMicrosteps: 450 }), 30, 45)!;
    expect(p.y).toBeCloseTo(30 * Math.sin((15 * Math.PI) / 180));
  });

  it.each([
    ["no distance", reading({ cm: null }), 30],
    ["no position", reading({ xDeg: null, yMicrosteps: null }), 30],
    ["a blank tilt span", reading({}), NaN],
  ])("gives no point for %s", (_, r, span) => expect(toPoint(r, span, 45)).toBeNull());
});

describe("scan settings", () => {
  it("converts the sweep to the sketch's microsteps", () => {
    expect(sweepMicrosteps(45)).toBe(400);
    expect(sweepMicrosteps(90)).toBe(800);
  });

  it("sizes the default scan like the sketch", () =>
    expect(scanSize(45, 10)).toEqual({ rows: 46, pointsPerRow: 26, minutes: 10 }));

  it("sizes a coarser scan", () =>
    expect(scanSize(90, 45)).toMatchObject({ rows: 11, pointsPerRow: 51 }));

  it("accepts the defaults and the limits", () => {
    expect(scanSettingsProblem(45, 10)).toBeNull();
    expect(scanSettingsProblem(1.8, 450)).toBeNull();
    expect(scanSettingsProblem(90, 1)).toBeNull();
  });

  it.each([
    ["a blank sweep", NaN, 10],
    ["a sweep under one point", 1, 10],
    ["a sweep over 90 degrees", 91, 10],
    ["a blank row step", 45, NaN],
    ["a row step of 0", 45, 0],
    ["a fractional row step", 45, 2.5],
    ["a row step past the travel", 45, 451],
  ])("refuses %s", (_, sweep, row) =>
    expect(scanSettingsProblem(sweep, row)).toEqual(expect.any(String)));
});

describe("toCsv", () => {
  it("has a header and one row per reading, with blanks for missing values", () => {
    const lines = toCsv([reading({}), reading({ cm: null })], 30, 45).trim().split("\n");
    expect(lines[0]).toBe("row,x_deg,y_microsteps,adc,volts,cm,x,y,z");
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith("1,22.5,225,300,1.466,30,")).toBe(true);
    expect(lines[2]).toBe("1,22.5,225,300,1.466,,,,");
  });
});
