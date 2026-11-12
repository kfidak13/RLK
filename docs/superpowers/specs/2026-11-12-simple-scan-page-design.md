# Simple Scan Page Design

Date: 2026-11-12. Replaces `2026-11-02-3d-scan-viewer-design.md`.

## Why

The owner wrote a new Arduino sketch that runs the whole scan itself (1/16 microstepping,
a measured Y travel, its own distance formula) and prints one readable line per point.
The first page drove the scan from the browser and had too many controls. The page should
now just run the owner's sketch and show the result.

## Goals

- Connect, Test reading, Start, Stop, Save CSV, and a live rotatable 3D view.
- One setting: how many degrees the sensor tilts across the full Y travel.

## Non-goals

- Jogging, tilt limits, calibration boxes, loading saved scans.
- Changing the owner's sketch.

## Approaches

- **Page reads the sketch's text lines (chosen):** keeps the owner's sketch exactly as written.
- Change the sketch to print machine-friendly lines: simpler to parse, but rewrites code the owner just tested.
- Keep the old command protocol: rejected, because the owner moved the scan into the sketch.

## Design

- The sketch is the firmware: `firmware/scanner/scanner.ino`, unchanged. Commands are single
  characters: `t` test, `s` start, `q` stop. It scans once per reset.
- A point line looks like
  `Row 3/46 | X: 12.4 deg | Y: 20 microsteps | ADC: 412 | Voltage: 2.013 V | Distance: 34.2 cm (approx)`.
  A distance of "Outside nominal measuring range" or "Invalid signal - check wiring/power"
  counts as a reading with no point. `t` prints the same line without the Row/X/Y part.
- The page uses the sketch's distance. Pan = X − 22.5° (the sketch sweeps 45°, so this centres it).
  Tilt = Y × span / 450 − span / 2, where 450 is the sketch's Y travel and span is the setting
  (default 30°, a placeholder until measured, remembered in the browser).
- Connecting resets the Uno, which allows a new scan. "New scan" reopens the same port.
- Stop sends `q`; the page then says to reposition both axes by hand before a new scan.
- Save CSV writes every reading with its 3D point.

## Left to the builder

Layout and styling, following the existing page; how the port is reopened.
