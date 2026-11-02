import type { Sample } from "./convert";
import type { Pos } from "./sweep";

export interface Transport {
  // Sends one line; the transport adds the line ending.
  write(line: string): Promise<void>;
  // null means the connection closed.
  readLine(): Promise<string | null>;
  close(): Promise<void>;
}

export type ScannerErrorKind =
  | "limit"
  | "motorsOff"
  | "timeout"
  | "disconnected"
  | "reset"
  | "protocol";

const MESSAGES: Record<ScannerErrorKind, string> = {
  limit: "That move would pass the tilt limit, so it was refused.",
  motorsOff: "The motors are released. Enable them first.",
  timeout: "The Uno stopped replying.",
  disconnected: "The Uno disconnected.",
  reset: "The Uno reset unexpectedly.",
  protocol: "The Uno sent a reply that made no sense.",
};

export class ScannerError extends Error {
  constructor(public kind: ScannerErrorKind) {
    super(MESSAGES[kind]);
  }
}

const STEPS_PER_SECOND = 100;

export class Scanner {
  position = { pan: 0, tilt: 0 };
  private queue: Promise<unknown> = Promise.resolve();
  // Once set, replies can't be paired with commands, so every later call fails with it.
  private dead: ScannerError | null = null;
  private baseTimeoutMs: number;

  constructor(
    private transport: Transport,
    opts: { baseTimeoutMs?: number } = {},
  ) {
    this.baseTimeoutMs = opts.baseTimeoutMs ?? 2000;
  }

  waitReady(timeoutMs = 5000): Promise<void> {
    return this.enqueue(async () => {
      const deadline = Date.now() + timeoutMs;
      while ((await this.readReply(deadline - Date.now())) !== "ready");
    });
  }

  move(pan: number, tilt: number): Promise<void> {
    const moveMs = (Math.max(Math.abs(pan), Math.abs(tilt)) / STEPS_PER_SECOND) * 1000;
    return this.command(`M ${pan} ${tilt}`, moveMs, (reply) => {
      const m = /^ok (-?\d+) (-?\d+)$/.exec(reply);
      if (!m) throw this.die("protocol");
      this.position = { pan: Number(m[1]), tilt: Number(m[2]) };
    });
  }

  read(): Promise<number> {
    return this.command("R", 0, (reply) => {
      const m = /^d (\d+)$/.exec(reply);
      if (!m) throw this.die("protocol");
      return Number(m[1]);
    });
  }

  setLimits(min: number, max: number): Promise<void> {
    return this.simple(`L ${min} ${max}`);
  }

  setTiltDriver(driver: 0 | 1): Promise<void> {
    return this.simple(`A ${driver}`);
  }

  async setZero(): Promise<void> {
    await this.simple("Z");
    this.position = { pan: 0, tilt: 0 };
  }

  enable(): Promise<void> {
    return this.simple("E");
  }

  release(): Promise<void> {
    return this.simple("D");
  }

  private simple(line: string): Promise<void> {
    return this.command(line, 0, (reply) => {
      if (reply !== "ok") throw this.die("protocol");
    });
  }

  private command<T>(
    line: string,
    extraMs: number,
    parse: (reply: string) => T,
  ): Promise<T> {
    return this.enqueue(async () => {
      try {
        await this.transport.write(line);
      } catch {
        throw this.die("disconnected");
      }
      const reply = await this.readReply(this.baseTimeoutMs + extraMs);
      if (reply === "ready") throw this.die("reset");
      if (reply === "err limit") throw new ScannerError("limit");
      if (reply === "err off") throw new ScannerError("motorsOff");
      return parse(reply);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(() => {
      if (this.dead) throw this.dead;
      return task();
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private async readReply(timeoutMs: number): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), Math.max(timeoutMs, 0));
    });
    const line = await Promise.race([this.transport.readLine(), timedOut]);
    clearTimeout(timer);
    if (line === "timeout") throw this.die("timeout");
    if (line === null) throw this.die("disconnected");
    return line;
  }

  private die(kind: ScannerErrorKind): ScannerError {
    this.dead = new ScannerError(kind);
    return this.dead;
  }
}

export type ScanResult = {
  status: "done" | "stopped" | "failed";
  error?: ScannerError;
};

export async function runScan(
  s: Scanner,
  positions: Pos[],
  opts: { signal: AbortSignal; onSample: (x: Sample) => void },
): Promise<ScanResult> {
  const start = { ...s.position };
  const moveTo = (pan: number, tilt: number) =>
    s.move(pan - s.position.pan, tilt - s.position.tilt);

  let error: ScannerError | undefined;
  try {
    for (const pos of positions) {
      if (opts.signal.aborted) break;
      await moveTo(start.pan + pos.pan, start.tilt + pos.tilt);
      const raw = await s.read();
      opts.onSample({ panSteps: pos.pan, tiltSteps: pos.tilt, raw });
    }
  } catch (e) {
    if (!(e instanceof ScannerError)) throw e;
    error = e;
  }

  if (error && error.kind !== "limit") return { status: "failed", error };
  try {
    await moveTo(start.pan, start.tilt);
  } catch (e) {
    if (!(e instanceof ScannerError)) throw e;
    return { status: "failed", error: error ?? e };
  }
  if (error) return { status: "failed", error };
  return { status: opts.signal.aborted ? "stopped" : "done" };
}
