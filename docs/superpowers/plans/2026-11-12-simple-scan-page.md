# Simple Scan Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the owner's Arduino sketch from a one-screen page and show its readings as a live 3D point cloud.

**Architecture:** The sketch does the scan and prints text lines. The page parses each line into a reading, turns readings into points with one tilt setting, and draws them with the existing three.js view.

**Tech Stack:** Arduino C++, Next.js 16.4.4, TypeScript, three.js, Vitest, Web Serial.

**Spec:** `docs/superpowers/specs/2026-11-12-simple-scan-page-design.md`

## Global Constraints

- The sketch is used exactly as the owner wrote it.
- Pan = X − 22.5°; tilt = Y × span / 450 − span / 2; default span 30°.
- Commands: `t`, `s`, `q`. Ready line contains `scanner ready`.

## Review Focus

1. A line with a junk byte stuck to its front still parses (the Uno sends one at boot).
2. Out-of-range and invalid-signal readings are counted but never become NaN points.
3. A blank or non-numeric tilt setting doesn't break the view.
4. Disconnecting mid-scan keeps the readings and says what happened.
5. Closing the tab with an unsaved scan warns first.

---

### Task 1: Firmware and line parser

**Files:** Modify `firmware/scanner/scanner.ino`; Create `web/lib/sketchLine.ts`; Test `web/lib/sketchLine.test.ts`

**Produces:**
```ts
type Reading = { row: number | null; rows: number | null; xDeg: number | null; yMicrosteps: number | null; adc: number; volts: number; cm: number | null };
type Point = { x: number; y: number; z: number; cm: number };
function parseLine(line: string): Reading | null;
function toPoint(r: Reading, tiltSpanDeg: number): Point | null;
function toCsv(readings: Reading[], tiltSpanDeg: number): string;
```

- [ ] Replace the firmware with the owner's sketch and compile it.
- [ ] Tests: a Row line parses every field; `t`'s line parses with null row/x/y; "Outside nominal" and "Invalid signal" give `cm: null`; a junk byte before `Row` still parses; status lines return null; `toPoint` at X 22.5, Y 225 is straight ahead; X 0 points left by 22.5°; null cm, null x/y or a non-finite span give null; CSV has a header and one row per reading.
- [ ] Watch them fail, implement, watch them pass.

### Task 2: The page

**Files:** Rewrite `web/components/ScanApp.tsx`; Modify `web/lib/webSerial.ts` (accept an existing port), `web/components/PointCloud.tsx` (import `Point` from `sketchLine`)

- [ ] Buttons: Connect / New scan, Test reading, Start, Stop, Save CSV. Status line: row, point count, last reading. Tilt span input remembered in `localStorage` (`rlk-tilt-span`, guarded with try/catch).
- [ ] Warn before closing with unsaved readings; on disconnect keep readings and say so.
- [ ] Test `openWebSerial(port)` reuses the given port.

### Task 3: Remove the old code and update docs

- [ ] Delete `web/lib/{convert,scanner,sweep,settings,scanFile}*`, `firmware/test/`, `docs/sample-scan.json`, `web/scripts/`.
- [ ] Rewrite `docs/hardware-checklist.md` for the sketch; update `CLAUDE.md` (1/16 microstepping, commands); mark the old spec as replaced.
- [ ] `npm test`, type check, lint, build all pass.

### Task 4: Check in the browser

- [ ] Drive the page against a simulated port that prints the sketch's exact lines: connect, test, scan, stop, disconnect, save, change the tilt span.
