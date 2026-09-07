/**
 * A minimal 8-bit truecolour PNG codec — the fixture corpus's only I/O (SCANNER-UPGRADE-PLAN.md,
 * Step 0.3).
 *
 * ── WHY THIS LIVES IN `fixtures/` AND NOT IN `src/` ───────────────────────────────────────────
 * `packages/capture-engine/src/contracts.ts` states the rule this package is built on: the library
 * "imports NOTHING platform-specific (no React Native, no Node, no crypto) so it typechecks and
 * unit-tests anywhere". This file imports `node:zlib`. It is therefore tooling that stands beside
 * the library, not part of it — the generator uses it to write the corpus, and the tests use it to
 * read the corpus back. Nothing in `src/` may import it, and nothing in it may import `src/`.
 *
 * ── WHY WE WRITE OUR OWN INSTEAD OF TAKING A DEPENDENCY ───────────────────────────────────────
 * The corpus exists to hold three independent implementations of one metric definition to the same
 * numbers. A fixture whose pixels depend on a third-party encoder's version is a fixture that can
 * change underneath that comparison without anybody editing it. Sixty lines of PNG we control
 * removes an entire class of "the numbers moved and nobody touched the code".
 *
 * Deliberately narrow: colour type 2 (truecolour RGB), bit depth 8, filter type 0 on every scanline,
 * no interlacing, no ancillary chunks. That is exactly what `generate.mjs` writes, so the decoder
 * refuses anything else loudly rather than half-reading a PNG this corpus could not have produced.
 */
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Standard PNG CRC-32 (ISO 3309), table built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Encode an RGB pixel buffer (`width * height * 3` bytes) as a PNG.
 *
 * Filter type 0 (None) on every scanline, always. A real encoder picks a filter per row to compress
 * better; picking none makes the byte layout a pure function of the pixels, which is what lets the
 * manifest's pixel digest and the file on disk be reasoned about together.
 */
export function encodePng(rgb, width, height) {
  if (rgb.length !== width * height * 3) {
    throw new Error(`encodePng: expected ${width * height * 3} bytes, received ${rgb.length}`);
  }
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: None
    rgb.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive (we always choose None)
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Decode a PNG this module wrote. Returns `{ width, height, rgb }`.
 *
 * Every unsupported feature throws by name. The corpus is only ever read back to compare pixels
 * against a digest, so a decoder that quietly mishandled an unexpected colour type would report a
 * mismatch and send the reader hunting through the metric code for a bug that was here.
 */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("decodePng: not a PNG");

  let offset = 8;
  let header = null;
  const idatParts = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    const declared = buf.readUInt32BE(offset + 8 + length);
    const actual = crc32(buf.subarray(offset + 4, offset + 8 + length));
    if (declared !== actual) throw new Error(`decodePng: CRC mismatch in ${type} chunk`);

    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colourType: data[9],
        interlace: data[12],
      };
      if (header.bitDepth !== 8) throw new Error(`decodePng: bit depth ${header.bitDepth} unsupported`);
      if (header.colourType !== 2) throw new Error(`decodePng: colour type ${header.colourType} unsupported`);
      if (header.interlace !== 0) throw new Error("decodePng: interlaced PNGs unsupported");
    } else if (type === "IDAT") {
      idatParts.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (!header) throw new Error("decodePng: no IHDR chunk");
  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = 1 + width * 3;
  if (raw.length !== height * stride) {
    throw new Error(`decodePng: expected ${height * stride} raw bytes, received ${raw.length}`);
  }

  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    if (filter !== 0) throw new Error(`decodePng: filter type ${filter} on row ${y} unsupported`);
    raw.copy(rgb, y * width * 3, y * stride + 1, (y + 1) * stride);
  }
  return { width, height, rgb };
}
