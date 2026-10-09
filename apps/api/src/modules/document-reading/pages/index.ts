import { INTAKE_LIMITS, type IntakeRefusalCode } from "@silvicom/shared";
import { toCanonicalPage, type CanonicalPage } from "./canonical.js";
import { decodeImage } from "./image.js";
import { normalisePdf } from "./pdf.js";
import { FORMAT_MIMES, sniffFormat, type SourceFormat } from "./sniff.js";

/**
 * PAGES — the D-DR13 normalisation stage (DOCUMENT-READER-PLAN.md §2, Step 1.3).
 *
 * Whatever arrives — an iPhone HEIC, an MMS JPEG a carrier already recompressed, a CMYK scan, a
 * screenshot PNG with transparency, a WebP, a born-digital or scanned PDF — leaves here as canonical
 * pages, and nothing downstream (classifier, model, text-layer comparison, crops, review UI) knows
 * which format came in. A file the stage cannot turn into pages is refused with an
 * `IntakeRefusalCode` whose sentence names the limit; it is never passed through.
 */
export type { CanonicalPage, TextLayer, TextWord } from "./canonical.js";
export { WORKING_LONG_EDGE_PX, WORKING_MEDIA_TYPE } from "./canonical.js";
export { PDF_RENDER_DPI } from "./pdf.js";
export type { SourceFormat } from "./sniff.js";

/**
 * The normaliser's version — one of the read cache key's parts (§4.6), so a read is never served
 * from pages normalised by different rules. Bump it whenever the pixels or the text layer this stage
 * produces would change for the same input: a step added or reordered, an encoder setting, the
 * working size, the DPI, the word-boxing rule.
 *
 * A dependency upgrade (sharp, pdf.js, libheif) that moves bytes needs no bump to stay CORRECT —
 * the page hashes are also in the key, so a changed raster misses the cache by itself — but bump it
 * anyway when the change is deliberate, so the cache's history says why it turned over.
 *
 * 1.0.0 — 2026-10-09, Step 1.3: EXIF orient + strip, sRGB 8-bit, alpha on white; PNG original;
 *         1568 px lossless-WebP working copy; PDF at 300 DPI (≤ 6,000 px) via pdf.js + @napi-rs/canvas;
 *         text-layer words apportioned along pdf.js runs.
 */
export const NORMALISER_VERSION = "1.0.0";

export type NormaliseOutcome =
  | {
      ok: true;
      /** What the bytes are — the sniff's answer, never the declared mime's. */
      format: SourceFormat;
      /** Whether the sender's declared mime named the same format; recorded, never trusted. */
      declaredMimeMatches: boolean;
      pages: CanonicalPage[];
    }
  | { ok: false; code: IntakeRefusalCode };

/**
 * Turn a source's bytes into canonical pages, or say why not.
 *
 * `declaredMime` is what the channel claimed (the upload's `Content-Type`, the MMS part's type, the
 * Graph attachment's `contentType`). It does not choose the decoder — the magic bytes do — and is
 * only compared, so intake can record a mismatch without refusing a file it can read.
 */
export async function normaliseSource(bytes: Buffer, declaredMime: string): Promise<NormaliseOutcome> {
  // Size first: a 400 MB upload is refused before a single byte of it is parsed.
  if (bytes.byteLength > INTAKE_LIMITS.maxBytes) return { ok: false, code: "too_large" };
  const format = sniffFormat(bytes);
  if (format === null) return { ok: false, code: "unsupported_format" };
  const declaredMimeMatches = FORMAT_MIMES[format].includes(declaredMime.trim().toLowerCase());

  if (format === "pdf") {
    const pdf = await normalisePdf(bytes);
    return pdf.ok ? { ok: true, format, declaredMimeMatches, pages: pdf.pages } : pdf;
  }
  const image = await decodeImage(bytes, format);
  if (!image.ok) return image;
  // A photo has no text layer (D-DR3: only a born-digital PDF carries one) and no physical size.
  const page = await toCanonicalPage(image.raster, 1, null, null);
  return { ok: true, format, declaredMimeMatches, pages: [page] };
}
