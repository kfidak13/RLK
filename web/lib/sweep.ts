export type Grid = {
  panMin: number;
  panMax: number;
  panStep: number;
  tiltMin: number;
  tiltMax: number;
  tiltStep: number;
};

export const DEFAULT_GRID: Grid = {
  panMin: -15,
  panMax: 15,
  panStep: 1,
  tiltMin: -10,
  tiltMax: 10,
  tiltStep: 1,
};

// Steps relative to the scan start.
export type Pos = { pan: number; tilt: number };
export type TiltLimits = { min: number; max: number };

const STEPS_PER_REV = 200;
const MAX_POINTS = 20000;
const READ_SECONDS = 0.5;
const STEPS_PER_SECOND = 100;

function axisValues(min: number, max: number, step: number): number[] {
  const values: number[] = [];
  for (let v = min; v <= max; v += step) values.push(v);
  return values;
}

export function limitsProblem(limits: TiltLimits): string | null {
  if (
    !Number.isInteger(limits.min) ||
    !Number.isInteger(limits.max) ||
    limits.min > 0 ||
    limits.max < 0
  )
    return "Tilt limits must be whole numbers: a minimum of 0 or below, and a maximum of 0 or above.";
  return null;
}

export function checkGrid(
  grid: Grid,
  startTilt: number,
  limits: TiltLimits,
): string | null {
  const { panMin, panMax, panStep, tiltMin, tiltMax, tiltStep } = grid;
  if (![panMin, panMax, panStep, tiltMin, tiltMax, tiltStep].every(Number.isInteger))
    return "Scan ranges and step sizes must be whole numbers.";
  const badLimits = limitsProblem(limits);
  if (badLimits) return badLimits;
  if (panStep <= 0 || tiltStep <= 0) return "Step sizes must be at least 1.";
  if (panMin > panMax || tiltMin > tiltMax)
    return "Each range's minimum must not be above its maximum.";
  if (panMax - panMin > STEPS_PER_REV)
    return `Pan range can't exceed ${STEPS_PER_REV} steps (one full turn).`;
  const points =
    (Math.floor((panMax - panMin) / panStep) + 1) *
    (Math.floor((tiltMax - tiltMin) / tiltStep) + 1);
  if (points > MAX_POINTS)
    return `That is ${points} points; the most a scan can have is ${MAX_POINTS}.`;
  if (startTilt + tiltMax > limits.max)
    return `Tilt would reach ${startTilt + tiltMax}, past the upper limit of ${limits.max}.`;
  if (startTilt + tiltMin < limits.min)
    return `Tilt would reach ${startTilt + tiltMin}, past the lower limit of ${limits.min}.`;
  return null;
}

// ponytail: the first row is approached from above, so screw slack can shift it; add an approach move if the wall test shows it.
export function sweepPositions(grid: Grid): Pos[] {
  const pans = axisValues(grid.panMin, grid.panMax, grid.panStep);
  const tilts = axisValues(grid.tiltMin, grid.tiltMax, grid.tiltStep);
  return tilts.flatMap((tilt, row) =>
    (row % 2 === 0 ? pans : pans.toReversed()).map((pan) => ({ pan, tilt })),
  );
}

export function estimateSeconds(grid: Grid): number {
  const positions = sweepPositions(grid);
  let travel = 0;
  for (let i = 1; i < positions.length; i++) {
    travel += Math.max(
      Math.abs(positions[i].pan - positions[i - 1].pan),
      Math.abs(positions[i].tilt - positions[i - 1].tilt),
    );
  }
  return positions.length * READ_SECONDS + travel / STEPS_PER_SECOND;
}
