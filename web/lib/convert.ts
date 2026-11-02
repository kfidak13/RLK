export type Calibration = {
  panDegPerStep: number;
  tiltDegPerStep: number | null;
  sensorOffsetCm: number;
  curveA: number;
  curveB: number;
};

export const DEFAULT_CALIBRATION: Calibration = {
  panDegPerStep: 1.8,
  tiltDegPerStep: null,
  sensorOffsetCm: 0,
  curveA: 27.728,
  curveB: -1.2045,
};

export type Sample = { panSteps: number; tiltSteps: number; raw: number };
export type Point = { x: number; y: number; z: number; cm: number };

const MIN_VOLTS = 0.35;
const MIN_CM = 10;
const MAX_CM = 80;

const isUsableDeg = (d: number | null): d is number =>
  d !== null && Number.isFinite(d) && d !== 0;

export function isCalibrated(cal: Calibration): boolean {
  return isUsableDeg(cal.panDegPerStep) && isUsableDeg(cal.tiltDegPerStep);
}

export function rawToCm(raw: number, cal: Calibration): number | null {
  const volts = (raw * 5) / 1023;
  if (volts < MIN_VOLTS) return null;
  const cm = cal.curveA * Math.pow(volts, cal.curveB);
  if (!Number.isFinite(cm) || cm < MIN_CM || cm > MAX_CM) return null;
  return cm;
}

export function sampleToPoint(s: Sample, cal: Calibration): Point | null {
  if (!isCalibrated(cal)) return null;
  const cm = rawToCm(s.raw, cal);
  if (cm === null) return null;
  const pan = (s.panSteps * cal.panDegPerStep * Math.PI) / 180;
  const tilt = (s.tiltSteps * cal.tiltDegPerStep! * Math.PI) / 180;
  const r = cm + cal.sensorOffsetCm;
  if (!Number.isFinite(r)) return null;
  return {
    x: r * Math.cos(tilt) * Math.sin(pan),
    y: r * Math.sin(tilt),
    z: r * Math.cos(tilt) * Math.cos(pan),
    cm,
  };
}

export function samplesToPoints(samples: Sample[], cal: Calibration): Point[] {
  return samples.flatMap((s) => sampleToPoint(s, cal) ?? []);
}
