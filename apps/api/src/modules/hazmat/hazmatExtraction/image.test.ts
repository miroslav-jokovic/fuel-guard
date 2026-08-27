import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { IMAGE_NORMALIZER_VERSION, normalizeImage, usabilityGate } from "./image.js";

/** Build a PNG from a per-pixel grey function so we can exercise the real sharp pipeline deterministically. */
async function png(width: number, height: number, fn: (x: number, y: number) => number): Promise<Buffer> {
  const buf = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = fn(x, y);
      const i = (y * width + x) * 3;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v;
    }
  }
  return sharp(buf, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

const checker = (x: number, y: number) => ((x + y) % 2 ? 160 : 100); // high-frequency, no near-white

describe("usabilityGate", () => {
  it("passes a sharp, well-resolved, glare-free page", async () => {
    const g = await usabilityGate(await png(1300, 1300, checker));
    expect(g.usable).toBe(true);
    expect(g.reasons).toEqual([]);
    expect(g.metrics.longEdgePx).toBe(1300);
  });

  it("rejects a low-resolution page", async () => {
    const g = await usabilityGate(await png(400, 400, checker));
    expect(g.usable).toBe(false);
    expect(g.reasons).toContain("resolution_too_low");
  });

  it("rejects a blurry (flat) page — no edges → low Laplacian variance", async () => {
    const g = await usabilityGate(await png(1300, 1300, () => 128));
    expect(g.usable).toBe(false);
    expect(g.reasons).toContain("too_blurry");
  });

  it("rejects a glare-blown page (mostly near-white)", async () => {
    const g = await usabilityGate(await png(1300, 1300, () => 255));
    expect(g.reasons).toContain("glare");
  });
});

describe("normalizeImage (v2 — D11/D12, §12.3 stage 2)", () => {
  it("auto-orients + normalizes and reports a versioned result", async () => {
    const r = await normalizeImage(await png(1300, 1300, checker));
    expect(r.width).toBe(1300);
    expect(r.height).toBe(1300);
    expect(r.normalizerVersion).toBe(IMAGE_NORMALIZER_VERSION);
    expect(r.normalized.length).toBeGreaterThan(0);
  });

  it("encodes WebP and reports the REAL media type, verified from metadata (D11)", async () => {
    const r = await normalizeImage(await png(1300, 1300, checker));
    expect(r.mediaType).toBe("image/webp");
    const meta = await sharp(r.normalized).metadata();
    expect(meta.format).toBe("webp"); // the returned type is the truth of the bytes, not a label
  });

  it("bounds the long edge to 1568 px so a multi-page BOL fits the 10 MB API cap (D12)", async () => {
    const r = await normalizeImage(await png(4000, 3000, checker));
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(1568);
    // Aspect ratio preserved by fit: "inside".
    expect(r.width).toBeGreaterThan(r.height);
  });

  it("never upscales a small page (withoutEnlargement)", async () => {
    const r = await normalizeImage(await png(800, 600, checker));
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
  });

  it("converts a JPEG input to WebP — the format that reached the model is never the input's (D11)", async () => {
    const jpeg = await sharp(await png(1400, 1400, checker)).jpeg({ quality: 90 }).toBuffer();
    const r = await normalizeImage(jpeg);
    expect(r.mediaType).toBe("image/webp");
    const meta = await sharp(r.normalized).metadata();
    expect(meta.format).toBe("webp");
  });
});
