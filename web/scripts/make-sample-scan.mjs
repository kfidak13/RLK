// Prints a made-up scan to stdout: a 20 cm radius sphere 40 cm ahead, on the
// default grid. Lets the viewer be tried without hardware.
const A = 27.728;
const B = -1.2045;
const DEG_PER_STEP = 1.8;
const CENTRE_CM = 40;
const RADIUS_CM = 20;

const rad = (steps) => (steps * DEG_PER_STEP * Math.PI) / 180;

function rawFor(pan, tilt) {
  const ahead = Math.cos(rad(tilt)) * Math.cos(rad(pan));
  const b = CENTRE_CM * ahead;
  const disc = b * b - (CENTRE_CM * CENTRE_CM - RADIUS_CM * RADIUS_CM);
  if (disc < 0) return 0;
  const volts = ((b - Math.sqrt(disc)) / A) ** (1 / B);
  return Math.round((volts * 1023) / 5);
}

const samples = [];
for (let tilt = -10; tilt <= 10; tilt++) {
  const row = [];
  for (let pan = -15; pan <= 15; pan++) {
    row.push({ panSteps: pan, tiltSteps: tilt, raw: rawFor(pan, tilt) });
  }
  samples.push(...(tilt % 2 === 0 ? row : row.reverse()));
}

console.log(
  JSON.stringify({
    version: 1,
    createdAt: "2026-11-02T00:00:00.000Z",
    calibration: {
      panDegPerStep: DEG_PER_STEP,
      tiltDegPerStep: DEG_PER_STEP,
      sensorOffsetCm: 0,
      curveA: A,
      curveB: B,
    },
    samples,
  }),
);
