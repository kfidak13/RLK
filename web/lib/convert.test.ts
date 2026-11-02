import { describe, expect, it } from "vitest";
import {
  type Calibration,
  DEFAULT_CALIBRATION,
  isCalibrated,
  rawToCm,
  type Sample,
  sampleToPoint,
  samplesToPoints,
} from "./convert";

const cal: Calibration = { ...DEFAULT_CALIBRATION, tiltDegPerStep: 1.8 };

function expectPoint(s: Sample, c: Calibration, [x, y, z]: number[]) {
  const p = sampleToPoint(s, c);
  expect(p).not.toBeNull();
  expect(p!.x).toBeCloseTo(x, 2);
  expect(p!.y).toBeCloseTo(y, 2);
  expect(p!.z).toBeCloseTo(z, 2);
}

describe("rawToCm", () => {
  it("converts volts with the curve", () =>
    expect(rawToCm(204.6, cal)).toBeCloseTo(27.728, 2));

  it("drops low voltage, including zero", () => {
    for (const r of [0, 71]) expect(rawToCm(r, cal)).toBeNull();
  });

  it("applies the 80 cm limit", () => {
    expect(rawToCm(84, cal)).toBeNull();
    expect(rawToCm(85, cal)).toBeCloseTo(79.88, 1);
  });

  it("applies the 10 cm limit", () => {
    expect(rawToCm(478, cal)).toBeNull();
    expect(rawToCm(477, cal)).toBeCloseTo(10.0, 1);
  });
});

describe("sampleToPoint", () => {
  it("points straight ahead at zero angles", () =>
    expectPoint({ panSteps: 0, tiltSteps: 0, raw: 204.6 }, cal, [0, 0, 27.728]));

  it("pan 90 degrees is +x", () =>
    expectPoint({ panSteps: 50, tiltSteps: 0, raw: 204.6 }, cal, [27.728, 0, 0]));

  it("tilt 90 degrees is +y", () =>
    expectPoint({ panSteps: 0, tiltSteps: 50, raw: 204.6 }, cal, [0, 27.728, 0]));

  it("negative degrees mirrors the axis", () =>
    expectPoint(
      { panSteps: 50, tiltSteps: 0, raw: 204.6 },
      { ...cal, panDegPerStep: -1.8 },
      [-27.728, 0, 0],
    ));

  it("adds the sensor offset to r", () =>
    expectPoint(
      { panSteps: 0, tiltSteps: 0, raw: 204.6 },
      { ...cal, sensorOffsetCm: 2 },
      [0, 0, 29.728],
    ));
});

describe("calibration", () => {
  it("isCalibrated rejects null, 0 and NaN", () => {
    for (const t of [null, 0, NaN])
      expect(isCalibrated({ ...cal, tiltDegPerStep: t })).toBe(false);
  });

  it("isCalibrated accepts a negative value", () =>
    expect(isCalibrated({ ...cal, tiltDegPerStep: -0.5 })).toBe(true));

  it("uncalibrated samples produce no points", () =>
    expect(
      samplesToPoints([{ panSteps: 0, tiltSteps: 0, raw: 300 }], DEFAULT_CALIBRATION),
    ).toEqual([]));

  it("an all out-of-range scan is empty, not NaN", () =>
    expect(samplesToPoints([{ panSteps: 0, tiltSteps: 0, raw: 0 }], cal)).toEqual([]));
});
