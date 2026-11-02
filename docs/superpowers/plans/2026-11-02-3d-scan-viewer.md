# 3D Scan Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sweep the IR pan-tilt scanner across an object and show the readings as a live, rotatable 3D point cloud in the browser.

**Architecture:** Stateless Uno firmware answers one-line serial commands and enforces tilt limits. A Next.js page drives the sweep over Web Serial, stores raw samples, and calculates 3D points from them, so calibration changes update an existing scan. All logic except rendering and the browser serial API is plain TypeScript tested against a fake Uno.

**Tech Stack:** Arduino C++ (`arduino-cli`, FQBN `arduino:avr:uno`), Next.js 16.4.4, TypeScript, Tailwind, three.js 0.187.0, Vitest, Web Serial.

**Spec:** `docs/superpowers/specs/2026-11-02-3d-scan-viewer-design.md`

## Global Constraints

- Serial: 115200 baud, one reply line per command, exact protocol as in the spec's Firmware section plus `err off` (below).
- Pins: enable D8 (LOW = on), X step/dir D2/D5, Y step/dir D3/D6, sensor A3.
- Tilt limits default to -20 and +20 steps after every boot. Moves run at about 100 steps per second.
- Reading validity: drop if `volts < 0.35` or `cm` outside 10-80. Curve defaults `27.728`, `-1.2045`.
- No user-visible behaviour may depend on hardware state the software cannot know. Where it can't detect something, the page tells the operator.
- Work on branch `scan-viewer`. Commit per task; do not push.
- Do not upload firmware or move motors without the operator present.

**Addition to the spec:** motors stay released after boot, and `M` while released replies `err off` and moves nothing. Otherwise a forgotten enable would produce a scan of one spot with no error.

## Review Focus

1. Uno resets mid-scan (`ready` arrives as a reply), or a reply arrives after its timeout: the scan stops with a clear message and never pairs a late reply with a later command.
2. Jog button clicked rapidly: commands run one at a time, in order, and each gets its own reply.
3. Loading a malformed, truncated or wrong-version scan file: an error message appears and the current scan stays on screen.
4. Blank, zero, negative, decimal or reversed scan ranges: refused with a message, with no hang and no motor movement.
5. A scan where nothing is in range (object past 80 cm): the page shows "0 of N samples in range", and the view stays valid with no NaN from fitting the camera.

---

### Task 1: Project setup and reading conversion

**Files:**
- Create: `web/` (via `create-next-app`), `web/vitest.config.ts`, `web/lib/convert.ts`
- Test: `web/lib/convert.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Calibration = { panDegPerStep: number; tiltDegPerStep: number | null; sensorOffsetCm: number; curveA: number; curveB: number };
  const DEFAULT_CALIBRATION: Calibration; // 1.8, null, 0, 27.728, -1.2045
  type Sample = { panSteps: number; tiltSteps: number; raw: number };
  type Point = { x: number; y: number; z: number; cm: number };
  function isCalibrated(cal: Calibration): boolean; // both deg-per-step finite and non-zero
  function rawToCm(raw: number, cal: Calibration): number | null;
  function sampleToPoint(s: Sample, cal: Calibration): Point | null; // null if out of range or not calibrated
  function samplesToPoints(samples: Sample[], cal: Calibration): Point[];
  ```

- [ ] **Step 1: Create the branch and scaffold**

```bash
cd ~/RLK && git switch -c scan-viewer
npx create-next-app@16.4.4 web --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --disable-git --yes
cd web && npm install three@0.187.0 && npm install -D vitest @types/three @types/w3c-web-serial
```

Add `"test": "vitest run"` to `web/package.json`. `vitest.config.ts` includes `lib/**/*.test.ts` in the `node` environment.

- [ ] **Step 2: Write failing tests in `convert.test.ts`**

With `cal = { ...DEFAULT_CALIBRATION, tiltDegPerStep: 1.8 }`:

