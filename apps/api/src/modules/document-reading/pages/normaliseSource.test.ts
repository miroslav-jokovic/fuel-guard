import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { INTAKE_LIMITS, INTAKE_REFUSALS, bboxSchema } from "@silvicom/shared";
import { normaliseSource, NORMALISER_VERSION, WORKING_LONG_EDGE_PX, type CanonicalPage } from "./index.js";
import * as fx from "./__fixtures__/fixtures.js";

/**
 * Step 1.3's Verify list (DOCUMENT-READER-PLAN.md Phase 1): five fixture PDFs and one image per
 * format produce byte-identical canonical pages across two runs, upright, sRGB, with text words at
 * the generator's coordinates, and the refusals. Every fixture is synthetic (`__fixtures__/fixtures.ts`).
 */

type Ok = Extract<Awaited<ReturnType<typeof normaliseSource>>, { ok: true }>;

async function normalised(bytes: Buffer, mime: string): Promise<Ok> {
  const out = await normaliseSource(bytes, mime);
  if (!out.ok) throw new Error(`expected pages, got refusal ${out.code}`);
  return out;
}

/** Mean RGB of a square region given as fractions of the page — the landmark probe. */
async function meanRgb(png: Buffer, fx0: number, fy0: number, size = 0.05): Promise<[number, number, number]> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const x0 = Math.floor(info.width * fx0);
  const y0 = Math.floor(info.height * fy0);
  const side = Math.max(1, Math.floor(Math.min(info.width, info.height) * size));
  const sum = [0, 0, 0];
  for (let y = y0; y < y0 + side; y++) {
    for (let x = x0; x < x0 + side; x++) for (let c = 0; c < 3; c++) sum[c]! += data[(y * info.width + x) * info.channels + c]!;
  }
  return sum.map((s) => Math.round(s / (side * side))) as [number, number, number];
}

/** The landmarks of `fx.pageRaster`: black top-left, red top-right, white paper between. */
async function expectUprightPage(png: Buffer): Promise<void> {
  const inMarker = fx.MARKER_FRACTION / 4;
  const [kr, kg, kb] = await meanRgb(png, inMarker, inMarker, fx.MARKER_FRACTION / 3);
  expect(Math.max(kr, kg, kb)).toBeLessThan(40);
  const ratio = (await sharp(png).metadata()).width! / (await sharp(png).metadata()).height!;
  // The red patch is a MARKER_FRACTION of the SHORT edge; on a wide page it is narrower in x.
  const redX = 1 - (fx.MARKER_FRACTION * Math.min(1, 1 / ratio)) / 2 - 0.01;
  const [r, g, b] = await meanRgb(png, redX, inMarker, 0.01);
  expect(r).toBeGreaterThan(180);
  expect(Math.max(g, b)).toBeLessThan(80);
  // Bottom-left and bottom-right corners are paper: a page turned any way would put a marker there.
  for (const [x, y] of [[0.01, 0.94], [0.94, 0.94]] as const) {
    expect(Math.min(...(await meanRgb(png, x, y)))).toBeGreaterThan(235);
  }
}

/** sRGB, 8-bit, 3 channels, no EXIF, no ICC, no orientation tag — D-DR13's canonical encoding. */
async function expectCanonicalEncoding(page: CanonicalPage): Promise<void> {
  const meta = await sharp(page.original.png).metadata();
  expect(meta).toMatchObject({ format: "png", space: "srgb", channels: 3, depth: "uchar", hasAlpha: false });
  expect(meta.exif).toBeUndefined();
  expect(meta.icc).toBeUndefined();
  expect(meta.orientation).toBeUndefined();
  expect(page.original.sha256).toBe(createHash("sha256").update(page.original.png).digest("hex"));
  const working = await sharp(page.working.bytes).metadata();
  expect(working.format).toBe("webp");
  expect(page.working.mediaType).toBe("image/webp");
  expect([working.width, working.height]).toEqual([page.working.width, page.working.height]);
  expect(Math.max(page.working.width, page.working.height)).toBeLessThanOrEqual(WORKING_LONG_EDGE_PX);
}

