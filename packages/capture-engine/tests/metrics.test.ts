import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "../fixtures/png.mjs";
import { BUNDLED_DEFAULT_CONFIG } from "../src/config.js";
import {
  boxDownscale,
  computeMetrics,
  illuminationRange,
  laplacianVariance,
  toLuminance,
  type MeasuredMetrics,
} from "../src/metrics.js";

/**
 * The metric definition behaves as defined (SCANNER-UPGRADE-PLAN.md Step 2.1).
 *
 * ── WHAT IS AND IS NOT WORTH ASSERTING HERE ───────────────────────────────────────────────────
 * Asserting exact metric values would pin arithmetic to itself: any implementation that returns what
 * it currently returns passes, including a wrong one. What is worth pinning is the two things a wrong
 * implementation cannot fake:
 *
 *   1. ORDERING over the corpus — a sharp page must out-score a soft one on focus, a blown page must
 *      out-score a clean one on glare, an underexposed page must sit below a well-lit one. A stub
 *      returning a constant fails every one of these.
 *   2. The DEFINITIONAL properties the plan chose deliberately and that a plausible re-write would
 *      get wrong: Rec.709 luma rather than sharp's linear-light one (M3), a signed Laplacian rather
 *      than a clamped one (M1), area averaging that cannot ring (M4), a fixed analysis scale (M2),
 *      and no upscaling.
 *
 * The exact values are pinned separately and on purpose — by `fixtures/expected.json`, which exists to
 * hold the Swift and Kotlin implementations to this one.
 */

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const ANALYSIS = BUNDLED_DEFAULT_CONFIG.analysis.longEdgePx;

function measure(name: string): MeasuredMetrics {
  const { width, height, rgb } = decodePng(readFileSync(join(FIXTURES, `${name}.png`)));
  return computeMetrics(rgb, width, height, ANALYSIS);
}

describe("toLuminance — Rec.709 on gamma-encoded sRGB (D-SCAN2)", () => {
  const solid = (r: number, g: number, b: number) =>
    toLuminance(Uint8Array.from([r, g, b]), 1, 1).data[0];

  it("weights the primaries by Rec.709 and not by sharp's linear-light luminance", () => {
    // sharp.greyscale() answers 127 / 220 / 76 (measured, M3). Those are the numbers a client that
    // trusted the library would have to reproduce, and no textbook formula produces them — which is
    // exactly why the definition is written out here instead of delegated.
    expect(solid(255, 0, 0)).toBe(54);
    expect(solid(0, 255, 0)).toBe(182);
    expect(solid(0, 0, 255)).toBe(18);

    expect(solid(0, 255, 0)).not.toBe(220); // sharp
    expect(solid(0, 255, 0)).not.toBe(150); // Rec.601
  });

  it("is exact at both ends and rounds rather than truncates", () => {
    expect(solid(0, 0, 0)).toBe(0);
    expect(solid(255, 255, 255)).toBe(255);
    expect(solid(128, 128, 128)).toBe(128);
  });

  it("reads RGBA without needing the alpha stripped first", () => {
    const rgba = Uint8Array.from([0, 255, 0, 255, 0, 255, 0, 255]);
    const plane = toLuminance(rgba, 2, 1, 4);
    expect([...plane.data]).toEqual([182, 182]);
  });

  it("refuses a buffer too small for the dimensions rather than reading past it", () => {
    expect(() => toLuminance(new Uint8Array(5), 4, 4)).toThrow(/expected at least/);
  });
});

describe("boxDownscale — the analysis scale (D-SCAN1, D-SCAN5)", () => {
  const plane = (w: number, h: number, fn: (x: number, y: number) => number) => {
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
    return { data, width: w, height: h };
  };

  it("never upscales — an image below the target comes back untouched", () => {
    // Upscaling invents no information, so a metric computed on an upscaled plane measures the
    // interpolator. The resolution floor (1200) sits above the analysis scale, so this branch only
    // ever runs for images the gate is about to reject anyway.
    const small = plane(64, 48, () => 100);
    expect(boxDownscale(small, 1024)).toBe(small);
  });

  it("reaches the target long edge and keeps the aspect ratio", () => {
    const out = boxDownscale(plane(2048, 1024, () => 50), 1024);
    expect(Math.max(out.width, out.height)).toBe(1024);
    expect(out.width / out.height).toBeCloseTo(2, 5);
  });

  it("averages rather than samples, so a checkerboard becomes its mean", () => {
    // A point-sampling downscale would return all-0 or all-255 depending on phase. Averaging is what
    // makes the result independent of where the grid happens to land.
    const out = boxDownscale(plane(64, 64, (x, y) => ((x + y) % 2 ? 255 : 0)), 8);
    expect([...out.data].every((v) => v >= 126 && v <= 129)).toBe(true);
  });

  it("cannot manufacture a near-white pixel the source did not have (M4)", () => {
    // This is the whole reason the kernel is a box. sharp's default lanczos3 turned an image whose
    // brightest true pixel was 235 into one with 10.05% of its pixels at or above 250, purely by
    // ringing at edges — and a glare metric computed after that is measuring the resampler.
    const striped = plane(2000, 1400, (_x, y) => (y % 14 < 3 ? 30 : 235));
    const out = boxDownscale(striped, 1024);
    // A loop rather than Math.max(...out.data): spreading a million-element array overflows the call
    // stack, which fails the test for a reason that has nothing to do with the resampler.
    let brightest = 0;
    for (const v of out.data) if (v > brightest) brightest = v;
    expect(brightest).toBeLessThanOrEqual(235);
  });
});

