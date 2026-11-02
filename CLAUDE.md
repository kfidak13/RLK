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
- No microstepping jumpers installed -> full-step, 200 steps/rev
- No endstops / limit switches. The tilt axis has LIMITED mechanical travel (screw linkage):
  never run it far without a known home position. Keep tilt moves small until limits are measured.

## Pin map (fixed by the CNC shield)
| Function        | Arduino pin |
|-----------------|-------------|
| Drivers enable  | D8 (LOW = enabled) |
| X step / dir    | D2 / D5     |
| Y step / dir    | D3 / D6     |
| IR sensor out   | A3 (shield header "CoolEn") |
| Sensor power    | shield 5V/GND header |

Which motor (X or Y) is pan vs tilt has not been confirmed yet. Check with a small move first.

## Sensor conversion (approximate)
volts = raw * 5.0 / 1023.0
cm = 27.728 * pow(volts, -1.2045)   // valid ~10-80 cm; volts < 0.35 = out of range
Average around 10 readings per sample; the sensor needs ~40 ms between fresh readings.

## Status
- Wiring done, motors and sensor confirmed working with scanner_test/scanner_test.ino
  (serial command test: `x <steps>`, `y <steps>`, `r`, `s`, `o`, `f` at 9600 baud, Newline ending).
- Scanning software built: `firmware/scanner/` (Uno) and `web/` (Next.js page that drives the
  sweep and shows the 3D point cloud). Design: `docs/superpowers/specs/2026-11-02-3d-scan-viewer-design.md`.
  So far it has only been compiled and tested against a simulated Uno, never on the hardware.
- Next: work through `docs/hardware-checklist.md`.

## Commands
- `npm --prefix web run dev`: run the page at localhost:3000 (Chrome or Edge, for Web Serial)
- `npm --prefix web test`: run the tests
- `arduino-cli compile --fqbn arduino:avr:uno firmware/scanner`: compile the firmware
- `clang++ -std=c++17 -o /tmp/scanner_host_test firmware/test/host_test.cpp && /tmp/scanner_host_test`:
  test the firmware's command handling and tilt limits on the computer
- `node web/scripts/make-sample-scan.mjs > docs/sample-scan.json`: regenerate the sample scan,
  which can be loaded in the page with no hardware

## Notes for development
- Don't unplug/plug motors while 12V is on (kills A4988s).
- Use arduino-cli to compile/upload if available: board FQBN `arduino:avr:uno`.
- The user builds in Next.js / TypeScript / Tailwind, so a browser front end
  (e.g. Web Serial API) is a natural fit for the computer side.