```ts
it("converts volts with the curve", () => expect(rawToCm(204.6, cal)).toBeCloseTo(27.728, 2));
it("drops low voltage, including zero", () => { for (const r of [0, 71]) expect(rawToCm(r, cal)).toBeNull(); });
it("applies the 80 cm limit", () => { expect(rawToCm(84, cal)).toBeNull(); expect(rawToCm(85, cal)).toBeCloseTo(79.88, 1); });
it("applies the 10 cm limit", () => { expect(rawToCm(478, cal)).toBeNull(); expect(rawToCm(477, cal)).toBeCloseTo(10.0, 1); });
it("points straight ahead at zero angles", () => expectPoint({ panSteps: 0, tiltSteps: 0, raw: 204.6 }, cal, [0, 0, 27.728]));
it("pan 90 degrees is +x", () => expectPoint({ panSteps: 50, tiltSteps: 0, raw: 204.6 }, cal, [27.728, 0, 0]));
it("tilt 90 degrees is +y", () => expectPoint({ panSteps: 0, tiltSteps: 50, raw: 204.6 }, cal, [0, 27.728, 0]));
it("negative degrees mirrors the axis", () => expectPoint({ panSteps: 50, tiltSteps: 0, raw: 204.6 }, { ...cal, panDegPerStep: -1.8 }, [-27.728, 0, 0]));
it("adds the sensor offset to r", () => expectPoint({ panSteps: 0, tiltSteps: 0, raw: 204.6 }, { ...cal, sensorOffsetCm: 2 }, [0, 0, 29.728]));
it("isCalibrated rejects null, 0 and NaN", () => { for (const t of [null, 0, NaN]) expect(isCalibrated({ ...cal, tiltDegPerStep: t })).toBe(false); });
it("uncalibrated samples produce no points", () => expect(samplesToPoints([{ panSteps: 0, tiltSteps: 0, raw: 300 }], DEFAULT_CALIBRATION)).toEqual([]));
it("an all out-of-range scan is empty, not NaN", () => expect(samplesToPoints([{ panSteps: 0, tiltSteps: 0, raw: 0 }], cal)).toEqual([]));
```

`expectPoint` is a local helper asserting `x`, `y`, `z` with `toBeCloseTo(_, 2)`.

- [ ] **Step 3: Run `cd web && npm test`.** Expected: FAIL, module not found.
- [ ] **Step 4: Implement `web/lib/convert.ts`** using the formulas in the spec's conversion section. Check `curveA`/`curveB` output with `Number.isFinite`.
- [ ] **Step 5: Run `npm test`.** Expected: PASS.
- [ ] **Step 6: Commit** `web/` (including `package-lock.json`), the spec and this plan: `Add web app skeleton and reading conversion`.

### Task 2: Sweep path

**Files:**
- Create: `web/lib/sweep.ts`
- Test: `web/lib/sweep.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Grid = { panMin: number; panMax: number; panStep: number; tiltMin: number; tiltMax: number; tiltStep: number };
  const DEFAULT_GRID: Grid; // -15, 15, 1, -10, 10, 1
  type Pos = { pan: number; tilt: number }; // steps relative to the scan start
  type TiltLimits = { min: number; max: number };
  function checkGrid(grid: Grid, startTilt: number, limits: TiltLimits): string | null; // refusal message, or null if valid
  function sweepPositions(grid: Grid): Pos[]; // call only after checkGrid returns null
  function estimateSeconds(grid: Grid): number; // 0.5 s per read plus step travel at 100 steps/s
  ```

- [ ] **Step 1: Write failing tests**

```ts
it("default grid is 651 points", () => expect(sweepPositions(DEFAULT_GRID)).toHaveLength(651));
it("starts at the low corner and reverses each row", () => {
  const p = sweepPositions(DEFAULT_GRID);
  expect(p[0]).toEqual({ pan: -15, tilt: -10 });
  expect(p[30]).toEqual({ pan: 15, tilt: -10 });
  expect(p[31]).toEqual({ pan: 15, tilt: -9 });
});
it("tilt never moves down", () => { /* every p[i].tilt >= p[i-1].tilt */ });
it("step sizes never overshoot the range", () => {
  const p = sweepPositions({ ...DEFAULT_GRID, tiltMin: -10, tiltMax: 10, tiltStep: 3 });
  expect(Math.max(...p.map((q) => q.tilt))).toBe(8);
});
it("refuses a grid past the tilt limit and names it", () => {
  expect(checkGrid(DEFAULT_GRID, 15, { min: -20, max: 20 })).toContain("20");
  expect(checkGrid(DEFAULT_GRID, -15, { min: -20, max: 20 })).toContain("-20");
});
it("accepts a grid that exactly reaches the limit", () => expect(checkGrid(DEFAULT_GRID, 10, { min: -20, max: 20 })).toBeNull());
it.each([{ panStep: 0 }, { tiltStep: -1 }, { panStep: 1.5 }, { panMin: 20 }, { tiltMax: NaN }])(
  "refuses invalid grid %o", (bad) => expect(checkGrid({ ...DEFAULT_GRID, ...bad }, 0, { min: -20, max: 20 })).toEqual(expect.any(String)));
it("estimates the default at about 6 minutes", () => { const s = estimateSeconds(DEFAULT_GRID); expect(s).toBeGreaterThan(300); expect(s).toBeLessThan(380); });
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `web/lib/sweep.ts`.** Add a comment: `// ponytail: the first row is approached from above, so screw slack can shift it; add an approach move if the wall test shows it.`
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `Add scan sweep path and grid checks`.