describe("laplacianVariance — signed and unclamped (D-SCAN3)", () => {
  it("scores dark-on-light and light-on-dark line art identically, which a clamped implementation cannot", () => {
    // M1: sharp's convolve answers [0,0,0,255,0,0,0,0] across a step, keeping only the positive lobe.
    //
    // ⚠ A single STEP EDGE does not detect that, and the first version of this test used one: a step
    // and its mirror produce the same multiset of Laplacian responses, so clamping hits both equally
    // and the test passed against a deliberately clamped implementation. Thin lines are the case that
    // discriminates, because their lobes are asymmetric in COUNT — a one-pixel dark line puts a large
    // positive response on one pixel and two smaller negative ones beside it, and inverting the page
    // swaps which of those the clamp destroys.
    //
    // Focus is not a function of polarity: a page of black text on white paper and a photographic
    // negative of it are equally sharp, and any measure that disagrees is measuring ink colour.
    const w = 64;
    const h = 64;
    const darkOnLight = new Uint8Array(w * h);
    const lightOnDark = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const onLine = y % 4 === 0;
        darkOnLight[y * w + x] = onLine ? 20 : 235;
        lightOnDark[y * w + x] = onLine ? 235 : 20;
      }
    }
    const a = laplacianVariance({ data: darkOnLight, width: w, height: h });
    const b = laplacianVariance({ data: lightOnDark, width: w, height: h });
    expect(a).toBeGreaterThan(0);
    expect(a).toBeCloseTo(b, 6);
  });

  it("is zero on a flat field, where there is nothing to be in focus", () => {
    const flat = { data: new Uint8Array(32 * 32).fill(140), width: 32, height: 32 };
    expect(laplacianVariance(flat)).toBe(0);
  });

  it("returns zero rather than reading past the edge of a tiny plane", () => {
    expect(laplacianVariance({ data: new Uint8Array(4), width: 2, height: 2 })).toBe(0);
  });
});

describe("illuminationRange — lighting, not ink (D-SCAN4)", () => {
  it("reports nothing on an evenly lit page however much text it carries", () => {
    // The distinction that makes this metric worth having: a dense paragraph is not a shadow. A
    // mean-based tile statistic would call this page unevenly lit because its tiles differ in ink.
    const w = 512;
    const h = 512;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Left half VERY dense text (5 rows of ink in every 8), right half blank paper — identical
        // illumination throughout.
        //
        // ⚠ The density is the test. The first version used 3 rows in 8, which is under half, so a
        // median would still have landed on paper and a median-based implementation passed. Above
        // half, only a percentile high enough to clear the ink reports the paper — which is the
        // property being pinned, and the reason the constant is 0.9 rather than "some percentile".
        data[y * w + x] = x < w / 2 && y % 8 < 5 ? 40 : 230;
      }
    }
    expect(illuminationRange({ data, width: w, height: h })).toBe(0);
  });

  it("reports a gradient across the page", () => {
    const w = 512;
    const h = 512;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = 60 + Math.round((x / w) * 170);
    expect(illuminationRange({ data, width: w, height: h })).toBeGreaterThan(0.5);
  });
});

describe("computeMetrics over the fixture corpus", () => {
  it("ranks focus: sharp above motion-blurred above softened", () => {
    const sharp = measure("clean-sharp-even-portrait-dense").blurVariance;
    const motion = measure("motion-blur-portrait-dense").blurVariance;
    const soft = measure("soft-heavy-portrait-dense").blurVariance;
    expect(sharp).toBeGreaterThan(motion);
    expect(motion).toBeGreaterThan(soft);
  });

  it("ranks glare: blown above a specular patch above clean", () => {
    const blown = measure("blown-half-portrait-dense").glareFraction;
    const patch = measure("specular-patch-portrait-dense").glareFraction;
    const clean = measure("clean-sharp-even-portrait-dense").glareFraction;
    expect(blown).toBeGreaterThan(patch);
    expect(patch).toBeGreaterThan(clean);
    expect(clean).toBe(0); // the clean fixture's brightest pixel is 231 by construction
  });

  it("ranks exposure: underexposed below clean below overexposed", () => {
    expect(measure("underexposed-portrait-dense").brightnessMean)
      .toBeLessThan(measure("clean-sharp-even-portrait-dense").brightnessMean);
    expect(measure("clean-sharp-even-portrait-dense").brightnessMean)
      .toBeLessThan(measure("overexposed-portrait-dense").brightnessMean);
  });

  it("ranks contrast: a low-contrast page below a clean one", () => {
    expect(measure("low-contrast-portrait-dense").contrastRms)
      .toBeLessThan(measure("clean-sharp-even-portrait-dense").contrastRms);
  });

  it("ranks illumination: side-lit and hand-shadowed above evenly lit", () => {
    const even = measure("clean-sharp-even-portrait-dense").shadowRange;
    expect(measure("sidelit-strong-portrait-dense").shadowRange).toBeGreaterThan(even);
    expect(measure("hand-shadow-portrait-dense").shadowRange).toBeGreaterThan(even);
  });

  it("measures resolution on the ORIGINAL and everything else at the analysis scale", () => {
    // The circularity `webFileProvider` warns about: gate the downscaled copy and everything passes,
    // because everything is resized to the same long edge. So the resolution floor's input is the
    // original's long edge, while every other metric is computed at a fixed scale so its number means
    // the same thing on every device.
    const m = measure("clean-sharp-even-portrait-dense");
    expect(m.longEdgePx).toBe(1654);
    expect(m.analysisLongEdgePx).toBe(ANALYSIS);
  });

  it("gives the same page the same numbers twice — the metric is deterministic", () => {
    expect(measure("cab-dim-soft-portrait-dense")).toEqual(measure("cab-dim-soft-portrait-dense"));
  });
});
