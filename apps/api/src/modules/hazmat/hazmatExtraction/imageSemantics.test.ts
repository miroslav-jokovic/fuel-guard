import { describe, expect, it } from "vitest";
import sharp, { type KernelEnum } from "sharp";
import { normalizeImage, usabilityGate } from "./image.js";

/**
 * The five measured properties of the image pipeline that the scanner's quality contract rests on
 * (SCANNER-UPGRADE-PLAN.md §0.2, M1-M5; measured 2026-09-06).
 *
 * ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────────────────────────
 * `packages/capture-engine/src/config.ts` states that its client-side thresholds are "aligned to the
 * SERVER usability gate ... Client and server must agree". Measuring the server gate showed they
 * cannot agree, for five separate reasons, none of which is visible by reading either file. Each one
 * is a property of `sharp`/libvips or of our own `normalizeImage` composition, and each one silently
 * changes what a threshold MEANS:
 *
 *   M1  sharp's convolve clamps the Laplacian's negative lobe, so the "focus measure" discards
 *       every light-on-dark edge — half the edges on a document.
 *   M2  variance-of-Laplacian is strongly scale-dependent, so a floor without a stated analysis
 *       resolution is not a floor.
 *   M3  sharp's greyscale is a linear-light luminance, matching neither Rec.601 nor Rec.709, so a
 *       client that computes luma from a textbook formula measures a DIFFERENT plane.
 *   M4  sharp's default lanczos3 resampling rings, MANUFACTURING near-white pixels and therefore
 *       manufacturing "glare" on an image that has none.
 *   M5  `usabilityGate` receives the output of `normalizeImage` (orchestrate.ts), whose `.normalise()`
 *       stretches the maximum luminance to 255 by construction — so "fraction of pixels >= 250"
 *       measures the stretch rather than the glare, and blur variance is inflated on top.
 *
 * These are not assertions about what the code SHOULD do. They are assertions about what the
 * toolchain DOES, pinned so that a libvips upgrade, a sharp major, or an edit to `normalizeImage`
 * cannot change the meaning of a shipped threshold without going red here first. Three of them
 * (M1, M3, M4) describe behaviour the plan then deliberately moves away from; pinning them is what
 * makes that move safe to reason about, and what will prove it happened when the plan's Phase 2
 * lands and these expectations change together with the code.
 *
 * Every case below was checked by mutation, not by a green run: each assertion was inverted and seen
 * to fail before being committed.
 */

