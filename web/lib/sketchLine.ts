// Reads the lines printed by firmware/scanner/scanner.ino.

export type Reading = {
  row: number | null;
  rows: number | null;
  xDeg: number | null;
  yMicrosteps: number | null;
  adc: number;
  volts: number;
  cm: number | null;
};

export type Point = { x: number; y: number; z: number; cm: number };

// Must match the sketch's X_DEG_PER_STEP, X_SAMPLE_STEPS, X_MAX_SWEEP_STEPS and Y_TRAVEL_STEPS.
const X_DEG_PER_MICROSTEP = 90 / 800;
const X_SAMPLE_MICROSTEPS = 16;
const X_MAX_SWEEP_MICROSTEPS = 800;
const Y_TRAVEL_MICROSTEPS = 450;
// Settle, five readings and a 16-microstep move, as timed in the sketch.
const SECONDS_PER_POINT = 0.51;

export const sweepMicrosteps = (sweepDeg: number) => Math.round(sweepDeg / X_DEG_PER_MICROSTEP);

export function scanSettingsProblem(sweepDeg: number, yRowMicrosteps: number): string | null {
  const sweep = sweepMicrosteps(sweepDeg);
  if (!Number.isFinite(sweep) || sweep < X_SAMPLE_MICROSTEPS || sweep > X_MAX_SWEEP_MICROSTEPS)
    return "X sweep per row must be between 1.8° and 90°.";
  if (!Number.isInteger(yRowMicrosteps) || yRowMicrosteps < 1 || yRowMicrosteps > Y_TRAVEL_MICROSTEPS)
    return `Y per row must be a whole number of microsteps from 1 to ${Y_TRAVEL_MICROSTEPS}.`;
  return null;
}

export function scanSize(sweepDeg: number, yRowMicrosteps: number) {
  const rows = Math.floor(Y_TRAVEL_MICROSTEPS / yRowMicrosteps) + 1;
  const pointsPerRow = Math.ceil(sweepMicrosteps(sweepDeg) / X_SAMPLE_MICROSTEPS) + 1;
  return {
    rows,
    pointsPerRow,
    minutes: Math.round((rows * pointsPerRow * SECONDS_PER_POINT) / 60),
  };
}

const POSITION = /Row (\d+)\/(\d+) \| X: (-?[\d.]+) deg \| Y: (-?\d+) microsteps/;
const DISTANCE = /ADC: (\d+) \| Voltage: ([\d.]+) V \| Distance: (?:([\d.]+) cm)?/;

export function parseLine(line: string): Reading | null {
  const distance = DISTANCE.exec(line);
  if (!distance) return null;
  const position = POSITION.exec(line);
  return {
    row: position ? Number(position[1]) : null,
    rows: position ? Number(position[2]) : null,
    xDeg: position ? Number(position[3]) : null,
    yMicrosteps: position ? Number(position[4]) : null,
    adc: Number(distance[1]),
    volts: Number(distance[2]),
    cm: distance[3] === undefined ? null : Number(distance[3]),
  };
}

export function toPoint(r: Reading, tiltSpanDeg: number, sweepDeg: number): Point | null {
  if (r.cm === null || r.xDeg === null || r.yMicrosteps === null) return null;
  if (!Number.isFinite(tiltSpanDeg)) return null;
  const pan = ((r.xDeg - sweepDeg / 2) * Math.PI) / 180;
  const tiltDeg = (r.yMicrosteps * tiltSpanDeg) / Y_TRAVEL_MICROSTEPS - tiltSpanDeg / 2;
  const tilt = (tiltDeg * Math.PI) / 180;
  return {
    x: r.cm * Math.cos(tilt) * Math.sin(pan),
    y: r.cm * Math.sin(tilt),
    z: r.cm * Math.cos(tilt) * Math.cos(pan),
    cm: r.cm,
  };
}

const cell = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const round = (v: number) => Math.round(v * 100) / 100;

export function toCsv(readings: Reading[], tiltSpanDeg: number, sweepDeg: number): string {
  const rows = readings.map((r) => {
    const p = toPoint(r, tiltSpanDeg, sweepDeg);
    return [
      r.row,
      r.xDeg,
      r.yMicrosteps,
      r.adc,
      r.volts,
      r.cm,
      p && round(p.x),
      p && round(p.y),
      p && round(p.z),
    ]
      .map(cell)
      .join(",");
  });
  return ["row,x_deg,y_microsteps,adc,volts,cm,x,y,z", ...rows].join("\n") + "\n";
}
