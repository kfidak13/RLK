import type { Calibration, Sample } from "./convert";

export type ScanFile = {
  version: 1;
  createdAt: string;
  calibration: Calibration;
  samples: Sample[];
};

export function serializeScan(
  calibration: Calibration,
  samples: Sample[],
  now: Date,
): string {
  const file: ScanFile = {
    version: 1,
    createdAt: now.toISOString(),
    calibration,
    samples,
  };
  return JSON.stringify(file);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isCalibration = (v: unknown): v is Calibration =>
  isObject(v) &&
  ["panDegPerStep", "tiltDegPerStep", "sensorOffsetCm", "curveA", "curveB"].every((k) =>
    Number.isFinite(v[k]),
  );

// A blank field would save as null, and parseScan would then refuse the file.
export const isSaveable = (calibration: Calibration): boolean =>
  isCalibration(calibration);

const isSample = (v: unknown): v is Sample =>
  isObject(v) &&
  Number.isInteger(v.panSteps) &&
  Number.isInteger(v.tiltSteps) &&
  Number.isInteger(v.raw) &&
  (v.raw as number) >= 0 &&
  (v.raw as number) <= 1023;

export function parseScan(text: string): ScanFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This scan file isn't valid JSON.");
  }
  if (!isObject(data)) throw new Error("This isn't a scan file.");
  if (data.version !== 1)
    throw new Error("This scan file is from an unsupported version.");
  if (typeof data.createdAt !== "string" || !isCalibration(data.calibration))
    throw new Error("This scan file has no usable calibration.");
  if (!Array.isArray(data.samples) || !data.samples.every(isSample))
    throw new Error("This scan file has damaged samples.");
  return data as ScanFile;
}
