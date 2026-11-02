# 3D Scan Viewer Design

Date: 2026-11-02

## Goal

Sweep the IR pan-tilt scanner across a single object 20-60 cm away and show the
readings as a 3D point cloud in the browser.

One sweep from one position produces a 3D relief of the side facing the scanner.
The back of the object is not captured.

## Out of scope

- Merging scans from several views, or a turntable
- Building a solid surface from the points
- Exporting to PLY or other 3D formats
- Automatic homing (the hardware has no endstops)

## Structure

```
firmware/scanner/scanner.ino   Uno firmware, no scan logic
web/                           Next.js app, TypeScript, Tailwind
  lib/convert.ts               raw reading -> cm -> 3D point
  lib/sweep.ts                 scan grid -> ordered list of positions
  lib/scanner.ts               serial protocol and scan run, on an injected transport
  components/PointCloud.tsx    three.js point cloud with orbit controls
  app/page.tsx                 controls, settings, view
```

The browser drives the sweep one command at a time. Sweep changes need no reflash,
and the logic is testable TypeScript. If the tab closes mid-scan, the scan stops.

Web Serial requires Chrome or Edge. The page says so if `navigator.serial` is missing.

## Firmware

115200 baud. Each command gets one reply line. Moves run at about 100 steps per second.

| Command | Action | Reply |
| --- | --- | --- |
| `M <pan> <tilt>` | Move by relative steps, both axes together | `ok <pan> <tilt>` (position from zero) |
| `R` | Wait 100 ms, take 10 readings 40 ms apart | `d <raw>` (median) |
| `L <min> <max>` | Set tilt limits, in steps from zero | `ok` |
| `A <0 or 1>` | Choose the tilt driver: 0 = Y (default), 1 = X | `ok` |
| `Z` | Make the current position zero | `ok` |
| `E` / `D` | Enable or release the motors | `ok` |
| Any other input | None | `err cmd` |
| On boot | Uno has reset; position is zero | `ready` |

Tilt limits default to -20 and +20 steps after every boot. A move that would pass a
limit replies `err limit` and moves neither axis. This is enforced in the firmware so
that a page bug cannot jam the linkage.

Pins follow `CLAUDE.md`: enable D8 (LOW = on), X step/dir D2/D5, Y step/dir D3/D6,
sensor A3.

## Position and limits

The firmware forgets its position on every reset, and opening the serial port resets
the Uno. There is no way to detect where the axes physically are.

- The operator marks a tilt **reference position** on the linkage. Measured tilt limits
  are steps from that mark.
- After connecting, the page asks the operator to confirm tilt is at the mark. If it is
  not, they release the motors, move it by hand, re-enable, and press Set Zero (`Z`).
- On connect the page sends the saved axis choice and tilt limits (`A`, `L`).

Scans are relative to where the scanner sits when the scan starts, so the operator can
aim with the jog buttons first. A scan returns to that position when it ends.

## Converting readings to points

Samples are stored raw as `{panSteps, tiltSteps, raw}`, with steps relative to the scan
start. Points are always calculated from samples, so changing a calibration value
updates an existing scan without rescanning.

```
volts = raw * 5 / 1023
cm    = curveA * volts^curveB

pan  = panSteps  * panDegPerStep
tilt = tiltSteps * tiltDegPerStep
r    = cm + sensorOffsetCm

x = r * cos(tilt) * sin(pan)
y = r * sin(tilt)
z = r * cos(tilt) * cos(pan)
```

A sample is dropped if `volts < 0.35` or `cm` is outside 10-80. Below about 10 cm the
sensor's output falls again, so a very close object reads as far away. Software cannot
detect this, and the page tells the operator to keep the object beyond 10 cm.

### Calibration settings

Editable on the page and kept in `localStorage`.

| Setting | Default | How to set it |
| --- | --- | --- |
| `panDegPerStep` | 1.8 | Change if the base is geared; negative if the axis runs backwards |
| `tiltDegPerStep` | None; required before scanning | Jog a known number of steps and measure the angle; negative if the axis runs backwards |
| `sensorOffsetCm` | 0 | Distance from the pivot to the sensor's front |
| `curveA`, `curveB` | 27.728, -1.2045 | Adjust if a known distance reads wrong |
| Tilt limits | -20, +20 | Measured travel from the reference mark |
| Tilt driver | Y | Set after the first small test move |

Check: a scan of a flat wall at a known distance should come out flat and at that
distance.

Known limits: one degrees-per-step value approximates the screw linkage, which is
probably not linear. If the wall test shows this matters, replace it with a lookup
table. The sensor's beam width also softens sharp edges, which software cannot fix.

## Sweep

Inputs: pan and tilt ranges, in steps from the scan start, and the step size on each
axis. Default: pan -15 to +15, tilt -10 to +10, step size 1, which is 651 points and
about 6 minutes. The page shows the point count and estimated time before starting.

Path: back and forth along pan, moving tilt in one direction only, so slack in the
screw does not shift rows relative to each other. Each position is a move followed by a
read. The page adds each sample to the view as it arrives.

## Page

Settings and controls on the left, 3D view on the right. Controls: connect, jog buttons,
release/enable motors, set zero, calibration, scan range, start, stop, save, load.
Points are coloured by distance. The view rotates and zooms with orbit controls.

Scans save and load as JSON: `{version, createdAt, calibration, samples}`. Loading a
scan also loads its calibration into the settings. No hardware is needed to load one.

## Failure handling

| Situation | Behaviour |
| --- | --- |
| Grid would exceed tilt limits | Refused before any motor moves; the message names the limit |
| `tiltDegPerStep` not set | Start is disabled |
| Stop pressed | Finishes the current command, returns to the scan start, keeps the samples |
| Disconnect, or no reply within the timeout (2 s plus the move's duration) | Scan stops and keeps the samples; the page asks the operator to re-position, since reconnecting resets the Uno |
| `err limit` during a scan | Scan stops and keeps the samples; the message names the limit |
| Tab closed during a scan | The page warns first |
| Skipped motor steps | Not detectable without endstops; moves stay slow to avoid them |

## Testing

Automated (Vitest):

- `convert`: known values, out-of-range samples dropped, axis directions in the 3D math
- `sweep`: back-and-forth order, tilt moves one way only, returns to start, limit refusal
- `scanner`: replies, `err limit`, timeouts and disconnects, against a fake Uno transport

Also verified without hardware:

- Firmware compiles with `arduino-cli` for `arduino:avr:uno`
- A synthetic sample scan loads and renders in the 3D view in the browser

Needs the operator at the hardware, with no motors plugged or unplugged while 12V is on:

1. Small test moves (5 steps or fewer) to confirm which driver is pan and which is tilt
2. Mark the tilt reference and measure the tilt limits in small jogs
3. Measure `tiltDegPerStep`
4. Scan a flat wall at a known distance
5. Scan an object