const IMAGES: [string, () => Promise<Buffer>, string, [number, number]][] = [
  ["an EXIF-rotated JPEG (orientation 6)", fx.exifRotatedJpeg, "image/jpeg", [1600, 1200]],
  ["a PNG with alpha", () => fx.alphaPng(), "image/png", [1400, 1800]],
  ["a WebP", fx.pageWebp, "image/webp", [2400, 1800]],
  ["a CMYK JPEG", fx.cmykJpeg, "image/jpeg", [1600, 1200]],
  ["an HEVC HEIC from macOS sips", async () => fx.heicFixture(), "image/heic", [1600, 1200]],
];

describe("normaliseSource — one canonical page per image format (D-DR13)", () => {
  it.each(IMAGES)("turns %s into an upright 8-bit sRGB page with no metadata", async (_, make, mime, [w, h]) => {
    const out = await normalised(await make(), mime);
    expect(out.pages).toHaveLength(1);
    const [page] = out.pages as [CanonicalPage];
    expect([page.original.width, page.original.height]).toEqual([w, h]);
    expect(page.textLayer).toBeNull();
    expect(page.dpi).toBeNull();
    await expectCanonicalEncoding(page);
    await expectUprightPage(page.original.png);
    await expectUprightPage(page.working.bytes);
  });

  it("applies EXIF orientation 6: the stored 1200×1600 pixels become a 1600×1200 page", async () => {
    const stored = await sharp(await fx.exifRotatedJpeg()).metadata();
    expect([stored.width, stored.height, stored.orientation]).toEqual([1200, 1600, 6]);
    const [page] = (await normalised(await fx.exifRotatedJpeg(), "image/jpeg")).pages as [CanonicalPage];
    expect([page.original.width, page.original.height]).toEqual([1600, 1200]);
  });

  it("flattens transparency on WHITE although the transparent pixels store black", async () => {
    const [page] = (await normalised(await fx.alphaPng(), "image/png")).pages as [CanonicalPage];
    expect(await meanRgb(page.original.png, 0.5, 0.05, 0.02)).toEqual([255, 255, 255]);
  });

  it("converts CMYK to sRGB: the four-channel source comes out as three channels with red still red", async () => {
    expect((await sharp(await fx.cmykJpeg()).metadata()).space).toBe("cmyk");
    const [page] = (await normalised(await fx.cmykJpeg(), "image/jpeg")).pages as [CanonicalPage];
    const [r, g, b] = await meanRgb(page.original.png, 0.95, 0.02, 0.02);
    expect(r).toBeGreaterThan(180);
    expect(Math.max(g, b)).toBeLessThan(80);
  });

  it("widens a one-channel greyscale scan to three-channel sRGB, its black marker still black", async () => {
    expect((await sharp(await fx.greyJpeg()).metadata()).channels).toBe(1);
    const [page] = (await normalised(await fx.greyJpeg(), "image/jpeg")).pages as [CanonicalPage];
    await expectCanonicalEncoding(page);
    expect(Math.max(...(await meanRgb(page.original.png, 0.02, 0.02, 0.02)))).toBeLessThan(40);
  });

  it("decodes the HEIC through libheif — sharp alone still cannot, so the WASM path is still needed", async () => {
    await expect(sharp(fx.heicFixture()).raw().toBuffer()).rejects.toThrow(/compression format|heif/i);
    const out = await normalised(fx.heicFixture(), "image/heic");
    expect(out.format).toBe("heic");
  });
});

describe("normaliseSource — the working copy (≤ 1568 px long edge, never enlarged)", () => {
  it("shrinks a 2400×1800 WebP to 1568×1176 and keeps the original at full size", async () => {
    const [page] = (await normalised(await fx.pageWebp(), "image/webp")).pages as [CanonicalPage];
    expect([page.original.width, page.original.height]).toEqual([2400, 1800]);
    expect([page.working.width, page.working.height]).toEqual([1568, 1176]);
  });

  it("does not upscale a 1300×1000 page: its working copy is 1300×1000", async () => {
    const [page] = (await normalised(await fx.pagePng(1300, 1000), "image/png")).pages as [CanonicalPage];
    expect([page.working.width, page.working.height]).toEqual([1300, 1000]);
  });
});

