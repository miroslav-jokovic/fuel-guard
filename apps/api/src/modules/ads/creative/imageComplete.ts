import { inflateSync } from "node:zlib";

/**
 * Is an uploaded PNG, JPEG or WebP complete? A pure, deterministic check run BEFORE libvips decodes it
 * (`brandAssets.ts` `prepareAsset`). Null when the file is whole; otherwise why it is not.
 *
 * ── WHY LIBVIPS'S OWN REFUSAL IS NOT ENOUGH (measured 2026-11-06, the brandAssets flake) ───────────
 * `sharp(bytes, { failOn: "error" })` plus `stats()` refuses a cut-short PNG every time when it is the only
 * decode in the process (0 of 200 accepted). But libvips keeps its error state per PROCESS, and when OTHER
 * decodes are failing at the same moment the truncated file is accepted as a good image: 8 of 40 with other
 * cut-short PNGs alongside, 15 of 40 with non-images alongside (0 of 30 alongside decodes that succeed). That
 * was the CI flake on "refuses a file that starts like a PNG but is cut short" (vitest's worker threads share
 * one libvips), and it is a production bug: two bad uploads at once, or a Checker run beside one upload, could
 * store a broken picture as `ready`. So completeness is decided here, by reading the file's own structure,
 * and libvips only has to decode what is already known to be whole.
 *
 *   PNG  — every chunk inside the file with a correct CRC (PNG spec §5.3), IHDR first, IEND last and at the very
 *          end, at least one IDAT; and the joined IDAT data inflates (Node's zlib, not libvips) to exactly the
 *          bytes the IHDR's size and pixel format need (§7.2, one filter byte per row; Adam7 by its seven passes).
 *   JPEG — ends with the EOI marker FF D9 (trailing zero padding allowed).
 *   WebP — the RIFF header's size covers the file exactly (RIFF size + 8 = length, the pad byte included).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Channels per PNG colour type (§11.2.2). */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;

/** The inflated size a PNG of this size and pixel format must have: per pass, rows × (1 filter byte + row bytes). */
function rawSize(width: number, height: number, bitsPerPixel: number, interlaced: boolean): number {
  const rowBytes = (w: number) => Math.ceil((w * bitsPerPixel) / 8);
  if (!interlaced) return height * (1 + rowBytes(width));
  let total = 0;
  for (const [x0, y0, dx, dy] of ADAM7) {
    const w = Math.ceil((width - x0) / dx);
    const h = Math.ceil((height - y0) / dy);
    if (w > 0 && h > 0) total += h * (1 + rowBytes(w));
  }
  return total;
}

export function pngIncomplete(b: Buffer): string | null {
  let at = 8;
  let ihdr: Buffer | null = null;
  const idat: Buffer[] = [];
  let ended = false;
  while (at < b.length) {
    if (at + 12 > b.length) return "it is cut short";
    const len = b.readUInt32BE(at);
    const type = b.toString("latin1", at + 4, at + 8);
    if (at + 12 + len > b.length) return "it is cut short";
    const data = b.subarray(at + 8, at + 8 + len);
    if (crc32(b.subarray(at + 4, at + 8 + len)) !== b.readUInt32BE(at + 8 + len)) return `its ${type} chunk is damaged`;
    if (ihdr === null && type !== "IHDR") return "it does not start with its header";
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idat.push(data);
    at += 12 + len;
    if (type === "IEND") { ended = true; break; }
  }
  if (!ended) return "it is cut short";
  if (at !== b.length) return "it has data after its end";
  if (!ihdr || ihdr.length !== 13 || idat.length === 0) return "it holds no picture";
  const [width, height, depth, colour, interlace] = [ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ihdr[8]!, ihdr[9]!, ihdr[12]!];
  const channels = CHANNELS[colour];
  if (!channels || width === 0 || height === 0) return "its header is not a picture's";
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return "its picture data ends early";
  }
  return raw.length === rawSize(width, height, channels * depth, interlace === 1) ? null : "its picture data ends early";
}

export function jpegIncomplete(b: Buffer): string | null {
  let end = b.length;
  while (end > 2 && b[end - 1] === 0) end -= 1;
  return b[end - 2] === 0xff && b[end - 1] === 0xd9 ? null : "it is cut short";
}

export function webpIncomplete(b: Buffer): string | null {
  if (b.length < 12) return "it is cut short";
  const size = b.readUInt32LE(4) + 8;
  return size === b.length ? null : size > b.length ? "it is cut short" : "it has data after its end";
}

/** Why the file is not whole, or null. `format` is what the sniff said; other formats are not checked here. */
export function imageIncomplete(format: string, bytes: Buffer): string | null {
  if (format === "png") return pngIncomplete(bytes);
  if (format === "jpeg") return jpegIncomplete(bytes);
  if (format === "webp") return webpIncomplete(bytes);
  return null;
}