### Task 3: Serial protocol and scan run

**Files:**
- Create: `web/lib/scanner.ts`
- Test: `web/lib/scanner.test.ts` (contains `FakeUno`, implementing `Transport` and following the firmware protocol, with options to go silent, disconnect, or send `ready` after N commands)

**Interfaces:**
- Consumes: `Sample` (Task 1), `Pos` (Task 2)
- Produces:
  ```ts
  interface Transport { write(line: string): Promise<void>; readLine(): Promise<string | null>; /* null = closed */ close(): Promise<void> }
  type ScannerErrorKind = "limit" | "motorsOff" | "timeout" | "disconnected" | "reset" | "protocol";
  class ScannerError extends Error { kind: ScannerErrorKind }
  class Scanner {
    constructor(t: Transport, opts?: { baseTimeoutMs?: number }); // default 2000
    position: { pan: number; tilt: number };
    waitReady(timeoutMs?: number): Promise<void>; // default 5000
    move(pan: number, tilt: number): Promise<void>;
    read(): Promise<number>;
    setLimits(min: number, max: number): Promise<void>;
    setTiltDriver(d: 0 | 1): Promise<void>;
    setZero(): Promise<void>;
    enable(): Promise<void>;
    release(): Promise<void>;
  }
  type ScanResult = { status: "done" | "stopped" | "failed"; error?: ScannerError };
  function runScan(s: Scanner, positions: Pos[], opts: { signal: AbortSignal; onSample: (x: Sample) => void }): Promise<ScanResult>;
  ```

Behaviour: commands run one at a time through an internal promise queue. Timeout is `baseTimeoutMs` plus the move duration (`max(|pan|,|tilt|) / 100` s). After `timeout`, `disconnected`, `reset` or `protocol`, the `Scanner` is dead: every later call rejects with that same error, because replies can no longer be paired reliably. `limit` and `motorsOff` leave it usable. `runScan` records samples relative to `s.position` at its start. It returns to that position after `done`, `stopped` and a `limit` failure, and never after a dead-scanner failure.

- [ ] **Step 1: Write failing tests** (`baseTimeoutMs: 20` throughout)

```ts
it("ignores boot noise before ready");            // lines "garbage", "ready" -> resolves
it("waitReady rejects with timeout if the Uno stays silent");
it("move tracks position from the reply");        // move(3,-2) -> position {pan:3,tilt:-2}
it("err limit rejects, keeps position, stays usable"); // kind "limit"; next move succeeds
it("err off rejects with motorsOff");
it("read parses d <raw>");                        // "d 300" -> 300
it("runs rapid calls in order");                  // Promise.all of 5 move(1,0) -> position.pan === 5, uno saw 5 "M 1 0" in order
it("a late reply after a timeout is not paired with the next command"); // silent then late "ok"; next call rejects kind "timeout"
it("ready during a command means reset");         // kind "reset"; later calls reject too
it("a closed transport rejects with disconnected");
it("an unexpected reply rejects with protocol");  // read gets "ok"
// runScan, using sweepPositions of a 2x2 grid from a non-zero starting position:
it("records raw samples relative to the scan start and returns to start"); // status done; samples match grid; position === start
it("stop keeps samples and returns to start");    // abort in onSample after 1 -> status stopped; 1 sample; position === start
it("disconnect mid-scan keeps samples and sends no more commands"); // status failed, kind disconnected
it("reset mid-scan keeps samples and sends no more commands");      // status failed, kind reset
it("limit mid-scan keeps samples and returns to start");            // status failed, kind limit
it("a failed return reports failed, not done");   // silent on the return move -> status failed, kind timeout
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `web/lib/scanner.ts`.** `waitReady` skips any lines until `ready`. Use `Promise.race` with a timer for timeouts.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `Add scanner serial protocol and scan run`.

### Task 4: Firmware

**Files:**
- Create: `firmware/scanner/scanner.ino`

**Interfaces:**
- Produces: the serial protocol in the spec's Firmware table, plus `err off`. `Scanner` (Task 3) is its client.

Decisions the spec leaves open:
- Boot: enable pin HIGH (released). `Serial.begin(115200)`, then print `ready`.
- Input: read characters into a 32-byte buffer until newline, ignoring `\r`. An overflowing line is discarded and replies `err cmd`. Parse with `sscanf`, using `long` for steps.
- `L` replies `err cmd` and keeps the old limits if `min > 0` or `max < 0`, so zero always stays inside them.
- `M`: check released (`err off`), then the tilt limit (`err limit`), then step. Check both before moving. Step both axes in one loop with a 10 ms period, and set direction pins before the first pulse. Tilt pins come from `A`, pan pins are the other driver. Position is logical, so `A` swaps pins, not counts.
- `R`: `delay(100)`, then 10 `analogRead(A3)` calls 40 ms apart, reply the median (mean of the middle two is not needed; take the sorted element at index 5).
- Add a comment on the step delay: `// ponytail: fixed speed, no ramp. Add acceleration if test moves skip steps.`

