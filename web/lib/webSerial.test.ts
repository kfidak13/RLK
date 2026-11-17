import { describe, expect, it } from "vitest";
import { createLineSplitter, openByteLink, openWebSerial } from "./webSerial";

describe("openByteLink", () => {
  const fakePort = () => {
    const chunks: Uint8Array[] = [];
    let deliver: ((r: { value?: Uint8Array; done: boolean }) => void) | null = null;
    const signals: object[] = [];
    const written: number[] = [];
    let closed = false;
    const port = {
      signals,
      written,
      get closed() {
        return closed;
      },
      send(bytes: number[]) {
        const chunk = Uint8Array.from(bytes);
        if (deliver) {
          deliver({ value: chunk, done: false });
          deliver = null;
        } else chunks.push(chunk);
      },
      open: async () => {},
      close: async () => {
        closed = true;
      },
      setSignals: async (s: object) => {
        signals.push(s);
      },
      readable: {
        getReader: () => ({
          read: () =>
            chunks.length
              ? Promise.resolve({ value: chunks.shift(), done: false })
              : new Promise((resolve) => (deliver = resolve)),
          cancel: async () => deliver?.({ done: true }),
          releaseLock: () => {},
        }),
      },
      writable: {
        getWriter: () => ({
          write: async (b: Uint8Array) => {
            written.push(...b);
          },
          releaseLock: () => {},
        }),
      },
    };
    return port;
  };

  it("resets the board by dropping and raising DTR", async () => {
    const port = fakePort();
    const link = await openByteLink(port as unknown as SerialPort);
    await link.reset();
    expect(port.signals).toEqual([
      { dataTerminalReady: false, requestToSend: false },
      { dataTerminalReady: true, requestToSend: true },
    ]);
    await link.close();
  });

  it("collects bytes across chunks until it has enough", async () => {
    const port = fakePort();
    const link = await openByteLink(port as unknown as SerialPort);
    const reply = link.read(3, 500);
    port.send([0x14]);
    port.send([0x10, 0x99]);
    await expect(reply).resolves.toEqual(Uint8Array.of(0x14, 0x10, 0x99));
    await link.close();
  });

  it("times out when too few bytes arrive", async () => {
    const port = fakePort();
    const link = await openByteLink(port as unknown as SerialPort);
    port.send([0x14]);
    await expect(link.read(2, 20)).rejects.toThrow();
    await link.close();
  });

  it("drain throws away bytes already received", async () => {
    const port = fakePort();
    const link = await openByteLink(port as unknown as SerialPort);
    port.send([0xaa]);
    await new Promise((r) => setTimeout(r, 0));
    link.drain();
    port.send([0x14]);
    await expect(link.read(1, 100)).resolves.toEqual(Uint8Array.of(0x14));
    await link.close();
  });

  it("writes bytes and closes the port", async () => {
    const port = fakePort();
    const link = await openByteLink(port as unknown as SerialPort);
    await link.write(Uint8Array.of(0x30, 0x20));
    await link.close();
    expect(port.written).toEqual([0x30, 0x20]);
    expect(port.closed).toBe(true);
  });
});

describe("openWebSerial", () => {
  it("still closes the port after a read error makes cancel fail", async () => {
    let portClosed = false;
    const port = {
      open: async () => {},
      close: async () => {
        portClosed = true;
      },
      readable: {
        getReader: () => ({
          read: () => Promise.reject(new Error("framing error")),
          cancel: () => Promise.reject(new TypeError("stream errored")),
          releaseLock: () => {},
        }),
      },
    };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { requestPort: async () => port },
    });
    const transport = await openWebSerial();
    await expect(transport.readLine()).resolves.toBeNull();
    await transport.close();
    expect(portClosed).toBe(true);
  });

  it("reopens a port it's given without asking for one", async () => {
    let opened = 0;
    const port = {
      open: async () => {
        opened++;
      },
      close: async () => {},
      readable: {
        getReader: () => ({
          read: () => new Promise(() => {}),
          cancel: async () => {},
          releaseLock: () => {},
        }),
      },
    };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        requestPort: async () => {
          throw new Error("should not ask for a port");
        },
      },
    });
    const transport = await openWebSerial(port as unknown as SerialPort);
    expect(opened).toBe(1);
    expect(transport.port).toBe(port);
    await transport.close();
  });
});

describe("createLineSplitter", () => {
  it("joins lines split across chunks", () => {
    const split = createLineSplitter();
    expect(split("rea")).toEqual([]);
    expect(split("dy\r\nok")).toEqual(["ready"]);
    expect(split("\r\n")).toEqual(["ok"]);
  });

  it("returns several lines from one chunk", () =>
    expect(createLineSplitter()("ok\r\nd 300\r\n")).toEqual(["ok", "d 300"]));

  it("handles a chunk boundary between \\r and \\n", () => {
    const split = createLineSplitter();
    expect(split("ok\r")).toEqual([]);
    expect(split("\n")).toEqual(["ok"]);
  });

  it("skips blank lines", () => expect(createLineSplitter()("\r\n\nok\n")).toEqual(["ok"]));
});
