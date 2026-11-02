"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PointCloud } from "@/components/PointCloud";
import { isCalibrated, type Calibration, type Sample, samplesToPoints } from "@/lib/convert";
import { parseScan, serializeScan } from "@/lib/scanFile";
import {
  runScan,
  Scanner,
  ScannerError,
  type ScanResult,
  type Transport,
} from "@/lib/scanner";
import { browserStorage, loadSettings, saveSettings, type Settings } from "@/lib/settings";
import {
  checkGrid,
  estimateSeconds,
  type Grid,
  limitsProblem,
  sweepPositions,
} from "@/lib/sweep";
import { isWebSerialAvailable, openWebSerial } from "@/lib/webSerial";

type Phase = "disconnected" | "connecting" | "checklist" | "ready" | "scanning";

const CHECKLIST = [
  "12V supply is on",
  "Tilt is at its reference mark",
  "The object is more than 10 cm from the sensor",
];
const JOG_STEPS = [-5, -1, 1, 5];
const RE_POSITION =
  "The Uno resets on connect and won't know where it is, so reconnect and put tilt back at its reference mark.";

const button =
  "rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800";
const primaryButton =
  "rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-40 disabled:hover:bg-amber-500";
const section = "space-y-2 border-t border-zinc-800 pt-4";
const heading = "text-sm font-semibold text-zinc-100";

