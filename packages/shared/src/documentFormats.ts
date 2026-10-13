/**
 * What a file IS, read from its first bytes — never from the mime type or the file name its sender gave.
 *
 * The declared type is a claim made by a browser, a phone carrier's MMS gateway or an email client,
 * and every one of them gets it wrong in the field: an iPhone shares a HEIC as `image/jpeg` once a
 * Shortcut has touched it, Telnyx forwards whatever the handset said, Outlook labels any PDF it
 * cannot classify `application/octet-stream`, and a photo saved out of Google Voice arrives as
 * `.jfif` — a JPEG under a name the BOL picker did not list, so on 10/12/2026 the dispatcher could
 * not add the photos drivers actually send. Choosing a decoder, or refusing a file, from either claim
 * gets real files wrong; so the claim is recorded beside the answer (D-DR13: the source's untouched
 * bytes and mime are kept) and the bytes decide.
 *
 * Shared because the browser asks the same question before uploading: one sniff, so the picker can
 * never refuse a file the intake would read, or accept one it would refuse for its format.
 */
export const SOURCE_FORMATS = ["jpeg", "png", "webp", "heic", "avif", "tiff", "gif", "pdf"] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

/**
 * The mimes each format is declared as in the field; the first is the canonical one the browser
 * sends and intake stores. Every one is accepted as a declaration, because the declaration only
 * feeds the "did the sender's claim match" flag.
 */
export const FORMAT_MIMES = {
  jpeg: ["image/jpeg", "image/jpg", "image/pjpeg", "image/jfif"],
  png: ["image/png"],
  webp: ["image/webp"],
  heic: ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"],
  avif: ["image/avif"],
  tiff: ["image/tiff", "image/tif"],
  gif: ["image/gif"],
  pdf: ["application/pdf"],
} as const satisfies Record<SourceFormat, readonly [string, ...string[]]>;

/**
 * The extensions each format is saved under — what the file picker lists, so a desktop file dialog
 * does not grey out a `.jfif` or a scanner's `.tif`. The picker's list, not the decision: the sniff
 * above decides once the file is picked.
 */
export const FORMAT_EXTENSIONS: Record<SourceFormat, readonly string[]> = {
  jpeg: [".jpg", ".jpeg", ".jfif", ".jpe", ".pjpeg", ".pjp"],
  png: [".png"],
  webp: [".webp"],
  heic: [".heic", ".heif"],
  avif: [".avif"],
  tiff: [".tif", ".tiff"],
  gif: [".gif"],
  pdf: [".pdf"],
};

/** The formats by the names a dispatcher knows them by, for the sentences that list them. */
export const FORMAT_LABELS: Record<SourceFormat, string> = {
  jpeg: "JPEG (including JFIF)", png: "PNG", webp: "WebP", heic: "HEIC", avif: "AVIF", tiff: "TIFF", gif: "GIF", pdf: "PDF",
};

/** "JPEG (including JFIF), PNG, …, GIF and PDF" — the refusal and the picker's hint both say it, from this list. */
export const READABLE_FORMATS_TEXT = (() => {
  const labels = SOURCE_FORMATS.map((f) => FORMAT_LABELS[f]);
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
})();

/**
 * The `accept` list for a file input that takes exactly these mimes: each one, plus every extension its
 * format is saved under — so an upload that takes JPEG takes a Google Voice `.jfif` too, and a list typed
 * by hand (".jpg,.jpeg") cannot leave one out again. Mimes outside SOURCE_FORMATS pass through as given.
 */
export function acceptFor(mimes: readonly string[]): string {
  return mimes.flatMap((m) => {
    const format = SOURCE_FORMATS.find((f) => FORMAT_MIMES[f][0] === m);
    return format ? [m, ...FORMAT_EXTENSIONS[format]] : [m];
  }).join(",");
}

/** How many leading bytes `sniffFormat` needs to answer for every format — what the browser reads. */
export const SNIFF_BYTES = 4096;

/**
 * The ISO-BMFF brands that mean "a HEIF still image coded with HEVC" — what an iPhone writes
 * (`heic`, with `mif1` as a compatible brand). `mif1`/`msf1` alone are the generic HEIF brands and
 * are accepted too: the decoder, not this sniff, then decides whether the payload is one it can
 * read, and a payload it cannot read is `decode_failed`, never passed through.
 */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
/**
 * AVIF is the same container with an AV1 payload, and lists `mif1` among its compatible brands — so
 * it is looked for FIRST, or an AVIF would be sent to the HEVC decoder and refused as unreadable.
 */
const AVIF_BRANDS = new Set(["avif", "avis"]);

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

/** The ftyp box's brands — major at 8, then the compatible brands to the end of the box — or [] when there is no ftyp box. */
function ftypBrands(bytes: Uint8Array): string[] {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== "ftyp") return [];
  const boxSize = (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
  const end = Math.min(bytes.length, Math.max(16, boxSize));
  const brands = [ascii(bytes, 8, 4)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(bytes, at, 4));
  return brands;
}

function isPdf(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, Math.min(bytes.length, PDF_HEADER_WINDOW)).includes("%PDF-");
}

/** The format the bytes are, or null for anything the reader does not accept (Word, text, a zip…). */
export function sniffFormat(bytes: Uint8Array): SourceFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  // Little-endian `II*\0` or big-endian `MM\0*`: a scanner's or a fax gateway's TIFF.
  if (bytes.length >= 4 && (ascii(bytes, 0, 4) === "II*\0" || ascii(bytes, 0, 4) === "MM\0*")) return "tiff";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "gif";
  const brands = ftypBrands(bytes);
  if (brands.some((b) => AVIF_BRANDS.has(b))) return "avif";
  if (brands.some((b) => HEIF_BRANDS.has(b))) return "heic";
  if (isPdf(bytes)) return "pdf";
  return null;
}
