/**
 * The metric implementation of record (SCANNER-UPGRADE-PLAN.md Phase 2, D-SCAN1..5, D-SCAN8).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `config.ts` states that its client thresholds are "aligned to the SERVER usability gate" and that
 * "client and server must agree". Measuring the server gate showed they cannot, for five separate
 * reasons, none visible from reading either file (all five are pinned by
 * `apps/api/.../imageSemantics.test.ts`):
 *
 *   M1  `sharp.convolve` clamps the Laplacian's negative lobe — a 0→255 step edge answers
 *       [0,0,0,255,0,0,0,0] — so the focus measure discards every light-on-dark edge.
 *   M2  variance-of-Laplacian moved 4283.7 → 7299.9 on ONE image between 3000 px and 800 px.
 *   M3  `sharp.greyscale()` weights R/G/B as 127/220/76, a linear-light luminance matching neither
 *       Rec.601 (76/150/29) nor Rec.709 (54/182/18).
 *   M4  sharp's default lanczos3 resampling manufactured 10.05% "glare" on an image whose brightest
 *       true pixel was 235.
 *   M5  the gate runs on the NORMALIZED image, where `.normalise()` has already stretched the
 *       maximum to 255 by construction and inflated blur variance 1.9×.
 *
 * Two agreeing implementations is not a thing you achieve by writing the same numbers in two files.
 * So this is the ONE implementation: the server imports and calls it (D-SCAN8), which makes
 * client/server parity structural rather than aspirational, and iOS and Kotlin reimplement it against
 * the fixture corpus (D-SCAN9) because they have no choice.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT MAY AND MAY NOT GO IN HERE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pure arithmetic over a pixel plane. No `sharp`, no `node:`, no React Native, no decoding — the
 * caller decodes, because decoding is the one part each platform genuinely does differently. Every
 * loop is written to be transliterated into Swift and Kotlin by someone reading it side by side, and
 * cleverness that would not survive that trip does not belong here.
 */

import type { ImageMetrics } from "./contracts";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Definitional constants. These are NOT tunable gate thresholds — they are part of what the metric
// MEANS, and changing one changes every recorded number's meaning rather than moving a decision line.
// The tunable floors live in `CaptureConfigGates`, where a signed config can move them.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Rec.709 luma on gamma-encoded sRGB, in 16-bit fixed point (×65536).
 *
 * Integer arithmetic on purpose: three languages must agree to the last count, and floating-point
 * rounding is the classic way for "the same formula" to disagree in the third decimal across
 * platforms. Rec.709 because these are sRGB primaries. `sharp.greyscale()` is deliberately NOT used
 * — M3 shows it is a linear-light luminance nobody could restate in Swift from memory.
 */
const LUMA_R = 13933; // 0.2126 × 65536
const LUMA_G = 46871; // 0.7152 × 65536
const LUMA_B = 4732; //  0.0722 × 65536

/**
 * A pixel at or above this is "near-white" for the glare metric.
 *
 * 250 rather than 255 because a real specular highlight on paper clips a band, not a single value,
 * and because JPEG ringing around a blown region lands a few counts below saturation. It matches the
 * server's long-standing choice, which is the point: this is the number both sides already used, now
 * written down once.
 */
const NEAR_WHITE = 250;

/**
 * The illumination grid for the shadow metric. 8×8 over a 1024 px long edge is ~128 px tiles: coarse
 * enough that a tile is mostly paper rather than mostly one glyph, fine enough to see a hand's shadow
 * across a corner.
 */
const SHADOW_GRID = 8;

/**
 * Which percentile of a tile stands for "how brightly is this part of the page lit".
 *
 * Not the mean: a tile full of text has a lower mean than a blank one at identical illumination, so a
 * mean-based shadow metric would report dense paragraphs as shadows. The 90th percentile tracks the
 * PAPER between the ink, which is the thing illumination actually falls on.
 */
const SHADOW_PERCENTILE = 0.9;

