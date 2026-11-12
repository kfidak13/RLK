# IR Pan-Tilt Scanner

A 2-axis scanner: one stepper pans the base, the other tilts a Sharp IR distance
sensor through a screw linkage. The goal is software that sweeps the sensor across
pan/tilt angles, collects distance readings, and turns them into a scan
(e.g. a point cloud or depth map shown on the computer).

## Hardware
- Arduino Uno with a CNC Shield V3 (Protoneer clone) on top
- 2x A4988 stepper drivers, in the shield's X and Y slots
- 2x NEMA 17 steppers (4-wire), plugged into the X and Y motor headers
- Sharp GP2Y0A21YK0F IR distance sensor (analog output, about 10-80 cm range, non-linear, noisy)
- 12V supply into the shield's blue screw terminal (motor power only); USB powers the Uno + sensor
- 1/16 microstepping: 3200 microsteps/rev
- No endstops / limit switches. The tilt axis has LIMITED mechanical travel (screw linkage):
  the measured Y travel is 450 microsteps, starting from the lower endpoint.

## Pin map (fixed by the CNC shield)
| Function        | Arduino pin |
|-----------------|-------------|
| Drivers enable  | D8 (LOW = enabled) |
| X step / dir    | D2 / D5     |
| Y step / dir    | D3 / D6     |
| IR sensor out   | A3 (shield header "CoolEn") |
| Sensor power    | shield 5V/GND header |

X is pan (a 45° sweep) and Y is tilt, as set in the owner's sketch.

## Firmware
`firmware/scanner/scanner.ino` is the owner's own sketch; keep it as written unless asked.
It runs the whole scan itself (46 rows × 26 points) and prints one line per point at 115200:
`Row 3/46 | X: 12.4 deg | Y: 20 microsteps | ADC: 412 | Voltage: 2.013 V | Distance: 34.2 cm (approx)`.
Commands: `t` test reading, `s` start, `q` stop, `x <microsteps>` X sweep per row (16-800,
default 400 = 45°), `y <microsteps>` Y per row (1-450, default 10). It scans once per reset.
X angles use 800 microsteps = 90°.
Its distance formula is `27.86 * pow(volts, -1.15)`, valid about 10-80 cm.

## Web page
`web/` reads those lines (`web/lib/sketchLine.ts`) and draws them in 3D. Before each scan it
sends the page's X sweep and Y per row settings. Pan = X − sweep / 2;
tilt = Y × span / 450 − span / 2, where span (degrees of tilt across the full Y travel) is a
setting on the page. If the sketch's limits or travel change, update the constants in sketchLine.ts.
Design: `docs/superpowers/specs/2026-11-12-simple-scan-page-design.md`.

## Status
- Motors and sensor work with the owner's sketch. The page hasn't been run against the real
  scanner yet, and the tilt span (default 30°) hasn't been measured.

## Commands
- Live page: https://kfidak13.github.io/RLK/ (published by `.github/workflows/pages.yml` on every push to main)
- `npm --prefix web run dev`: run the page at localhost:3000 (Chrome or Edge, for Web Serial)
- `npm --prefix web test`: run the tests
- `arduino-cli compile --upload -p <port> --fqbn arduino:avr:uno firmware/scanner`: flash the sketch

## Notes for development
- Don't unplug/plug motors while 12V is on (kills A4988s).
- Use arduino-cli to compile/upload if available: board FQBN `arduino:avr:uno`.
- The user builds in Next.js / TypeScript / Tailwind, so a browser front end
  (e.g. Web Serial API) is a natural fit for the computer side.
