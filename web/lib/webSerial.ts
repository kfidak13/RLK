import type { Transport } from "./scanner";

const BAUD_RATE = 115200;

export function isWebSerialAvailable(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export function createLineSplitter(): (chunk: string) => string[] {
  let partial = "";
  return (chunk) => {
    const parts = (partial + chunk).split("\n");
    partial = parts.pop()!;
    return parts.map((line) => line.replace(/\r$/, "")).filter((line) => line !== "");
  };
}

// Opening the port resets the Uno, so the caller should wait for "ready".
export async function openWebSerial(): Promise<Transport> {
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: BAUD_RATE });
  const reader = port.readable!.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const split = createLineSplitter();

  const lines: string[] = [];
  let waiter: ((line: string | null) => void) | null = null;
  let closed = false;

  const finish = () => {
    closed = true;
    waiter?.(null);
    waiter = null;
  };

  const deliver = (line: string) => {
    if (waiter) {
      waiter(line);
      waiter = null;
    } else {
      lines.push(line);
    }
  };

  void (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        split(decoder.decode(value, { stream: true })).forEach(deliver);
      }
    } catch {
      // A read error means the port is gone; finish() reports it as closed.
    }
    finish();
  })();

  return {
    async write(line) {
      const writer = port.writable!.getWriter();
      try {
        await writer.write(encoder.encode(`${line}\n`));
      } finally {
        writer.releaseLock();
      }
    },
    readLine() {
      if (lines.length) return Promise.resolve(lines.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => (waiter = resolve));
    },
    async close() {
      // The reader must let go before the port can close. Each step can fail on
      // its own: cancel rejects after a read error, and close if the cable was pulled.
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      await port.close().catch(() => {});
      finish();
    },
  };
}
