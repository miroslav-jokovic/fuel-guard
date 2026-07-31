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
export const IMAGE_NORMALIZER_VERSION = "1.0.0";

export interface NormalizeResult {
  normalized: Buffer;
  width: number;
  height: number;
  normalizerVersion: string;
}

/** Conservative normalization: EXIF auto-orient, illumination normalize (contrast stretch), gentle denoise. */
export async function normalizeImage(input: Buffer): Promise<NormalizeResult> {
  const pipeline = sharp(input, { failOn: "none" })
    .rotate() // EXIF auto-orient
    .normalise() // stretch luminance to full range (background/shadow evening) — not binarization
    .median(1); // gentle salt-and-pepper denoise; does NOT merge strokes like a blur/sharpen would
  const normalized = await pipeline.toBuffer();
  const meta = await sharp(normalized).metadata();
  return {
    normalized,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
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