function NumberField(props: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  onBlur?: () => void;
  disabled?: boolean;
  step?: string;
}) {
  const { label, value, onChange, onBlur, disabled, step } = props;
  return (
    <label className="block text-xs text-zinc-400">
      {label}
      <input
        type="number"
        step={step ?? "1"}
        value={value === null || Number.isNaN(value) ? "" : value}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        onBlur={onBlur}
        disabled={disabled}
        className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 disabled:opacity-50"
      />
    </label>
  );
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function describeResult(result: ScanResult, kept: number): string {
  if (result.status === "done") return `Scan finished with ${kept} samples.`;
  if (result.status === "stopped") return `Scan stopped. Kept ${kept} samples.`;
  return `Scan stopped: ${result.error?.message} Kept ${kept} samples.`;
}

const isFatal = (e: unknown) =>
  e instanceof ScannerError && e.kind !== "limit" && e.kind !== "motorsOff";

export function ScanApp() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(browserStorage()));
  const [phase, setPhase] = useState<Phase>("disconnected");
  const [checked, setChecked] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [motorsOn, setMotorsOn] = useState(false);
  const [position, setPosition] = useState({ pan: 0, tilt: 0 });
  const [samples, setSamples] = useState<Sample[]>([]);
  const [unsaved, setUnsaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const scannerRef = useRef<Scanner | null>(null);
  const transportRef = useRef<Transport | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { calibration, limits, tiltDriver, grid } = settings;
  const serialAvailable = isWebSerialAvailable();
  const scanning = phase === "scanning";
  const connected = phase === "checklist" || phase === "ready" || scanning;
  const points = useMemo(() => samplesToPoints(samples, calibration), [samples, calibration]);

  const gridProblem = checkGrid(grid, position.tilt, limits);
  const estimate = gridProblem
    ? null
    : { points: sweepPositions(grid).length, seconds: estimateSeconds(grid) };

  useEffect(() => saveSettings(browserStorage(), settings), [settings]);

  useEffect(() => {
    if (!scanning) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [scanning]);

  const disconnect = async () => {
    const transport = transportRef.current;
    transportRef.current = null;
    scannerRef.current = null;
    setPhase("disconnected");
    setMotorsOn(false);
    setPosition({ pan: 0, tilt: 0 });
    setChecked(CHECKLIST.map(() => false));
    await transport?.close();
  };

  // Runs one scanner action and reports its failure, dropping the connection if it's unusable.
  const act = async (action: (s: Scanner) => Promise<void>) => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      await action(scanner);
      setPosition({ ...scanner.position });
      setMessage(null);
    } catch (e) {
      if (isFatal(e)) {
        await disconnect();
        setMessage(`${describeError(e)} ${RE_POSITION}`);
      } else {
        setMessage(describeError(e));
      }
    }
  };

  const connect = async () => {
    setPhase("connecting");
    setMessage(null);
    let transport: Transport;
    try {
      transport = await openWebSerial();
    } catch (e) {
      setPhase("disconnected");
      if (e instanceof DOMException && e.name === "NotFoundError") return; // Chooser cancelled.
      setMessage(`Couldn't open the port. Another program may be using it. (${describeError(e)})`);
      return;
    }
    const scanner = new Scanner(transport);
    transportRef.current = transport;
    scannerRef.current = scanner;
    try {
      await scanner.waitReady();
      await scanner.setTiltDriver(tiltDriver);
      // Unusable limits are shown on the page and block scanning; the firmware keeps its defaults.
      if (!limitsProblem(limits)) await scanner.setLimits(limits.min, limits.max);
      setPosition({ ...scanner.position });
      setPhase("checklist");
    } catch {
      await disconnect();
      setMessage(
        "The Uno didn't answer as expected. Check that the scanner firmware is flashed and nothing else is using the port.",
      );
    }
  };

  const enable = () =>
    act(async (s) => {
      await s.enable();
      setMotorsOn(true);
      setPhase("ready");
    });

  const release = () =>
    act(async (s) => {
      await s.release();
      setMotorsOn(false);
    });

  const applyLimits = () => {
    if (limitsProblem(limits)) return;
    return act(async (s) => {
      try {
        await s.setLimits(limits.min, limits.max);
      } catch (e) {
        if (e instanceof ScannerError && e.kind === "limit")
          throw new Error(
            "Those limits don't include the current tilt position. Jog inside them first.",
          );
        throw e;
      }
    });
  };

  const changeTiltDriver = (driver: 0 | 1) => {
    setSettings((s) => ({ ...s, tiltDriver: driver }));
    return act((s) => s.setTiltDriver(driver));
  };

  const start = async () => {
    const scanner = scannerRef.current;
    if (!scanner || gridProblem) return;
    if (
      unsaved &&
      !window.confirm("Starting a new scan replaces the current one, which isn't saved. Continue?")
    )
      return;

    const controller = new AbortController();
    abortRef.current = controller;
    setSamples([]);
    setUnsaved(false);
    setMessage(null);
    setPhase("scanning");

    let kept = 0;
    const result = await runScan(scanner, sweepPositions(grid), {
      signal: controller.signal,
      onSample: (sample) => {
        kept++;
        setSamples((prev) => [...prev, sample]);
        setUnsaved(true);
      },
    });
    abortRef.current = null;
    setPosition({ ...scanner.position });
    if (result.error && isFatal(result.error)) {
      await disconnect();
      setMessage(`${describeResult(result, kept)} ${RE_POSITION}`);
    } else {
      setPhase("ready");
      setMessage(describeResult(result, kept));
    }
  };

  const save = () => {
    const url = URL.createObjectURL(
      new Blob([serializeScan(calibration, samples, new Date())], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `scan-${new Date().toISOString().replaceAll(":", "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setUnsaved(false);
  };

  const load = async (file: File) => {
    try {
      const scan = parseScan(await file.text());
      if (unsaved && !window.confirm("Loading replaces the current scan, which isn't saved. Continue?"))
        return;
      setSamples(scan.samples);
      setSettings((s) => ({ ...s, calibration: scan.calibration }));
      setUnsaved(false);
      setMessage(`Loaded ${file.name}.`);
    } catch (e) {
      setMessage(describeError(e));
    }
  };

  const setCalibration = (patch: Partial<Calibration>) =>
    setSettings((s) => ({ ...s, calibration: { ...s.calibration, ...patch } }));
  const setGrid = (patch: Partial<Grid>) =>
    setSettings((s) => ({ ...s, grid: { ...s.grid, ...patch } }));

  const jogRow = (label: string, move: (steps: number) => [number, number]) => (
    <div className="flex items-center gap-1.5">
      <span className="w-10 text-xs text-zinc-400">{label}</span>
      {JOG_STEPS.map((steps) => (
        <button
          key={steps}
          type="button"
          className={`${button} flex-1 tabular-nums`}
          disabled={phase !== "ready" || !motorsOn}
          aria-label={`${label} ${steps > 0 ? "+" : ""}${steps} steps`}
          onClick={() => act((s) => s.move(...move(steps)))}
        >
          {steps > 0 ? `+${steps}` : steps}
        </button>
      ))}
    </div>
  );

  const startProblem = !connected
    ? "Connect the scanner to start."
    : !isCalibrated(calibration)
      ? "Set tilt degrees per step before scanning."
      : !motorsOn
        ? "Enable the motors to start."
        : gridProblem;

  return (
    <main className="grid min-h-screen grid-cols-1 gap-4 bg-zinc-950 p-4 text-zinc-200 md:h-screen md:grid-cols-[22rem_1fr]">
      <div className="space-y-4 md:overflow-y-auto md:pr-2">
        <h1 className="text-lg font-semibold text-zinc-50">IR Pan-Tilt Scanner</h1>

        <section className="space-y-2">
          {!serialAvailable && (
            <p className="text-sm text-amber-300">
              Connecting needs Chrome or Edge, because this browser has no Web Serial. You
              can still load saved scans.
            </p>
          )}
          {connected ? (
            <button type="button" className={button} disabled={scanning} onClick={disconnect}>
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className={primaryButton}
              disabled={!serialAvailable || phase === "connecting"}
              onClick={connect}
            >
              {phase === "connecting" ? "Connecting..." : "Connect"}
            </button>
          )}
          <p role="status" className="min-h-5 text-sm text-amber-200">
            {message}
          </p>
        </section>

        {phase === "checklist" && (
          <section className={section}>
            <h2 className={heading}>Before enabling the motors</h2>
            {CHECKLIST.map((item, i) => (
              <label key={item} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked[i]}
                  onChange={(e) =>
                    setChecked((c) => c.map((v, j) => (j === i ? e.target.checked : v)))
                  }
                />
                {item}
              </label>
            ))}
            <button
              type="button"
              className={primaryButton}
              disabled={!checked.every(Boolean)}
              onClick={enable}
            >
              Enable motors
            </button>
          </section>
        )}

        <section className={section}>
          <h2 className={heading}>Position</h2>
          <p className="text-sm tabular-nums text-zinc-400">
            Pan {position.pan}, tilt {position.tilt} steps from zero
          </p>
          {jogRow("Pan", (steps) => [steps, 0])}
          {jogRow("Tilt", (steps) => [0, steps])}
          <div className="flex gap-1.5">
            {phase === "ready" &&
              (motorsOn ? (
                <button type="button" className={button} onClick={release}>
                  Release motors
                </button>
              ) : (
                <button type="button" className={button} onClick={enable}>
                  Enable motors
                </button>
              ))}
            <button
              type="button"
              className={button}
              disabled={phase !== "ready"}
              onClick={() => act((s) => s.setZero())}
            >
              Set zero
            </button>
          </div>
        </section>

        <section className={section}>
          <h2 className={heading}>Scan</h2>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Pan from" value={grid.panMin} disabled={scanning} onChange={(v) => setGrid({ panMin: v })} />
            <NumberField label="Pan to" value={grid.panMax} disabled={scanning} onChange={(v) => setGrid({ panMax: v })} />
            <NumberField label="Pan step" value={grid.panStep} disabled={scanning} onChange={(v) => setGrid({ panStep: v })} />
            <NumberField label="Tilt from" value={grid.tiltMin} disabled={scanning} onChange={(v) => setGrid({ tiltMin: v })} />
            <NumberField label="Tilt to" value={grid.tiltMax} disabled={scanning} onChange={(v) => setGrid({ tiltMax: v })} />
            <NumberField label="Tilt step" value={grid.tiltStep} disabled={scanning} onChange={(v) => setGrid({ tiltStep: v })} />
          </div>
          <p className="text-xs text-zinc-400">
            {estimate
              ? `${estimate.points} points, about ${Math.ceil(estimate.seconds / 60)} min. Ranges are steps from the current position.`
              : gridProblem}
          </p>
          <div className="flex items-center gap-1.5">
            {scanning ? (
              <button type="button" className={primaryButton} onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            ) : (
              <button type="button" className={primaryButton} disabled={Boolean(startProblem)} onClick={start}>
                Start scan
              </button>
            )}
            <button type="button" className={button} disabled={scanning || samples.length === 0} onClick={save}>
              Save
            </button>
            <label className={`${button} ${scanning ? "pointer-events-none opacity-40" : "cursor-pointer"}`}>
              Load
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                disabled={scanning}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void load(file);
                }}
              />
            </label>
          </div>
          {!scanning && startProblem && <p className="text-xs text-zinc-400">{startProblem}</p>}
        </section>

        <section className={section}>
          <h2 className={heading}>Calibration</h2>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Pan degrees per step" step="any" value={calibration.panDegPerStep} disabled={scanning} onChange={(v) => setCalibration({ panDegPerStep: v })} />
            <NumberField label="Tilt degrees per step" step="any" value={calibration.tiltDegPerStep} disabled={scanning} onChange={(v) => setCalibration({ tiltDegPerStep: Number.isNaN(v) ? null : v })} />
            <NumberField label="Sensor offset (cm)" step="any" value={calibration.sensorOffsetCm} disabled={scanning} onChange={(v) => setCalibration({ sensorOffsetCm: v })} />
            <NumberField label="Curve A" step="any" value={calibration.curveA} disabled={scanning} onChange={(v) => setCalibration({ curveA: v })} />
            <NumberField label="Curve B" step="any" value={calibration.curveB} disabled={scanning} onChange={(v) => setCalibration({ curveB: v })} />
          </div>
          <p className="text-xs text-zinc-400">
            Use a negative degrees value if an axis runs backwards. A scan of a flat wall
            should come out flat and at the right distance.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Tilt limit, lowest"
              value={limits.min}
              disabled={scanning}
              onChange={(v) => setSettings((s) => ({ ...s, limits: { ...s.limits, min: v } }))}
              onBlur={applyLimits}
            />
            <NumberField
              label="Tilt limit, highest"
              value={limits.max}
              disabled={scanning}
              onChange={(v) => setSettings((s) => ({ ...s, limits: { ...s.limits, max: v } }))}
              onBlur={applyLimits}
            />
          </div>
          <label className="block text-xs text-zinc-400">
            Tilt motor
            <select
              value={tiltDriver}
              disabled={scanning}
              onChange={(e) => changeTiltDriver(e.target.value === "1" ? 1 : 0)}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 disabled:opacity-50"
            >
              <option value={0}>Y driver</option>
              <option value={1}>X driver</option>
            </select>
          </label>
        </section>
      </div>

      <div className="flex min-h-[60vh] flex-col gap-2">
        <div className="min-h-0 flex-1">
          <PointCloud points={points} />
        </div>
        <p className="text-sm tabular-nums text-zinc-400">
          {points.length} of {samples.length} samples in range
          {samples.length > 0 && !isCalibrated(calibration) && ". Set tilt degrees per step to see them"}
        </p>
      </div>
    </main>
  );
}
