import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Bbox } from "@silvicom/shared";

/**
 * The D-DR13 canonical page — the one shape every reader downstream sees, whatever arrived.
 *
 * Built from DECODED pixels only: by the time a page reaches `toCanonicalPage` it is a bare 8-bit
 * sRGB RGB raster, already upright and flattened on white. So no EXIF block, ICC profile, XMP packet
 * or capture timestamp can survive into either copy — sharp writes none unless asked, and nothing
 * here asks — and two sources that decode to the same pixels give the same page bytes and hash.
 */

/** One word of a born-digital PDF's own text, boxed as fractions of the page (`bboxSchema`). */
export interface TextWord {
  text: string;
  bbox: Bbox;
}

/** A page's text layer (D-DR3). Null on the page, not an empty list, when the page carries none. */
export interface TextLayer {
  words: TextWord[];
}

export interface CanonicalPage {
  /** 1-based, in the source's own order. */
  page: number;
  /**
   * The lossless ORIGINAL (PNG): every pixel the decoder produced, at full resolution. Its sha256 is
   * the page hash in the read cache key (§4.6) and the cross-channel dedupe key (D-DR12).
   */
  original: { png: Buffer; sha256: string; width: number; height: number };
  /** The copy the readers use — long edge ≤ `WORKING_LONG_EDGE_PX`, never enlarged. */
  working: { bytes: Buffer; mediaType: typeof WORKING_MEDIA_TYPE; width: number; height: number };
  textLayer: TextLayer | null;
  /** The raster resolution a PDF page was rendered at; null for a photo, which has no physical size. */
  dpi: number | null;
}

/**
 * The working copy's long edge: the size Anthropic's vision input resizes to anyway (the hazmat
 * extractor's `NORMALIZED_LONG_EDGE_PX` and its §12.3 measurement). Sending more buys request bytes,
 * not characters. Restated rather than imported because `lint:boundaries` forbids reaching into the
 * hazmat module, and the two are not one fact: the hazmat value can only move with the hazmat run
 * cache, this one only with `NORMALISER_VERSION`.
 */
export const WORKING_LONG_EDGE_PX = 1568;

/**
 * WebP LOSSLESS, chosen over the two formats the house already uses for model input:
 * - not lossy WebP q80 (the hazmat extractor's choice) — at 1568 px a BOL's 7-pt type is 8–10 px
 *   tall, and a lossy encoder spends its error exactly on those thin strokes; the working copy is
 *   what the model, the region crops (Phase 5) and the reviewer all read, so a second generation
 *   loss there is a character risk this stage exists to remove;
 * - not PNG — same pixels, but larger (Google's published figure for lossless WebP is 26% smaller
 *   than PNG), and the per-image request cap (5 MB) is the limit a noisy night photo meets first.
 * WebP is one of the four formats the vision API accepts, and libwebp's lossless encoder is
 * deterministic for fixed settings, which the cache key needs.
 */
export const WORKING_MEDIA_TYPE = "image/webp" as const;

/** Fixed encoder settings — part of the byte-identical promise, so changing one bumps the version. */
const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const;
const WEBP_OPTIONS = { lossless: true, effort: 4 } as const;

export interface RgbRaster {
  /** Packed 8-bit RGB, row-major, `width * height * 3` bytes. */
  data: Buffer;
  width: number;
  height: number;
}

function rasterInput(raster: RgbRaster) {
  return sharp(raster.data, { raw: { width: raster.width, height: raster.height, channels: 3 } });
}

/** Encode a decoded, upright, flattened sRGB raster as its canonical page. */
export async function toCanonicalPage(
  raster: RgbRaster,
  page: number,
  textLayer: TextLayer | null,
  dpi: number | null,
): Promise<CanonicalPage> {
  const png = await rasterInput(raster).png(PNG_OPTIONS).toBuffer();
  const { data: bytes, info } = await rasterInput(raster)
    .resize(WORKING_LONG_EDGE_PX, WORKING_LONG_EDGE_PX, { fit: "inside", withoutEnlargement: true })
    .webp(WEBP_OPTIONS)
    .toBuffer({ resolveWithObject: true });
  return {
    page,
    original: {
      png,
      sha256: createHash("sha256").update(png).digest("hex"),
      width: raster.width,
      height: raster.height,
    },
    working: { bytes, mediaType: WORKING_MEDIA_TYPE, width: info.width, height: info.height },
    textLayer,
    dpi,
  };
}