/** A luminance plane and its dimensions. One byte per pixel, row-major, no padding. */
export interface LuminancePlane {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Rec.709 luma from interleaved 8-bit RGB (`width * height * 3` bytes).
 *
 * `channels` allows RGBA input without a copy — a decoded bitmap is RGBA on both mobile platforms,
 * and forcing the caller to strip alpha first would mean an extra full-size allocation on the exact
 * devices this plan is trying to keep out of memory trouble.
 */
export function toLuminance(rgb: Uint8Array, width: number, height: number, channels = 3): LuminancePlane {
  const expected = width * height * channels;
  if (rgb.length < expected) {
    throw new Error(`toLuminance: expected at least ${expected} bytes for ${width}x${height}, received ${rgb.length}`);
  }
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += channels) {
    // >> 16 rather than / 65536 so the result is an integer by construction in every language this
    // is transliterated into, rather than by a rounding call that each of them spells differently.
    data[i] = (LUMA_R * rgb[p]! + LUMA_G * rgb[p + 1]! + LUMA_B * rgb[p + 2]! + 32768) >> 16;
  }
  return { data, width, height };
}

/**
 * Area-average downscale to a fixed long edge (D-SCAN1, D-SCAN5).
 *
 * ── WHY BOX AVERAGING AND NOT SOMETHING BETTER ────────────────────────────────────────────────
 * M4: sharp's default lanczos3 MANUFACTURED 10% near-white pixels on an image whose brightest true
 * pixel was 235, because a ringing kernel overshoots at every edge. A glare metric computed after
 * that is measuring the resampler. Box averaging cannot ring — its kernel is non-negative — and it is
 * the one resampler that can be written identically in TypeScript, Swift and Kotlin in fifteen lines
 * each, which is worth more here than image quality: this plane is never shown to anybody.
 *
 * ── AND WHY IT NEVER UPSCALES ─────────────────────────────────────────────────────────────────
 * An image below the target is returned untouched. Upscaling invents no information, so a metric
 * computed on an upscaled plane would be measuring the interpolator; and since the resolution floor
 * (1200) sits above the analysis scale (1024), any image that passes the gate is downscaled anyway.
 */
export function boxDownscale(plane: LuminancePlane, targetLongEdge: number): LuminancePlane {
  const longEdge = Math.max(plane.width, plane.height);
  if (longEdge <= targetLongEdge || targetLongEdge <= 0) return plane;

  const outWidth = Math.max(1, Math.round((plane.width * targetLongEdge) / longEdge));
  const outHeight = Math.max(1, Math.round((plane.height * targetLongEdge) / longEdge));
  const out = new Uint8Array(outWidth * outHeight);

  for (let oy = 0; oy < outHeight; oy++) {
    // Exact rational footprints rather than a step-and-accumulate: the boundaries are computed from
    // the output index every time, so no rounding error accumulates along a row and the last column
    // covers exactly what it should.
    const y0 = Math.floor((oy * plane.height) / outHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * plane.height) / outHeight));
    for (let ox = 0; ox < outWidth; ox++) {
      const x0 = Math.floor((ox * plane.width) / outWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * plane.width) / outWidth));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * plane.width;
        for (let x = x0; x < x1; x++) sum += plane.data[row + x]!;
      }
      const count = (y1 - y0) * (x1 - x0);
      out[oy * outWidth + ox] = Math.round(sum / count);
    }
  }
  return { data: out, width: outWidth, height: outHeight };
}

/**
 * Variance of the SIGNED, unclamped 4-neighbour Laplacian over the interior (D-SCAN3).
 *
 * Signed because M1 showed the server's `sharp.convolve` clamps the negative lobe to zero, which
 * throws away every light-on-dark edge — half the edges on a document, and all of the edges on a
 * page photographed as white text on a dark stamp. The one-pixel border is excluded rather than
 * edge-extended: an invented neighbour produces an invented edge response, and at 1024 px the border
 * is 0.4% of the pixels, so nothing of value is lost by declining to guess.
 */
export function laplacianVariance(plane: LuminancePlane): number {
  const { data, width, height } = plane;
  if (width < 3 || height < 3) return 0;

  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const value = data[i - 1]! + data[i + 1]! + data[i - width]! + data[i + width]! - 4 * data[i]!;
      sum += value;
      sumSquares += value * value;
      count++;
    }
  }
  const mean = sum / count;
  // E[L²] − E[L]². The response is bounded by ±1020 and the plane by ~1M pixels, so the largest term
  // is about 10^12 — comfortably exact in a double, and in a Kotlin/Swift Double too.
  return sumSquares / count - mean * mean;
}

