import sharp from "sharp";

/**
 * Image normalization + usability gate (plan H6 steps 0–1). Deterministic, no AI. Normalization raises
 * capture YIELD and read precision; it is NEVER trusted as correctness — the decisive safety is the
 * dual-pass agreement + deterministic cross-validation. So normalization is CONSERVATIVE (legibility only,
 * it must never alter a character's shape): auto-orient + illumination-normalize + a gentle denoise, with
 * NO binarization, NO super-resolution / inpainting, and NO sharpening that could merge or invent strokes.
 * The ruleset is versioned (`IMAGE_NORMALIZER_VERSION`) and stored on every run so a verdict is reproducible.
 *
 * Note (verified 2026-07-31): quadrilateral perspective de-warp / auto-crop (the one step that needs a full
 * CV lib) is a bounded follow-up — it improves yield, not correctness (a wrong read still cannot pass). The
 * usability gate below still fails an unusable page, so the safety story holds without it.
 */
/** v2.0.0 — D11+D12 (§12.3 stage 2): explicit resize to the model's 1568 px working size and an
 *  explicit WebP encode. v1.0.0 had no `.resize()` (a 3-page phone-resolution BOL exceeded the
 *  10 MB API request cap → `extraction_failed`, size-dependent so it passed testing) and no
 *  `.toFormat()` (sharp preserves the input format, so the hardcoded "image/png" media type lied
 *  to the vision API for every JPEG/WebP upload). The version bump is deliberate: normalized bytes
 *  change, so run cache hashes change — a verdict must never be served from a differently-
 *  normalized image. */
export const IMAGE_NORMALIZER_VERSION = "2.0.0";

/** The model's working long edge (Anthropic vision downsizes to ~1568 px anyway — §12.3); resizing
 *  here buys request-size reliability and bandwidth, not accuracy loss. */
export const NORMALIZED_LONG_EDGE_PX = 1568;

export interface NormalizeResult {
  normalized: Buffer;
  width: number;
  height: number;
  /** Actual encoded format of `normalized`, verified against sharp metadata — never assumed (D11). */
  mediaType: "image/webp";
  normalizerVersion: string;
}

/** Conservative normalization: EXIF auto-orient, illumination normalize (contrast stretch), gentle
 *  denoise, then bound to 1568 px and encode WebP q80 (§12.3). Legibility-only: no binarization,
 *  no sharpening, no upscaling (`withoutEnlargement` — upscaling invents no information). */
export async function normalizeImage(input: Buffer): Promise<NormalizeResult> {
  const pipeline = sharp(input, { failOn: "none" })
    .rotate() // EXIF auto-orient
    .normalise() // stretch luminance to full range (background/shadow evening) — not binarization
    .median(1) // gentle salt-and-pepper denoise; does NOT merge strokes like a blur/sharpen would
    .resize({
      width: NORMALIZED_LONG_EDGE_PX,
      height: NORMALIZED_LONG_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 });
  const normalized = await pipeline.toBuffer();
  const meta = await sharp(normalized).metadata();
  if (meta.format !== "webp") {
    // Defensive: if sharp ever emits something else, fail loudly rather than mislabel (D11's exact bug).
    throw new Error(`normalizeImage: expected webp output, got ${meta.format ?? "unknown"}`);
  }
  return {
    normalized,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    mediaType: "image/webp",
    normalizerVersion: IMAGE_NORMALIZER_VERSION,
  };
}

export interface UsabilityThresholds {
  minLongEdgePx: number;
  minBlurVariance: number; // variance-of-Laplacian floor — below this the page is too blurry to read
  maxGlareFraction: number; // fraction of near-white specular pixels allowed
}
/** Defaults; the blur/glare floors are corpus-tuned in H11 — conservative starting points here. */
export const DEFAULT_USABILITY: UsabilityThresholds = {
  minLongEdgePx: 1200,
  minBlurVariance: 100,
  maxGlareFraction: 0.06,
};

export interface UsabilityResult {
  usable: boolean;
  reasons: string[]; // e.g. "resolution_too_low", "too_blurry", "glare"
  metrics: { longEdgePx: number; blurVariance: number; glareFraction: number };
}

/**
 * Server-side quality checks BEFORE any model call — a bad page is rejected for recapture, never sent to
 * the model. Blur = variance of a Laplacian convolution over the luminance channel; glare = fraction of
 * near-white (specular) pixels; plus a hard resolution floor.
 */
export async function usabilityGate(
  input: Buffer,
  thresholds: UsabilityThresholds = DEFAULT_USABILITY,
): Promise<UsabilityResult> {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const longEdgePx = Math.max(meta.width ?? 0, meta.height ?? 0);

  // Luminance buffer for the pixel stats.
  const grey = sharp(input, { failOn: "none" }).greyscale();
  const { data: lum } = await grey.clone().raw().toBuffer({ resolveWithObject: true });
  let nearWhite = 0;
  for (let i = 0; i < lum.length; i++) if (lum[i]! >= 250) nearWhite++;
  const glareFraction = lum.length > 0 ? nearWhite / lum.length : 0;

  // Variance of the Laplacian response (focus measure).
  const { data: lap } = await grey
    .clone()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < lap.length; i++) sum += lap[i]!;
  const mean = lap.length > 0 ? sum / lap.length : 0;
  let varSum = 0;
  for (let i = 0; i < lap.length; i++) varSum += (lap[i]! - mean) ** 2;
  const blurVariance = lap.length > 0 ? varSum / lap.length : 0;

  const reasons: string[] = [];
  if (longEdgePx < thresholds.minLongEdgePx) reasons.push("resolution_too_low");
  if (blurVariance < thresholds.minBlurVariance) reasons.push("too_blurry");
  if (glareFraction > thresholds.maxGlareFraction) reasons.push("glare");

  return { usable: reasons.length === 0, reasons, metrics: { longEdgePx, blurVariance, glareFraction } };
}
