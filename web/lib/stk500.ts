// Uploads a sketch to an Arduino Uno through its Optiboot bootloader, using the
// same STK500 commands as the Arduino IDE (avrdude's "arduino" programmer).

export interface ByteLink {
  // Restarts the board so its bootloader listens for a few hundred milliseconds.
  reset(): Promise<void>;
  // Throws away anything received so far.
  drain(): void;
  write(bytes: Uint8Array): Promise<void>;
  // Resolves with exactly `count` bytes, or rejects after `timeoutMs`.
  read(count: number, timeoutMs: number): Promise<Uint8Array>;
}

const EOP = 0x20;
const INSYNC = 0x14;
const OK = 0x10;
const GET_SYNC = 0x30;
const ENTER_PROGMODE = 0x50;
const LEAVE_PROGMODE = 0x51;
const LOAD_ADDRESS = 0x55;
const PROG_PAGE = 0x64;
const READ_PAGE = 0x74;
const READ_SIGN = 0x75;
const FLASH = 0x46; // 'F'

const ATMEGA328P = [0x1e, 0x95, 0x0f];
const PAGE_SIZE = 128;
// 32 KB of flash, less the 512 bytes Optiboot keeps for itself.
const MAX_SKETCH_BYTES = 32768 - 512;
const SYNC_ATTEMPTS = 25;
const SYNC_TIMEOUT_MS = 200;
const REPLY_TIMEOUT_MS = 1000;

async function command(link: ByteLink, bytes: number[], replyLength = 0, timeoutMs = REPLY_TIMEOUT_MS) {
  await link.write(Uint8Array.from([...bytes, EOP]));
  const reply = await link.read(replyLength + 2, timeoutMs);
  if (reply[0] !== INSYNC || reply[reply.length - 1] !== OK)
    throw new Error("The Arduino's bootloader gave an unexpected reply.");
  return reply.slice(1, -1);
}

async function sync(link: ByteLink) {
  await link.reset();
  for (let i = 0; i < SYNC_ATTEMPTS; i++) {
    link.drain();
    try {
      await command(link, [GET_SYNC], 0, SYNC_TIMEOUT_MS);
      return;
    } catch {
      // The bootloader takes a moment to start after the reset.
    }
  }
  throw new Error(
    "Couldn't reach the Arduino's bootloader. Close the Arduino IDE's Serial Monitor, check the USB cable, and try again.",
  );
}

const loadAddress = (link: ByteLink, byteAddress: number) => {
  const word = byteAddress / 2;
  return command(link, [LOAD_ADDRESS, word & 0xff, word >> 8]);
};

export async function flash(
  link: ByteLink,
  image: Uint8Array,
  onProgress: (fraction: number) => void,
): Promise<void> {
  if (image.length > MAX_SKETCH_BYTES) throw new Error("The sketch is too big for an Arduino Uno.");

  const pages: { address: number; data: Uint8Array }[] = [];
  for (let address = 0; address < image.length; address += PAGE_SIZE) {
    const data = new Uint8Array(PAGE_SIZE).fill(0xff);
    data.set(image.slice(address, address + PAGE_SIZE));
    pages.push({ address, data });
  }

  await sync(link);
  await command(link, [ENTER_PROGMODE]);
  const signature = await command(link, [READ_SIGN], 3);
  if (signature.some((b, i) => b !== ATMEGA328P[i])) {
    await command(link, [LEAVE_PROGMODE]);
    throw new Error("This board isn't an Arduino Uno, so nothing was uploaded.");
  }

  // Writing is the first 80% of the progress bar, checking the rest.
  for (const [i, page] of pages.entries()) {
    await loadAddress(link, page.address);
    await command(link, [PROG_PAGE, 0, PAGE_SIZE, FLASH, ...page.data]);
    onProgress(((i + 1) / pages.length) * 0.8);
  }
  for (const [i, page] of pages.entries()) {
    await loadAddress(link, page.address);
    const stored = await command(link, [READ_PAGE, 0, PAGE_SIZE, FLASH], PAGE_SIZE);
    if (stored.some((b, j) => b !== page.data[j]))
      throw new Error("The upload didn't check out: the Arduino's memory doesn't match. Try again.");
    onProgress(0.8 + ((i + 1) / pages.length) * 0.2);
  }

  await command(link, [LEAVE_PROGMODE]);
  onProgress(1);
}