describe("normaliseSource — PDFs: 300 DPI pages plus the born-digital text layer (D-DR3)", () => {
  let born: Ok;
  beforeAll(async () => {
    born = await normalised(await fx.bornDigitalPdf(), "application/pdf");
  });

  it("renders each page of a two-page born-digital PDF at 300 DPI (2550×3300 for Letter)", async () => {
    expect(born.format).toBe("pdf");
    expect(born.pages.map((p) => [p.page, p.dpi, p.original.width, p.original.height])).toEqual([
      [1, 300, 2550, 3300],
      [2, 300, 2550, 3300],
    ]);
    for (const page of born.pages) await expectCanonicalEncoding(page);
    expect([born.pages[0]!.working.width, born.pages[0]!.working.height]).toEqual([1212, 1568]);
  });

  it("puts every generated word in the text layer, in order, at the generator's coordinates", () => {
    for (const page of born.pages) {
      const lines = fx.BORN_DIGITAL_LINES.filter((l) => l.page === page.page);
      const expected = lines.flatMap((l) => l.text.split(" ").map((text, i) => ({ text, line: l, i })));
      const words = page.textLayer!.words;
      expect(words.map((w) => w.text)).toEqual(expected.map((e) => e.text));
      words.forEach((word, k) => {
        const { line, i } = expected[k]!;
        expect(bboxSchema.safeParse(word.bbox).success).toBe(true);
        // A run's first word starts exactly where pdfkit put it; later words are apportioned by the
        // font's glyph widths along the run (textLayer.ts), so they get a tenth of an em: measured
        // worst 0.67 pt at 10 pt. Cutting by character count misses this by up to 0.68 em.
        const xTolerance = i === 0 ? 0.5 : line.size * 0.1;
        expect(Math.abs(word.bbox.x * fx.LETTER.width - fx.wordLeftPt(line, i))).toBeLessThan(xTolerance);
        // pdfkit's y is the top of the line box; the box's top is the font's ascent above baseline.
        expect(Math.abs(word.bbox.y * fx.LETTER.height - line.y)).toBeLessThan(line.size * 0.3);
        expect(word.bbox.h * fx.LETTER.height).toBeGreaterThan(line.size * 0.9);
        expect(word.bbox.h * fx.LETTER.height).toBeLessThan(line.size * 1.3);
      });
    }
  });

  it("gives a scanned PDF (one image, no text operators) its page and NO text layer", async () => {
    const out = await normalised(await fx.scannedPdf(), "application/pdf");
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0]!.textLayer).toBeNull();
    await expectUprightPage(out.pages[0]!.original.png);
  });

  it("honours /Rotate 90: a landscape 3300×2550 page, marker top-left, its words read left to right", async () => {
    const [page] = (await normalised(await fx.rotatedPdf(), "application/pdf")).pages as [CanonicalPage];
    expect([page.original.width, page.original.height]).toEqual([3300, 2550]);
    const [k] = await meanRgb(page.original.png, 0.005, 0.01, 0.02);
    expect(k).toBeLessThan(40);
    expect(Math.min(...(await meanRgb(page.original.png, 0.97, 0.94, 0.02)))).toBeGreaterThan(235);
    const [rotated, pageWord] = page.textLayer!.words;
    expect([rotated!.text, pageWord!.text]).toEqual(["ROTATED", "PAGE"]);
    const { x, y, size } = fx.ROTATED_LINE;
    // Displayed page is 792 × 612 pt; the run is horizontal, so its box is wider than it is tall.
    expect(Math.abs(rotated!.bbox.x * fx.LETTER.height - x)).toBeLessThan(0.5);
    expect(Math.abs(rotated!.bbox.y * fx.LETTER.width - y)).toBeLessThan(size * 0.3);
    expect(pageWord!.bbox.x).toBeGreaterThan(rotated!.bbox.x + rotated!.bbox.w);
    expect(rotated!.bbox.w * 3300).toBeGreaterThan(rotated!.bbox.h * 2550);
  });

  it("accepts the limit itself: a PDF of exactly maxPdfPages pages is rendered", async () => {
    const out = await normalised(await fx.pagesPdf(INTAKE_LIMITS.maxPdfPages), "application/pdf");
    expect(out.pages).toHaveLength(INTAKE_LIMITS.maxPdfPages);
  }, 60_000);
});

