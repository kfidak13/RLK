// Reads the .hex file arduino-cli produces into a flat image of the Uno's flash.
export function parseIntelHex(text: string): Uint8Array {
  const chunks: { address: number; data: number[] }[] = [];
  let base = 0;
  let ended = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (!/^:([0-9A-Fa-f]{2})+$/.test(line)) throw new Error("This isn't a valid sketch file.");
    const bytes = line.slice(1).match(/../g)!.map((b) => parseInt(b, 16));
    if (bytes.reduce((sum, b) => sum + b, 0) % 256 !== 0)
      throw new Error("The sketch file is damaged (bad checksum).");
    const [length, high, low, type] = bytes;
    const data = bytes.slice(4, 4 + length);
    if (type === 0x00) chunks.push({ address: base + ((high << 8) | low), data });
    else if (type === 0x01) {
      ended = true;
      break;
    } else if (type === 0x02) base = ((data[0] << 8) | data[1]) * 16;
    else if (type === 0x04) base = ((data[0] << 8) | data[1]) * 65536;
  }

  if (!ended) throw new Error("The sketch file is cut short (no end record).");
  const size = Math.max(0, ...chunks.map((c) => c.address + c.data.length));
  const image = new Uint8Array(size).fill(0xff);
  for (const c of chunks) image.set(c.data, c.address);
  return image;
}