- [ ] **Step 1: Install the compiler**

```bash
brew install arduino-cli
arduino-cli core install arduino:avr
```

- [ ] **Step 2: Write `firmware/scanner/scanner.ino`.**
- [ ] **Step 3: Compile.**

Run: `arduino-cli compile --fqbn arduino:avr:uno ~/RLK/firmware/scanner`
Expected: exit 0 with a program size report and under 75% of dynamic memory used.

- [ ] **Step 4: Commit:** `Add scanner firmware`.

Firmware behaviour is only verified at the hardware, in Task 6's checklist.

### Task 5: Scan files, settings, and the page

**Files:**
- Create: `web/lib/scanFile.ts`, `web/lib/settings.ts`, `web/lib/webSerial.ts`, `web/components/PointCloud.tsx`
- Modify: `web/app/page.tsx`, `web/app/layout.tsx` (title)
- Test: `web/lib/scanFile.test.ts`, `web/lib/settings.test.ts`, `web/lib/webSerial.test.ts`

**Interfaces:**
- Consumes: Task 1, 2 and 3 exports.
- Produces:
  ```ts
  // scanFile.ts
  type ScanFile = { version: 1; createdAt: string; calibration: Calibration; samples: Sample[] };
  function serializeScan(calibration: Calibration, samples: Sample[], now: Date): string;
  function parseScan(text: string): ScanFile; // throws Error with a user-readable message
  // settings.ts
  type Settings = { calibration: Calibration; limits: TiltLimits; tiltDriver: 0 | 1; grid: Grid };
  const DEFAULT_SETTINGS: Settings;
  function loadSettings(storage: Pick<Storage, "getItem">): Settings;
  function saveSettings(storage: Pick<Storage, "setItem">, s: Settings): void;
  // webSerial.ts
  function isWebSerialAvailable(): boolean;
  function openWebSerial(): Promise<Transport>; // requestPort, open at 115200
  function createLineSplitter(): (chunk: string) => string[]; // keeps partial lines between chunks, strips \r
  // PointCloud.tsx
  function PointCloud(props: { points: Point[] }): JSX.Element;
  ```

- [ ] **Step 1: Write failing tests**

