import { createHash } from "node:crypto";
import sharp from "sharp";
import { BUNDLED_DEFAULT_CONFIG, computeMetrics, type MeasuredMetrics } from "@silvicom/capture-engine";

/**
 * The analysis scale the metrics are computed at. Read from the capture engine's bundled config so the
 * server and the driver app cannot drift: it is the number that gives every other number its meaning
 * (the same image scored 4283.7 for blur at 3000 px and 7299.9 at 800 px), and a second copy of it
 * here would be the divergence this whole step exists to close.
 */
const ANALYSIS_LONG_EDGE_PX = BUNDLED_DEFAULT_CONFIG.analysis.longEdgePx;

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

/**
 * Gate ruleset version. Separate from `IMAGE_NORMALIZER_VERSION` on purpose: the normalizer is
 * unchanged by Step 2.3, so bumping it would invalidate every cached run for no reason. The GATE's
 * meaning did change — different luminance, different Laplacian, a fixed analysis scale, and it now
 * reads the uploaded bytes rather than the normalized ones — and a verdict must stay reproducible, so
 * the version that produced it is recorded on the run.
 *
 * v2.0.0 — Step 2.3: `usabilityGate` delegates to `@silvicom/capture-engine`'s `computeMetrics`.
 */
export const USABILITY_GATE_VERSION = "2.0.0";

export interface UsabilityThresholds {
  minLongEdgePx: number;
  /**
   * `null` means MEASURED AND RECORDED BUT NOT ENFORCED (D-SCAN10 shadow mode).
   *
   * Not an omission — the point. The old floors were 100 for blur and 0.06 for glare, and neither
   * survives Step 2.3: 100 was a variance of a CLAMPED Laplacian at whatever resolution the
   * normalized image happened to be, measured on an image whose contrast had already been stretched.
   * The number has no meaning under the new definition, and inventing a replacement is precisely
   * what `config.ts` forbids. So the metrics are recorded on every run from now on, and Step 5.2
   * derives the floors from that distribution before either check rejects anything.
   */
  minBlurVariance: number | null;
  maxGlareFraction: number | null;
}

/** Resolution is the one floor that survives unchanged: it is scale-free, and it was never in doubt. */
export const DEFAULT_USABILITY: UsabilityThresholds = {
  minLongEdgePx: 1200,
  minBlurVariance: null,
  maxGlareFraction: null,
};

export interface UsabilityResult {
  usable: boolean;
  reasons: string[]; // e.g. "resolution_too_low", "too_blurry", "glare"
  /** Everything measured, enforced or not — this is what Step 5.2 derives the floors from. */
  metrics: MeasuredMetrics;
  gateVersion: string;
}

/**
 * Server-side quality checks BEFORE any model call — a bad page is rejected for recapture, never sent
 * to the model.
 *
 * ── WHAT CHANGED, AND WHY IT HAD TO ───────────────────────────────────────────────────────────
 * This used to compute its own luminance, Laplacian and near-white census through sharp. Measuring
 * that on 2026-09-06 found it could not agree with the client no matter what numbers were written in
 * either file: sharp clamps the Laplacian's negative lobe, its greyscale is a linear-light luminance
 * weighting RGB 127/220/76, its default resampler manufactures near-white pixels, and the metric moves
 * 1.7x with resolution. Each finding is pinned by a named scenario in `imageSemantics.test.ts` —
 * "keeps the dark-side edge response and clamps the light-side one to zero",
 * "rises monotonically as the same image is downscaled, by more than a third overall",
 * "weights pure red, green and blue as 127 / 220 / 76",
 * "invents glare on a page whose brightest true pixel is 235, where non-ringing kernels invent none",
 * and "inflates blur variance and creates glare on a page that had neither".
 *
 * So the arithmetic now lives in ONE place and this calls it (D-SCAN8). sharp's remaining job is
 * decoding, which is the one part each platform genuinely does differently and the one part that
 * cannot be shared.
 *
 * ⚠ It decodes at FULL resolution and downscales in our own code, which is slower than asking sharp
 * to resize during decode. That is deliberate: sharp's resampler is the thing that manufactured 10%
 * glare on a page whose brightest pixel was 235, so using it here would reintroduce the defect this
 * function exists to remove.
 */
export async function usabilityGate(
  input: Buffer,
  thresholds: UsabilityThresholds = DEFAULT_USABILITY,
): Promise<UsabilityResult> {
  const { data, info } = await sharp(input, { failOn: "none" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const metrics = computeMetrics(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height,
    ANALYSIS_LONG_EDGE_PX,
    info.channels,
  );

  const reasons: string[] = [];
  if (metrics.longEdgePx < thresholds.minLongEdgePx) reasons.push("resolution_too_low");
  if (thresholds.minBlurVariance !== null && metrics.blurVariance < thresholds.minBlurVariance) {
    reasons.push("too_blurry");
  }
  if (thresholds.maxGlareFraction !== null && metrics.glareFraction > thresholds.maxGlareFraction) {
    reasons.push("glare");
  }

  return { usable: reasons.length === 0, reasons, metrics, gateVersion: USABILITY_GATE_VERSION };
}

/**
 * Whether the bytes we just downloaded are the bytes that were gated on the device.
 *
 * ── WHY THIS EXISTS (plan Step 1.3, audit finding F5) ─────────────────────────────────────────
 * `hazmat_documents.sha256` has been recorded since migration 0092 and recomputed by nobody, so it
 * asserted a property no code checked. Underneath that, the driver app's two providers were computing
 * it over different things — the native path digested the file's bytes, the JavaScript fallback
 * digested the BASE64 STRING — and nothing could notice, because the value was only ever stored.
 *
 * ── WHY ONLY DRIVER CAPTURES ARE VERIFIABLE ───────────────────────────────────────────────────
 * `capture_mode` is non-null exactly when our own scanner produced the row (0133). That is the only
 * case where we control both the hash producer and the bytes. A manager-registered document's sha256
 * arrives from a client we did not write, against a convention nobody wrote down; failing a run on it
 * would convert an unverifiable claim into a broken feature. So those return `not_verifiable`, which
 * is a statement about our knowledge rather than about the document.
 */
export type IntegrityVerdict = "verified" | "mismatch" | "not_verifiable";

export function verifyIntegrityHash(args: {
  bytes: Buffer;
  recorded: string | null;
  captureMode: string | null;
}): IntegrityVerdict {
  // No capture mode means it did not come from our scanner; no recorded hash means there is nothing
  // to compare against. Neither is evidence of tampering, and neither may be reported as such.
  if (args.captureMode === null || !args.recorded) return "not_verifiable";
  const actual = createHash("sha256").update(args.bytes).digest("hex");
  return actual === args.recorded.toLowerCase() ? "verified" : "mismatch";
}
