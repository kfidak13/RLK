import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIntelHex } from "./intelHex";
import { type ByteLink, flash } from "./stk500";

// Built by `npm run firmware`; the publish workflow builds it before testing.
const SKETCH_HEX = new URL("../public/scanner.hex", import.meta.url);

const ATMEGA328P = [0x1e, 0x95, 0x0f];

// Answers like the Uno's Optiboot bootloader: one complete command per write.
class FakeOptiboot implements ByteLink {
  memory = new Uint8Array(32768).fill(0xff);
  inBootloader = false;
  left = false;
  syncAttempts = 0;
  private pending: number[] = [];
  private address = 0;

  constructor(
    private opts: { signature?: number[]; syncAfter?: number; corruptWrites?: boolean } = {},
  ) {}

  async reset() {
    this.inBootloader = true;
  }

  drain() {
    this.pending = [];
  }

  async write(bytes: Uint8Array) {
    const [cmd] = bytes;
    if (!this.inBootloader) return;
    const ok = (...data: number[]) => this.pending.push(0x14, ...data, 0x10);
    if (cmd === 0x30) {
      this.syncAttempts++;
      if (this.syncAttempts > (this.opts.syncAfter ?? 0)) ok();
    } else if (cmd === 0x50 || cmd === 0x51) {
      if (cmd === 0x51) this.left = true;
      ok();
    } else if (cmd === 0x75) {
      ok(...(this.opts.signature ?? ATMEGA328P));
    } else if (cmd === 0x55) {
      this.address = (bytes[1] | (bytes[2] << 8)) * 2;
      ok();
    } else if (cmd === 0x64) {
      const size = (bytes[1] << 8) | bytes[2];
      const data = bytes.slice(4, 4 + size);
      if (this.opts.corruptWrites) data[0] ^= 0xff;
      this.memory.set(data, this.address);
      ok();
    } else if (cmd === 0x74) {
      const size = (bytes[1] << 8) | bytes[2];
      ok(...this.memory.slice(this.address, this.address + size));
    }
  }

  async read(count: number) {
    if (this.pending.length < count) throw new Error("timeout");
    return Uint8Array.from(this.pending.splice(0, count));
  }
}

const image = Uint8Array.from({ length: 300 }, (_, i) => i % 256);

describe("flash", () => {
  it("writes the whole image and leaves the bootloader", async () => {
    const uno = new FakeOptiboot();
    const progress: number[] = [];
    await flash(uno, image, (p) => progress.push(p));
    expect([...uno.memory.slice(0, 300)]).toEqual([...image]);
    expect(uno.memory[300]).toBe(0xff);
    expect(uno.left).toBe(true);
    expect(progress.at(-1)).toBe(1);
  });

  it("keeps trying to sync while the bootloader starts up", async () => {
    const uno = new FakeOptiboot({ syncAfter: 3 });
    await flash(uno, image, () => {});
    expect(uno.memory[299]).toBe(299 % 256);
  });

  it("explains when the bootloader never answers", async () => {
    const uno = new FakeOptiboot({ syncAfter: 1000 });
    await expect(flash(uno, image, () => {})).rejects.toThrow(/bootloader/);
  });

  it("refuses a board that isn't an Uno", async () => {
    const uno = new FakeOptiboot({ signature: [0x1e, 0x98, 0x01] });
    await expect(flash(uno, image, () => {})).rejects.toThrow(/Uno/);
    expect(uno.memory[0]).toBe(0xff);
  });

  it("catches a write that doesn't read back the same", async () => {
    const uno = new FakeOptiboot({ corruptWrites: true });
    await expect(flash(uno, image, () => {})).rejects.toThrow(/check/);
  });

  it.skipIf(!existsSync(SKETCH_HEX))("uploads the real compiled scanner sketch", async () => {
    const sketch = parseIntelHex(readFileSync(SKETCH_HEX, "utf8"));
    const uno = new FakeOptiboot();
    await flash(uno, sketch, () => {});
    expect([...uno.memory.slice(0, sketch.length)]).toEqual([...sketch]);
  });

  it("refuses an image too big for the Uno", async () => {
    const uno = new FakeOptiboot();
    await expect(flash(uno, new Uint8Array(32257), () => {})).rejects.toThrow(/too big/);
  });
});
