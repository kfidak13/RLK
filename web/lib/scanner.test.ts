import { describe, expect, it } from "vitest";
import type { Sample } from "./convert";
import { runScan, Scanner, type ScannerErrorKind, type Transport } from "./scanner";
import { sweepPositions } from "./sweep";

const SILENT = Symbol("silent");
const CLOSE = Symbol("close");
type Reply = string | typeof SILENT | typeof CLOSE | undefined;

// Speaks the firmware protocol. `intercept` overrides the reply to one command.
class FakeUno implements Transport {
  sent: string[] = [];
  pos = { pan: 0, tilt: 0 };
  limits = { min: -20, max: 20 };
  outstanding = 0;
  maxOutstanding = 0;
  private lines: string[] = [];
  private waiter: ((line: string | null) => void) | null = null;
  private closed = false;

  constructor(private intercept?: (line: string, n: number) => Reply) {}

  async write(line: string) {
    const n = this.sent.push(line) - 1;
    this.outstanding++;
    this.maxOutstanding = Math.max(this.maxOutstanding, this.outstanding);
    const reply = this.intercept?.(line, n) ?? this.respond(line);
    if (reply === SILENT) return;
    if (reply === CLOSE) return void (await this.close());
    setTimeout(() => {
      this.outstanding--;
      this.push(reply);
    }, 1);
  }

  readLine(): Promise<string | null> {
    if (this.lines.length) return Promise.resolve(this.lines.shift()!);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => (this.waiter = resolve));
  }

  async close() {
    this.closed = true;
    this.waiter?.(null);
    this.waiter = null;
  }

  push(line: string) {
    if (this.waiter) {
      this.waiter(line);
      this.waiter = null;
    } else this.lines.push(line);
  }

  private respond(line: string): string {
    const [cmd, a, b] = line.split(" ");
    if (cmd === "M") {
      const tilt = this.pos.tilt + Number(b);
      if (tilt < this.limits.min || tilt > this.limits.max) return "err limit";
      this.pos = { pan: this.pos.pan + Number(a), tilt };
      return `ok ${this.pos.pan} ${this.pos.tilt}`;
    }
    if (cmd === "R") return "d 300";
    return "ok";
  }
}

const make = (intercept?: (line: string, n: number) => Reply) => {
  const uno = new FakeUno(intercept);
  return { uno, s: new Scanner(uno, { baseTimeoutMs: 20 }) };
};

const expectKind = (p: Promise<unknown>, kind: ScannerErrorKind) =>
  expect(p).rejects.toMatchObject({ kind });

const grid2x2 = sweepPositions({
  panMin: 0,
  panMax: 1,
  panStep: 1,
  tiltMin: 0,
  tiltMax: 1,
  tiltStep: 1,
});

describe("Scanner", () => {
  it("ignores boot noise before ready", async () => {
    const { uno, s } = make();
    uno.push("garbage");
    uno.push("ready");
    await expect(s.waitReady(50)).resolves.toBeUndefined();
  });

  it("waitReady rejects with timeout if the Uno stays silent", async () => {
    const { s } = make();
    await expectKind(s.waitReady(10), "timeout");
  });

  it("move tracks position from the reply", async () => {
    const { s } = make();
    await s.move(3, -2);
    expect(s.position).toEqual({ pan: 3, tilt: -2 });
  });

  it("err limit rejects, keeps position, stays usable", async () => {
    const { s } = make();
    await expectKind(s.move(0, 21), "limit");
    expect(s.position).toEqual({ pan: 0, tilt: 0 });
    await s.move(1, 0);
    expect(s.position).toEqual({ pan: 1, tilt: 0 });
  });

  it("err off rejects with motorsOff and stays usable", async () => {
    const { s } = make((line, n) => (n === 0 ? "err off" : undefined));
    await expectKind(s.move(1, 0), "motorsOff");
    await s.move(1, 0);
    expect(s.position.pan).toBe(1);
  });

  it("read parses d <raw>", async () => {
    const { s } = make();
    await expect(s.read()).resolves.toBe(300);
  });

  it("sends the setup commands exactly", async () => {
    const { uno, s } = make();
    await s.setLimits(-5, 7);
    await s.setTiltDriver(1);
    await s.enable();
    await s.release();
    expect(uno.sent).toEqual(["L -5 7", "A 1", "E", "D"]);
  });

  it("setZero resets the position", async () => {
    const { s } = make();
    await s.move(4, 4);
    await s.setZero();
    expect(s.position).toEqual({ pan: 0, tilt: 0 });
  });

  it("runs rapid calls in order, one at a time", async () => {
    const { uno, s } = make();
    await Promise.all([1, 2, 3, 4, 5].map(() => s.move(1, 0)));
    expect(s.position.pan).toBe(5);
    expect(uno.maxOutstanding).toBe(1);
  });

  it("allows for a long move's duration in the timeout", async () => {
    const { uno, s } = make((line) => (line === "M 10 0" ? SILENT : undefined));
    setTimeout(() => uno.push("ok 10 0"), 60);
    await s.move(10, 0);
    expect(s.position.pan).toBe(10);
  });

  it("a late reply after a timeout is not paired with the next command", async () => {
    const { uno, s } = make(() => SILENT);
    await expectKind(s.move(1, 0), "timeout");
    uno.push("ok 1 0");
    await expectKind(s.move(1, 0), "timeout");
    expect(uno.sent).toHaveLength(1);
  });

  it("ready during a command means reset", async () => {
    const { uno, s } = make((_, n) => (n === 1 ? "ready" : undefined));
    await s.move(1, 0);
    await expectKind(s.move(1, 0), "reset");
    await expectKind(s.read(), "reset");
    expect(uno.sent).toHaveLength(2);
  });

  it("a closed transport rejects with disconnected", async () => {
    const { s } = make(() => CLOSE);
    await expectKind(s.move(1, 0), "disconnected");
  });

  it("a failed write rejects with disconnected", async () => {
    const uno = new FakeUno();
    uno.write = () => Promise.reject(new Error("port gone"));
    await expectKind(new Scanner(uno, { baseTimeoutMs: 20 }).read(), "disconnected");
  });

  it("an unexpected reply rejects with protocol", async () => {
    const { s } = make((line) => (line === "R" ? "ok" : undefined));
    await expectKind(s.read(), "protocol");
  });
});