/**
 * How unevenly the page is lit, 0..1 (D-SCAN4's shadow metric).
 *
 * The page is divided into a grid; each tile reports the 90th percentile of its luminance, which
 * tracks paper rather than ink; the metric is the spread between the brightest and dimmest tile. That
 * is illumination variation across the sheet — a hand's shadow, a window on one side — as distinct
 * from contrast, which is variation WITHIN a tile and is what the ink contributes.
 */
export function illuminationRange(plane: LuminancePlane): number {
  const { data, width, height } = plane;
  if (width === 0 || height === 0) return 0;

  let brightest = 0;
  let dimmest = 255;
  for (let ty = 0; ty < SHADOW_GRID; ty++) {
    const y0 = Math.floor((ty * height) / SHADOW_GRID);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / SHADOW_GRID));
    for (let tx = 0; tx < SHADOW_GRID; tx++) {
      const x0 = Math.floor((tx * width) / SHADOW_GRID);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / SHADOW_GRID));

      // A 256-bin histogram rather than a sort: the percentile is exact for 8-bit data, it allocates
      // a fixed 256 entries regardless of tile size, and it transliterates without a comparator —
      // which is the kind of thing that quietly differs between languages.
      const histogram = new Uint32Array(256);
      let total = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          const v = data[row + x]!;
          histogram[v] = histogram[v]! + 1;
          total++;
        }
      }
      if (total === 0) continue;
      const target = Math.floor(total * SHADOW_PERCENTILE);
      let seen = 0;
      let value = 0;
      for (let v = 0; v < 256; v++) {
        seen += histogram[v]!;
        if (seen > target) {
          value = v;
          break;
        }
      }
      if (value > brightest) brightest = value;
      if (value < dimmest) dimmest = value;
    }
  }
  return brightest <= dimmest ? 0 : (brightest - dimmest) / 255;
}

/** Everything `computeMetrics` measured, before the gate turns it into a verdict. */
export interface MeasuredMetrics {
  /** Long edge of the ORIGINAL image, before the analysis downscale — the resolution floor's input. */
  longEdgePx: number;
  blurVariance: number;
  glareFraction: number;
  brightnessMean: number;
  contrastRms: number;
  shadowRange: number;
  /** The scale everything above was computed at, so a recorded number can be interpreted later. */
  analysisLongEdgePx: number;
}

/**
 * Measure a decoded image.
 *
 * `rgb` is interleaved 8-bit, `channels` is 3 or 4. The caller decodes; this does everything after.
 * The returned `longEdgePx` is the ORIGINAL's, not the analysis plane's — the resolution floor is a
 * question about what the camera captured, and answering it from a downscaled copy would let every
 * image pass by construction, which is the exact circularity `webFileProvider` warns about.
 */
export function computeMetrics(
  rgb: Uint8Array,
  width: number,
  height: number,
  analysisLongEdgePx: number,
  channels = 3,
): MeasuredMetrics {
  const full = toLuminance(rgb, width, height, channels);
  const plane = boxDownscale(full, analysisLongEdgePx);
  const { data } = plane;

  let sum = 0;
  let sumSquares = 0;
  let nearWhite = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    sum += v;
    sumSquares += v * v;
    if (v >= NEAR_WHITE) nearWhite++;
  }
  const n = data.length || 1;
  const mean = sum / n;
  const variance = Math.max(0, sumSquares / n - mean * mean);

  return {
    longEdgePx: Math.max(width, height),
    blurVariance: laplacianVariance(plane),
    glareFraction: nearWhite / n,
    brightnessMean: mean / 255,
    contrastRms: Math.sqrt(variance) / 255,
    shadowRange: illuminationRange(plane),
    analysisLongEdgePx: Math.max(plane.width, plane.height),
  };
}

/**
 * The subset the §5 gate consumes.
 *
 * Deliberately does NOT invent `coverageFraction` or `documentDetected`: neither is measurable from a
 * page image alone, and `nativeSystemScannerProvider` asserting `coverageFraction: 1` is precisely
 * the invented number the plan's Step 5.3 removes. An unmeasured check is `na`, and `na` is never a
 * silent pass.
 */
export function toImageMetrics(m: MeasuredMetrics): ImageMetrics {
  return {
    longEdgePx: m.longEdgePx,
    blurVariance: m.blurVariance,
    glareFraction: m.glareFraction,
    brightnessMean: m.brightnessMean,
    contrastRms: m.contrastRms,
    shadowRange: m.shadowRange,
  };
}