/** A deterministic RGB PNG built pixel by pixel, so every measurement below is reproducible. */
async function rgbPng(
  width: number,
  height: number,
  fn: (x: number, y: number) => readonly [number, number, number],
): Promise<Buffer> {
  const buf = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * width + x) * 3;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
    }
  }
  return sharp(buf, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

/** Grey-only convenience over `rgbPng` — the shape `image.test.ts` already uses. */
function greyPng(width: number, height: number, fn: (x: number, y: number) => number): Promise<Buffer> {
  return rgbPng(width, height, (x, y) => {
    const v = fn(x, y);
    return [v, v, v] as const;
  });
}

/**
 * The luminance plane exactly as `usabilityGate` obtains it — via `sharp.greyscale()`. Kept in one
 * place because M3 is precisely the finding that this plane is not the one a caller would assume.
 */
async function luminance(buf: Buffer): Promise<Uint8Array> {
  const { data } = await sharp(buf, { failOn: "none" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return data;
}

/** Variance of sharp's Laplacian response — the server's focus measure, byte for byte. */
async function blurVariance(buf: Buffer): Promise<number> {
  const { data } = await sharp(buf, { failOn: "none" })
    .greyscale()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i]!;
  const mean = sum / data.length;
  let varSum = 0;
  for (let i = 0; i < data.length; i++) varSum += (data[i]! - mean) ** 2;
  return varSum / data.length;
}

/** Near-white fraction + the true maximum — the server's glare measure plus the value it hides. */
async function nearWhite(buf: Buffer): Promise<{ fraction: number; max: number }> {
  const lum = await luminance(buf);
  let count = 0;
  let max = 0;
  for (let i = 0; i < lum.length; i++) {
    if (lum[i]! >= 250) count++;
    if (lum[i]! > max) max = lum[i]!;
  }
  return { fraction: lum.length > 0 ? count / lum.length : 0, max };
}

/** A page-like source: dark glyph-sized marks on off-white paper. Nothing in it is near-white. */
const documentPixel = (x: number, y: number): number => (y % 16 < 3 && x % 11 < 6 ? 70 : 210);

describe("M1 — sharp's convolve clamps the Laplacian's negative lobe", () => {
  it("keeps the dark-side edge response and clamps the light-side one to zero", async () => {
    // One vertical step: columns 0-3 black, columns 4-7 white. A signed Laplacian would answer
    // +255 at x=3 (dark pixel beside a light neighbour) and -255 at x=4 (the mirror). Only the
    // positive one survives an unsigned 8-bit output.
    const step = await greyPng(8, 8, (x) => (x < 4 ? 0 : 255));
    const { data } = await sharp(step)
      .greyscale()
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const middleRow = Array.from(data.subarray(3 * 8, 4 * 8));
    expect(middleRow).toEqual([0, 0, 0, 255, 0, 0, 0, 0]);
    // Stated as its own expectation because this, not the row shape, is the consequence: the
    // measure is half-rectified, so a page whose edges are mostly light-on-dark scores lower for a
    // reason that has nothing to do with focus.
    expect(middleRow[4]).toBe(0);
  });
});

describe("M2 — variance-of-Laplacian depends strongly on the analysis scale", () => {
  it("rises monotonically as the same image is downscaled, by more than a third overall", async () => {
    const source = await greyPng(3000, 2000, documentPixel);
    const scales = [3000, 2048, 1568, 1200, 1024, 800];

    const measured: number[] = [];
    for (const longEdge of scales) {
      const resized = await sharp(source)
        .resize({ width: longEdge, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      measured.push(await blurVariance(resized));
    }

    for (let i = 1; i < measured.length; i++) {
      expect(measured[i]!).toBeGreaterThan(measured[i - 1]!);
    }
    // Measured 2026-09-06: 4283.7 at 3000px against 7299.9 at 800px, a factor of 1.70. The bound is
    // deliberately loose (1.3) because the exact figure is a property of libvips' resampler, while
    // the CLAIM being pinned is only that the dependence is large enough to invalidate a threshold
    // quoted without a resolution. A change that made this ratio approach 1.0 would mean the metric
    // had become scale-free, which would be excellent news and should still fail this test loudly.
    expect(measured.at(-1)! / measured[0]!).toBeGreaterThan(1.3);
  });
});

describe("M3 — sharp's greyscale is a linear-light luminance, not a textbook luma", () => {
  it("weights pure red, green and blue as 127 / 220 / 76", async () => {
    const channels: Array<{ name: string; rgb: readonly [number, number, number]; expected: number }> = [
      { name: "red", rgb: [255, 0, 0], expected: 127 },
      { name: "green", rgb: [0, 255, 0], expected: 220 },
      { name: "blue", rgb: [0, 0, 255], expected: 76 },
    ];
    for (const channel of channels) {
      const lum = await luminance(await rgbPng(4, 4, () => channel.rgb));
      expect(lum[0], channel.name).toBe(channel.expected);
    }
  });

  it("matches neither Rec.601 nor Rec.709 luma, which is why the client cannot guess it", async () => {
    // Rec.601 would be 76 / 150 / 29; Rec.709 would be 54 / 182 / 18. libvips converts
    // sRGB -> linear -> Y -> sRGB gamma, which is a different plane from either. A client computing
    // 0.299R + 0.587G + 0.114B and comparing against a server threshold is comparing two different
    // measurements of the same photograph.
    const green = (await luminance(await rgbPng(4, 4, () => [0, 255, 0] as const)))[0]!;
    expect(green).not.toBe(150); // Rec.601
    expect(green).not.toBe(182); // Rec.709
  });
});

describe("M4 — lanczos3 resampling manufactures near-white pixels", () => {
  it("invents glare on a page whose brightest true pixel is 235, where non-ringing kernels invent none", async () => {
    // Nothing in the source is within 20 of white. Any near-white pixel after a resize was created
    // by the resampler's overshoot, not by the scene.
    const source = await greyPng(3000, 2000, (_x, y) => (y % 14 < 3 ? 30 : 235));
    expect((await nearWhite(source)).max).toBe(235);

    const resize = (kernel: keyof KernelEnum): Promise<Buffer> =>
      sharp(source).resize({ width: 1568, fit: "inside", kernel }).png().toBuffer();

    // lanczos3 is sharp's DEFAULT, and it is what `normalizeImage` therefore uses.
    const ringing = await nearWhite(await resize("lanczos3"));
    expect(ringing.max).toBeGreaterThan(250);
    expect(ringing.fraction).toBeGreaterThan(0.05); // measured 0.10048

    for (const kernel of ["lanczos2", "cubic", "mitchell", "nearest"] as const) {
      const clean = await nearWhite(await resize(kernel));
      expect(clean.fraction, kernel).toBe(0);
      expect(clean.max, kernel).toBeLessThan(250);
    }
  });
});

describe("M5 — the server gates the normalized image, not the captured one", () => {
  it("inflates blur variance and creates glare on a page that had neither", async () => {
    const source = await greyPng(3000, 2000, documentPixel);
    const before = await nearWhite(source);
    const beforeBlur = await blurVariance(source);
    expect(before.max).toBe(210); // nothing in the source is remotely near-white
    expect(before.fraction).toBe(0);

    // `orchestrate.ts` pushes `normalizeImage(raw).normalized` into `gateBuffers`, so this — not the
    // uploaded page — is what `usabilityGate` measures.
    const { normalized } = await normalizeImage(source);
    const after = await nearWhite(normalized);
    const afterBlur = await blurVariance(normalized);

    // `.normalise()` stretches luminance to the full range, so the maximum becomes 255 whatever the
    // scene contained. "Fraction of pixels >= 250" is therefore a measure of the stretch.
    expect(after.max).toBe(255);
    expect(after.fraction).toBeGreaterThan(0.01); // measured 0.01964, from a source with zero
    // Measured 2026-09-06: 2395.8 -> 4542.3, a factor of 1.90. Loose bound for the same reason as M2.
    expect(afterBlur / beforeBlur).toBeGreaterThan(1.5);
  });

  it("passes a page through the shipped gate, so the pinned semantics are the ones in production", async () => {
    // Belt and braces: the properties above are measured with local helpers that mirror
    // `usabilityGate`'s arithmetic. This case proves the mirror is faithful by running the real
    // function over the real normalized bytes and reading its own reported metrics.
    const source = await greyPng(3000, 2000, documentPixel);
    const { normalized } = await normalizeImage(source);
    const gate = await usabilityGate(normalized);

    expect(gate.metrics.glareFraction).toBeGreaterThan(0.01);
    expect(gate.metrics.blurVariance).toBeGreaterThan(1.5 * (await blurVariance(source)));
    expect(gate.metrics.longEdgePx).toBe(1568);
  });
});
