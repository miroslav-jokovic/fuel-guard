/**
 * What a file IS, read from its first bytes — never from the mime type its sender declared.
 *
 * The declared type is a claim made by a browser, a phone carrier's MMS gateway or an email client,
 * and every one of them gets it wrong in the field: an iPhone shares a HEIC as `image/jpeg` once a
 * Shortcut has touched it, Telnyx forwards whatever the handset said, and Outlook labels any PDF it
 * cannot classify `application/octet-stream`. Choosing a decoder from that claim would route bytes
 * to the wrong decoder and report `decode_failed` for a file we can read, so the claim is recorded
 * beside the answer (D-DR13: the source's untouched bytes and mime are kept) and the bytes decide.
 */
export const SOURCE_FORMATS = ["jpeg", "png", "webp", "heic", "pdf"] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

/** The mime each format is canonically declared as — for the "did the sender's claim match" flag. */
export const FORMAT_MIMES: Record<SourceFormat, readonly string[]> = {
  jpeg: ["image/jpeg", "image/jpg", "image/pjpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  heic: ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"],
  pdf: ["application/pdf"],
};

/**
 * The ISO-BMFF brands that mean "a HEIF still image coded with HEVC" — what an iPhone writes
 * (`heic`, with `mif1` as a compatible brand). `mif1`/`msf1` alone are the generic HEIF brands and
 * are accepted too: the decoder, not this sniff, then decides whether the payload is one it can
 * read, and a payload it cannot read is `decode_failed`, never passed through.
 */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/**
 * How far into the file `%PDF-` may start. The PDF spec puts the header at byte 0, but Acrobat and
 * pdf.js both accept a header within the first 1,024 bytes, and mail gateways that prepend a stray
 * line produce exactly that. Reading what the renderer reads keeps the sniff from refusing a file
 * the renderer would open.
 */
const PDF_HEADER_WINDOW = 1024;

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== "ftyp") return false;
  const boxSize = (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
  const end = Math.min(bytes.length, Math.max(16, boxSize));
  // Major brand at 8, minor version at 12, then compatible brands to the end of the ftyp box.
  if (HEIF_BRANDS.has(ascii(bytes, 8, 4))) return true;
  for (let at = 16; at + 4 <= end; at += 4) {
    if (HEIF_BRANDS.has(ascii(bytes, at, 4))) return true;
  }
  return false;
}

function isPdf(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, Math.min(bytes.length, PDF_HEADER_WINDOW)).includes("%PDF-");
}

/** The format the bytes are, or null for anything the reader does not accept (GIF, TIFF, text…). */
export function sniffFormat(bytes: Uint8Array): SourceFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  if (isHeif(bytes)) return "heic";
  if (isPdf(bytes)) return "pdf";
  return null;
}