describe("runScan", () => {
  const run = (s: Scanner, signal = new AbortController().signal) => {
    const samples: Sample[] = [];
    return {
      samples,
      result: runScan(s, grid2x2, { signal, onSample: (x) => samples.push(x) }),
    };
  };

  it("records raw samples relative to the scan start and returns to start", async () => {
    const { uno, s } = make();
    await s.move(5, 3);
    const { samples, result } = run(s);
    expect(await result).toEqual({ status: "done" });
    expect(samples).toEqual([
      { panSteps: 0, tiltSteps: 0, raw: 300 },
      { panSteps: 1, tiltSteps: 0, raw: 300 },
      { panSteps: 1, tiltSteps: 1, raw: 300 },
      { panSteps: 0, tiltSteps: 1, raw: 300 },
    ]);
    expect(s.position).toEqual({ pan: 5, tilt: 3 });
    expect(uno.pos).toEqual({ pan: 5, tilt: 3 });
  });

  it("stop keeps samples and returns to start", async () => {
    const { uno, s } = make();
    await s.move(2, 2);
    const controller = new AbortController();
    const samples: Sample[] = [];
    const result = await runScan(s, grid2x2, {
      signal: controller.signal,
      onSample: (x) => {
        samples.push(x);
        controller.abort();
      },
    });
    expect(result).toEqual({ status: "stopped" });
    expect(samples).toHaveLength(1);
    expect(uno.pos).toEqual({ pan: 2, tilt: 2 });
  });

  it("disconnect mid-scan keeps samples and sends no more commands", async () => {
    const { uno, s } = make((_, n) => (n === 2 ? CLOSE : undefined));
    const { samples, result } = run(s);
    const r = await result;
    expect(r.status).toBe("failed");
    expect(r.error?.kind).toBe("disconnected");
    expect(samples).toHaveLength(1);
    expect(uno.sent).toHaveLength(3);
  });

  it("reset mid-scan keeps samples and sends no more commands", async () => {
    const { uno, s } = make((_, n) => (n === 2 ? "ready" : undefined));
    const { samples, result } = run(s);
    const r = await result;
    expect(r.status).toBe("failed");
    expect(r.error?.kind).toBe("reset");
    expect(samples).toHaveLength(1);
    expect(uno.sent).toHaveLength(3);
  });

  it("limit mid-scan keeps samples and returns to start", async () => {
    const { uno, s } = make();
    uno.limits = { min: -20, max: 0 };
    const { samples, result } = run(s);
    const r = await result;
    expect(r.status).toBe("failed");
    expect(r.error?.kind).toBe("limit");
    expect(samples).toHaveLength(2);
    expect(uno.pos).toEqual({ pan: 0, tilt: 0 });
  });

  it("a failed return reports failed, not done", async () => {
    let moves = 0;
    const { s } = make((line) => {
      if (line.startsWith("M") && ++moves === 5) return SILENT;
      return undefined;
    });
    const { samples, result } = run(s);
    const r = await result;
    expect(r.status).toBe("failed");
    expect(r.error?.kind).toBe("timeout");
    expect(samples).toHaveLength(4);
  });
});