describe("normaliseSource — refusals, each an IntakeRefusalCode with its sentence", () => {
  const refusal = async (bytes: Buffer, mime: string) => {
    const out = await normaliseSource(bytes, mime);
    expect(out.ok).toBe(false);
    const code = (out as { code: keyof typeof INTAKE_REFUSALS }).code;
    expect(INTAKE_REFUSALS[code]).toEqual(expect.any(String));
    return code;
  };

  it("refuses an 11-page PDF as too_many_pages", async () => {
    expect(await refusal(await fx.pagesPdf(INTAKE_LIMITS.maxPdfPages + 1), "application/pdf")).toBe("too_many_pages");
  });
  it("refuses a PDF that needs a password to open as encrypted_pdf", async () => {
    expect(await refusal(await fx.encryptedPdf(), "application/pdf")).toBe("encrypted_pdf");
  });
  it("refuses one byte over maxBytes as too_large, before looking at the bytes", async () => {
    const big = Buffer.alloc(INTAKE_LIMITS.maxBytes + 1);
    (await fx.pageJpeg()).copy(big);
    expect(await refusal(big, "image/jpeg")).toBe("too_large");
  });
  it("refuses an image whose long edge is one pixel under minLongEdgePx as too_small, and accepts the limit", async () => {
    const under = INTAKE_LIMITS.minLongEdgePx - 1;
    expect(await refusal(await fx.pageJpeg(under, 900), "image/jpeg")).toBe("too_small");
    expect((await normaliseSource(await fx.pageJpeg(INTAKE_LIMITS.minLongEdgePx, 900), "image/jpeg")).ok).toBe(true);
  });
  it("judges too_small on the decoded long edge, whichever way an EXIF-rotated photo was held", async () => {
    const portrait = await sharp(await fx.pageJpeg(1100, 800)).rotate(90).jpeg().withMetadata({ orientation: 8 }).toBuffer();
    expect(await refusal(portrait, "image/jpeg")).toBe("too_small");
  });
  it("refuses a GIF as unsupported_format", async () => {
    const gif = await sharp(await fx.pagePng()).gif().toBuffer();
    expect(await refusal(gif, "image/gif")).toBe("unsupported_format");
  });
  it("refuses a JPEG header followed by garbage, and a PDF header followed by garbage, as decode_failed", async () => {
    const junk = Buffer.from("this is not an image at all ".repeat(64));
    expect(await refusal(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), junk]), "image/jpeg")).toBe("decode_failed");
    expect(await refusal(Buffer.concat([Buffer.from("%PDF-1.7\n"), junk]), "application/pdf")).toBe("decode_failed");
  });
});

describe("normaliseSource — the sniff decides, the declared mime is only compared", () => {
  it("reads a PNG declared as image/jpeg, and records that the claim did not match", async () => {
    const out = await normalised(await fx.pagePng(), "image/jpeg");
    expect([out.format, out.declaredMimeMatches]).toEqual(["png", false]);
  });
  it("reads a HEIC declared as application/octet-stream", async () => {
    const out = await normalised(fx.heicFixture(), "application/octet-stream");
    expect([out.format, out.declaredMimeMatches]).toEqual(["heic", false]);
  });
  it("records a matching claim case-insensitively", async () => {
    expect((await normalised(await fx.pagePng(), " IMAGE/PNG ")).declaredMimeMatches).toBe(true);
  });
});

describe("normaliseSource — determinism (the page hash is the cache key's, §4.6)", () => {
  const SOURCES: [string, () => Promise<Buffer>, string][] = [
    ...IMAGES.map(([name, make, mime]) => [name, make, mime] as [string, () => Promise<Buffer>, string]),
    ["the born-digital PDF", fx.bornDigitalPdf, "application/pdf"],
    ["the scanned PDF", fx.scannedPdf, "application/pdf"],
    ["the rotated PDF", fx.rotatedPdf, "application/pdf"],
  ];
  it.each(SOURCES)("gives byte-identical pages for %s on two runs", async (_, make, mime) => {
    const bytes = await make();
    const [a, b] = [await normalised(bytes, mime), await normalised(bytes, mime)];
    expect(a.pages.length).toBe(b.pages.length);
    a.pages.forEach((page, i) => {
      const other = b.pages[i]!;
      expect(page.original.sha256).toBe(other.original.sha256);
      expect(page.original.png.equals(other.original.png)).toBe(true);
      expect(page.working.bytes.equals(other.working.bytes)).toBe(true);
      expect(page.textLayer).toEqual(other.textLayer);
    });
  });

  it("does not consume the caller's buffer — the source bytes are still intact after a PDF render", async () => {
    const bytes = await fx.bornDigitalPdf();
    const before = createHash("sha256").update(bytes).digest("hex");
    await normalised(bytes, "application/pdf");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(before);
  });

  it("has a version for the cache key", () => {
    expect(NORMALISER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