```ts
// scanFile.test.ts
it("round-trips a scan");
it.each(["not json", "[]", "{}", '{"version":2}', /* calibration missing */ /* sample raw is a string */ /* raw of 2000 */ /* tiltDegPerStep null */])(
  "rejects %s with a message", (text) => expect(() => parseScan(text)).toThrow());
// settings.test.ts
it("returns defaults when nothing is stored");
it("returns defaults when the stored value is corrupt");  // getItem -> "{oops"
it("fills fields missing from older stored settings");    // only calibration stored -> limits are -20, 20
// webSerial.test.ts
it("joins lines split across chunks");                    // "rea", "dy\r\nok" -> [], ["ready"], then "ok" held
it("returns several lines from one chunk");
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `scanFile.ts`, `settings.ts` and `webSerial.ts`.** `settings.ts` uses key `rlk-settings`. In `close()`, cancel the reader before closing the port, or the port stays locked. A read error resolves `readLine` to `null`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Implement `PointCloud.tsx`.** A client component that creates its three.js renderer, scene, `OrbitControls` and `ResizeObserver` in `useEffect`, and disposes them in cleanup (Strict Mode mounts twice). Rebuild the `BufferGeometry` when `points` changes, without moving the camera, so a live scan doesn't fight the user. Colour by distance across the data's own min-max, and handle min = max. Initial camera `(60, 30, -20)` looking at `(0, 0, 40)`, with a small marker at the origin for the scanner. A "Fit view" button re-aims at the points' centre and does nothing with no points.
- [ ] **Step 6: Implement `page.tsx`.** A client component holding `Settings`, `samples`, the `Scanner` and a status message. Settings load in `useEffect`, to avoid hydration mismatch.
  - **Connect:** if `!isWebSerialAvailable()`, show "Web Serial needs Chrome or Edge" and disable the button. Otherwise `openWebSerial`, `waitReady`, `setTiltDriver`, `setLimits`. A `waitReady` timeout says the firmware may not be flashed, or another program may hold the port.
  - **Checklist before enabling:** 12V on, tilt at the reference mark, object beyond 10 cm. Confirming sends `E`.
  - **Controls:** jog ±1 and ±5 per axis, Release/Enable, Set Zero, calibration inputs, grid inputs with point count and estimated time, Start, Stop, Save, Load. Blank numeric inputs become `null` or `NaN` and fail validation.
  - **Start:** disabled until `isCalibrated` and connected; `checkGrid` message shown when refused. During a scan all controls but Stop are disabled, and `beforeunload` warns.
  - **Result:** show `{points.length} of {samples.length} samples in range`. Calculate points with `useMemo(samplesToPoints)`. Failure messages from `ScanResult` name the cause, and dead-scanner kinds also say to reconnect and re-position.
  - **Save/Load:** download via a Blob URL; load via `<input type="file">`, and `parseScan` errors leave the current scan in place.
- [ ] **Step 7: Check.**

Run: `cd web && npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all exit 0.

- [ ] **Step 8: Commit:** `Add scan page, 3D view and scan files`.

### Task 6: Check it end to end and hand over

**Files:**
- Create: `web/scripts/make-sample-scan.mjs`, `docs/sample-scan.json`, `docs/hardware-checklist.md`
- Modify: `CLAUDE.md` (Status section)

- [ ] **Step 1: Write `make-sample-scan.mjs`** generating a 20 cm radius sphere centred 40 cm ahead on the default grid with `tiltDegPerStep: 1.8`, inverting the curve to get raw values, with misses set to raw 0. Run `node web/scripts/make-sample-scan.mjs > docs/sample-scan.json`.
- [ ] **Step 2: Verify in the built-in browser.** Run `npm run dev` from `web/`, load `docs/sample-scan.json`, and check: a curved cap is visible and rotates; the count reads "N of 651"; changing `tiltDegPerStep` reshapes it without a reload; Save produces a file that loads; a non-JSON file shows an error and keeps the scan; a scan file whose samples are all raw 0 shows "0 of N" and Fit view doesn't break; the console has no errors. Check phone width too.
- [ ] **Step 3: Write `docs/hardware-checklist.md`**, in order. Reminder at top: never plug or unplug motors with 12V on.
  1. Flash: `arduino-cli upload -p <port> --fqbn arduino:avr:uno firmware/scanner`.
  2. Connect; on Enable, confirm motors hold.
  3. Jog 1 step on each axis to confirm which is pan and which is tilt; set the tilt driver.
  4. Confirm protection: with tilt limits at defaults, jog tilt +5 five times; the fifth must be refused at +20 if the linkage has room. Stop earlier if it nears the end of its travel.
  5. Mark the tilt reference, measure the limits in small jogs, and enter them.
  6. Measure `tiltDegPerStep`, using a negative value if tilt runs backwards. Do the same check for pan.
  7. Scan a flat wall at a known distance; adjust until flat and correct.
  8. Scan an object at 20-60 cm.
- [ ] **Step 4: Update the `CLAUDE.md` Status section** with the new firmware and web app, how to run them, and that `arduino-cli` is installed. Replace "Next: build the actual scanning software" with "Next: work through `docs/hardware-checklist.md`".
- [ ] **Step 5: Commit:** `Add sample scan and hardware checklist`.

Web Serial and the firmware have not met until the operator runs the checklist. Report this plainly rather than calling the project done.
