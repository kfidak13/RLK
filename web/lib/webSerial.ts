import type { ByteLink } from "./stk500";

export interface Transport {
  port: SerialPort;
  // Sends one line; the transport adds the line ending.
  write(line: string): Promise<void>;
  // null means the connection closed.
  readLine(): Promise<string | null>;
  close(): Promise<void>;
}

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
// Pass a port to reopen it without asking the user to pick one again.
export async function openWebSerial(existing?: SerialPort): Promise<Transport> {
  const port = existing ?? (await navigator.serial.requestPort());
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
    port,
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

// Raw bytes for uploading a sketch through the bootloader (see stk500.ts).
export async function openByteLink(port: SerialPort): Promise<ByteLink & { close(): Promise<void> }> {
  await port.open({ baudRate: BAUD_RATE });
  const reader = port.readable!.getReader();
  let received: number[] = [];
  // Wakes a read waiting for more bytes.
  let wake = () => {};

  void (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        received.push(...value);
        wake();
      }
    } catch {
      // The port closed or the cable was pulled; reads time out from here on.
    }
  })();

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  return {
    async reset() {
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await pause(100);
      await port.setSignals({ dataTerminalReady: true, requestToSend: true });
      await pause(50);
    },
    drain() {
      received = [];
    },
    async write(bytes) {
      const writer = port.writable!.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        writer.releaseLock();
      }
    },
    async read(count, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (received.length < count) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error("No reply from the Arduino.");
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, left);
        });
      }
      return Uint8Array.from(received.splice(0, count));
    },
    async close() {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      await port.close().catch(() => {});
    },
  };
}
