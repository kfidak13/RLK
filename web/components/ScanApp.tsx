"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PointCloud } from "@/components/PointCloud";
import {
  parseLine,
  type Point,
  type Reading,
  scanSettingsProblem,
  scanSize,
  sweepMicrosteps,
  toCsv,
  toPoint,
} from "@/lib/sketchLine";
import { isWebSerialAvailable, openWebSerial, type Transport } from "@/lib/webSerial";

type Phase = "disconnected" | "connecting" | "ready" | "scanning" | "done";

const READY_TIMEOUT_MS = 5000;

const button =
  "rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800";
const primaryButton =
  "rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-40 disabled:hover:bg-amber-500";

// A number setting remembered in this browser. Blank is NaN.
function useStoredNumber(key: string, fallback: number) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null || stored === "" ? fallback : Number(stored);
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, Number.isNaN(value) ? "" : String(value));
    } catch {
      // Only costs remembering the setting between visits.
    }
  }, [key, value]);
  return [value, setValue] as const;
}

function Setting(props: {
  label: string;
  unit: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-400">
      {props.label}
      <input
        type="number"
        step="any"
        value={Number.isNaN(props.value) ? "" : props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        className="w-20 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 disabled:opacity-50"
      />
      {props.unit}
    </label>
  );
}

function describe(r: Reading): string {
  return r.cm === null ? `${r.volts} V, out of range` : `${r.cm} cm`;
}

export function ScanApp() {
  const [phase, setPhase] = useState<Phase>("disconnected");
  const [readings, setReadings] = useState<Reading[]>([]);
  const [last, setLast] = useState<Reading | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tiltSpan, setTiltSpan] = useStoredNumber("rlk-tilt-span", 30);
  const [sweepDeg, setSweepDeg] = useStoredNumber("rlk-x-sweep", 45);
  const [yRow, setYRow] = useStoredNumber("rlk-y-row", 10);
  // The sweep the current scan used, so its points stay centred if the setting changes.
  const [scanSweep, setScanSweep] = useState(sweepDeg);
  const [unsaved, setUnsaved] = useState(false);
  const transportRef = useRef<Transport | null>(null);
  const phaseRef = useRef<Phase>("disconnected");

  const serialAvailable = isWebSerialAvailable();
  const scanning = phase === "scanning";
  const settingsProblem = scanSettingsProblem(sweepDeg, yRow);
  const size = settingsProblem ? null : scanSize(sweepDeg, yRow);
  const points = useMemo(
    () =>
      readings.map((r) => toPoint(r, tiltSpan, scanSweep)).filter((p): p is Point => p !== null),
    [readings, tiltSpan, scanSweep],
  );
  const row = readings.at(-1);

  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const handleLine = (line: string) => {
    if (line.includes("scanner ready")) {
      go("ready");
      setMessage("Ready. Put Y at its lower end and X at the start of its sweep, then press Start.");
    } else if (line.startsWith("Scan started")) {
      go("scanning");
      setMessage("Scanning. Press Stop to end early.");
    } else if (line.startsWith("Scan complete")) {
      go("done");
      setMessage("Scan complete. Save it, then reposition both axes before a new scan.");
    } else if (line.startsWith("Scan stopped")) {
      go("done");
      setMessage("Scan stopped. Reposition both axes by hand before a new scan.");
    } else if (line.startsWith("Reposition both axes")) {
      setMessage("The Arduino only scans once per reset. Press New scan.");
    }

    const reading = parseLine(line);
    if (!reading) return;
    setLast(reading);
    if (reading.row !== null) {
      setReadings((prev) => [...prev, reading]);
      setUnsaved(true);
    }
  };

  // Opening the port resets the Arduino, which is what allows a new scan.
  const connect = async (existing?: SerialPort) => {
    go("connecting");
    setMessage(null);
    let transport: Transport;
    try {
      transport = await openWebSerial(existing);
    } catch (e) {
      go("disconnected");
      if (e instanceof DOMException && e.name === "NotFoundError") return; // Chooser cancelled.
      setMessage("Couldn't open the port. Close the Arduino Serial Monitor and try again.");
      return;
    }
    transportRef.current = transport;

    setTimeout(() => {
      if (transportRef.current === transport && phaseRef.current === "connecting")
        setMessage(
          "No answer from the scanner sketch. Check it's uploaded and the Serial Monitor is closed.",
        );
    }, READY_TIMEOUT_MS);

    for (let line = await transport.readLine(); line !== null; line = await transport.readLine())
      handleLine(line);

    if (transportRef.current === transport) {
      transportRef.current = null;
      go("disconnected");
      setMessage("The Arduino disconnected. Readings so far are kept.");
    }
  };

  const newScan = async () => {
    if (unsaved && !window.confirm("The current scan isn't saved. Start over anyway?")) return;
    const transport = transportRef.current;
    transportRef.current = null;
    setReadings([]);
    setLast(null);
    setUnsaved(false);
    if (!transport) return connect();
    await transport.close();
    return connect(transport.port);
  };

  const send = (command: string) => transportRef.current?.write(command);

  const start = async () => {
    if (settingsProblem) return;
    if (unsaved && !window.confirm("The current scan isn't saved. Replace it?")) return;
    setReadings([]);
    setLast(null);
    setUnsaved(false);
    setScanSweep(sweepDeg);
    await send(`x ${sweepMicrosteps(sweepDeg)}`);
    await send(`y ${yRow}`);
    await send("s");
  };

  const save = () => {
    const csv = toCsv(readings, tiltSpan, scanSweep);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `scan-${new Date().toISOString().replaceAll(":", "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setUnsaved(false);
  };

  return (
    <main className="flex min-h-screen flex-col gap-3 bg-zinc-950 p-4 text-zinc-200 md:h-screen">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold text-zinc-50">IR Scanner</h1>
        {phase === "disconnected" || phase === "connecting" ? (
          <button
            type="button"
            className={primaryButton}
            disabled={!serialAvailable || phase === "connecting"}
            onClick={() => connect()}
          >
            {phase === "connecting" ? "Connecting..." : "Connect"}
          </button>
        ) : (
          <button type="button" className={button} disabled={scanning} onClick={newScan}>
            New scan
          </button>
        )}
        <button type="button" className={button} disabled={phase !== "ready"} onClick={() => send("t")}>
          Test reading
        </button>
        {scanning ? (
          <button type="button" className={primaryButton} onClick={() => send("q")}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className={primaryButton}
            disabled={phase !== "ready" || Boolean(settingsProblem)}
            onClick={start}
          >
            Start
          </button>
        )}
        <button
          type="button"
          className={button}
          disabled={readings.length === 0 || scanning}
          onClick={save}
        >
          Save CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Setting label="X sweep per row" unit="°" value={sweepDeg} onChange={setSweepDeg} disabled={scanning} />
        <Setting label="Y per row" unit="microsteps" value={yRow} onChange={setYRow} disabled={scanning} />
        <Setting label="Tilt across full Y travel" unit="°" value={tiltSpan} onChange={setTiltSpan} />
        <span className="text-sm text-zinc-400">
          {size
            ? `${size.rows} rows × ${size.pointsPerRow} points, about ${size.minutes} min`
            : settingsProblem}
        </span>
      </div>

      {!serialAvailable && (
        <p className="text-sm text-amber-300">Connecting needs Chrome or Edge.</p>
      )}
      <p role="status" className="min-h-5 text-sm text-amber-200">
        {message}
      </p>
      <p className="text-sm tabular-nums text-zinc-400">
        {row ? `Row ${row.row}/${row.rows} · ` : ""}
        {points.length} points from {readings.length} readings
        {last ? ` · last reading ${describe(last)}` : ""}
        {readings.length > 0 && Number.isNaN(tiltSpan) ? " · set the tilt angle to see the points" : ""}
      </p>

      <div className="min-h-[60vh] flex-1">
        <PointCloud points={points} />
      </div>
    </main>
  );
}
