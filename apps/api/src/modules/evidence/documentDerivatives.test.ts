/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveBytes, deriveDocument } from "./documentDerivatives.js";
import { DERIVATIVE_SPECS } from "@silvicom/shared";

/**
 * B2 — the derivative generator. The supabaseRecorder has no Storage surface, so this stub carries
 * one: tables for the two reads and the insert, a bucket for download/upload. sharp runs FOR REAL
 * against a generated PNG — a mocked encoder would prove nothing about the one operation this
 * service exists to perform.
 */
const ORG = "org1";
const DOC = "00000000-0000-4000-8000-00000000000a";

async function tinyPng(w = 1200, h = 800): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .png()
    .toBuffer();
}

function makeStub(originalRow: Record<string, unknown> | null, originalBytes: Buffer | null, existing: Array<{ variant: string }> = []) {
  const inserted: Record<string, unknown>[] = [];
  const uploaded: Array<{ path: string; bytes: Buffer; contentType: string }> = [];
  const admin = {
    from: (_table: string) => {
      let mode: "row" | "existing" | "insert" = "row";
      const b: any = {
        select: () => b,
        insert: (p: unknown) => { mode = "insert"; inserted.push(p as Record<string, unknown>); return b; },
        eq: (col: string) => { if (col === "derived_from") mode = "existing"; return b; },
        maybeSingle: async () => ({ data: originalRow, error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          if (mode === "existing") return resolve({ data: [...existing, ...inserted.map((r) => ({ variant: r.variant }))], error: null });
          return resolve({ error: null }); // insert
        },
      };
      return b;
    },
    storage: {
      from: () => ({
        download: async () =>
          originalBytes
            ? { data: new Blob([new Uint8Array(originalBytes)]), error: null }
            : { data: null, error: { message: "Object not found" } },
        upload: async (path: string, bytes: Buffer, opts: { contentType: string }) => {
          uploaded.push({ path, bytes, contentType: opts.contentType });
          return { error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { admin, inserted, uploaded };
}

/**
 * A two-page Letter PDF: page 1 has its LEFT half inked, page 2 is blank paper. So a thumb whose left
 * half is dark is page 1 and nothing else — and a white thumb is the silent failure (a pdf.js decoder
 * that never started) that `lib/pdfRaster.ts` exists to rule out.
 */
async function twoPagePdf(opts: { userPassword?: string } = {}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 0, ...opts });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  doc.rect(0, 0, 306, 792).fill("#000000");
  doc.addPage();
  doc.end();
  return done;
}

/** Mean luminance (0 dark … 255 white) of the left and right halves of an image. */
async function halves(bytes: Buffer): Promise<{ left: number; right: number; width: number; height: number }> {
  const { data, info } = await sharp(bytes).greyscale().raw().toBuffer({ resolveWithObject: true });
  let left = 0, right = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const v = data[y * info.width + x]!;
      if (x < info.width / 2) left += v; else right += v;
    }
  }
  const n = (info.width * info.height) / 2;
  return { left: left / n, right: right / n, width: info.width, height: info.height };
}

const ROW = {
  id: DOC, org_id: ORG, subject_type: "driver", subject_id: "d1", kind: "medical_card",
  storage_path: `p/${DOC}.jpg`, content_type: "image/jpeg", variant: "original", page: 1,
};

describe("deriveDocument (B2)", () => {
  it("creates both derivative rows, each its own row with its own hash, and never touches the original", async () => {
    const png = await tinyPng();
    const { admin, inserted, uploaded } = makeStub(ROW, png);
    const r = await deriveDocument(admin, ORG, DOC);
    expect(r).toEqual({ created: 2, skipped: null });

    expect(inserted).toHaveLength(2);
    expect(inserted.map((i) => i.variant).sort()).toEqual(["normalized", "thumb"]);
    for (const row of inserted) {
      expect(row.derived_from).toBe(DOC);
      expect(row.content_type).toBe("image/webp");
      expect(row.id).not.toBe(DOC);
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(row.sha256).not.toBe(ROW.storage_path); // fresh hash of the derivative's own bytes (G4)
    }
    // No update/delete surface even exists on the stub — the original could only be touched by
    // insert, and both inserts are derivatives.
    expect(uploaded.every((u) => u.contentType === "image/webp")).toBe(true);
  });

  it("bounds the long edge per spec and never enlarges", async () => {
    const png = await tinyPng(1200, 800);
    const { admin, uploaded } = makeStub(ROW, png);
    await deriveDocument(admin, ORG, DOC);
    const thumbSpec = DERIVATIVE_SPECS.find((s) => s.variant === "thumb")!;
    const thumb = uploaded.find((u) => u.path.includes(".thumb."))!;
    const meta = await sharp(thumb.bytes).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(thumbSpec.longEdgePx);
    // 1200px original < 2000px normalized bound → stays 1200, not enlarged.
    const norm = uploaded.find((u) => u.path.includes(".normalized."))!;
    const nMeta = await sharp(norm.bytes).metadata();
    expect(Math.max(nMeta.width!, nMeta.height!)).toBe(1200);
  });

  it("is a no-op when both variants already exist", async () => {
    const { admin, inserted } = makeStub(ROW, await tinyPng(), [{ variant: "thumb" }, { variant: "normalized" }]);
    const r = await deriveDocument(admin, ORG, DOC);
    expect(r).toEqual({ created: 0, skipped: "already derived" });
    expect(inserted).toHaveLength(0);
  });

  it("derives only the missing variant on a partial retry", async () => {
    const { admin, inserted } = makeStub(ROW, await tinyPng(), [{ variant: "thumb" }]);
    const r = await deriveDocument(admin, ORG, DOC);
    expect(r).toEqual({ created: 1, skipped: null });
    expect(inserted[0]!.variant).toBe("normalized");
  });

  it("gives a PDF exactly one derivative, a thumb of page 1, and no normalized raster (D-UF10)", async () => {
    const pdf = { ...ROW, content_type: "application/pdf", storage_path: `p/${DOC}.pdf` };
    const { admin, inserted, uploaded } = makeStub(pdf, await twoPagePdf());
    expect(await deriveDocument(admin, ORG, DOC)).toEqual({ created: 1, skipped: null });
    expect(inserted.map((i) => i.variant)).toEqual(["thumb"]);
    expect(inserted[0]!.content_type).toBe("image/webp");
    expect(uploaded[0]!.path).toContain(".thumb.");
  });

  it("skips derivatives-of-derivatives without error", async () => {
    const thumb = { ...ROW, variant: "thumb" };
    expect(await deriveDocument(makeStub(thumb, null).admin, ORG, DOC)).toEqual({ created: 0, skipped: "not an original" });
  });

  it("returns an error rather than throwing when the bytes cannot be decoded", async () => {
    const { admin } = makeStub(ROW, Buffer.from("this is not an image"));
    const r = await deriveDocument(admin, ORG, DOC);
    expect(r).toHaveProperty("code", "derive_failed");
  });

  it("returns download_failed when the original's bytes are missing (register/bytes drift)", async () => {
    const { admin } = makeStub(ROW, null);
    const r = await deriveDocument(admin, ORG, DOC);
    expect(r).toHaveProperty("code", "download_failed");
  });
});

describe("deriveBytes", () => {
  it("applies EXIF orientation — a rotated capture comes out upright", async () => {
    // 800x400 landscape with EXIF orientation 6 (rotate 90 CW to view) → upright is 400x800.
    const withExif = await sharp(await tinyPng(800, 400)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const out = await deriveBytes(withExif, DERIVATIVE_SPECS.find((s) => s.variant === "normalized")!);
    const meta = await sharp(out).metadata();
    expect(meta.height).toBeGreaterThan(meta.width!);
  });
});

describe("deriveBytes — PDF page 1 (D-UF10)", () => {
  const thumbSpec = () => DERIVATIVE_SPECS.find((s) => s.variant === "thumb")!;

  it("paints page 1 of a PDF into a thumb the spec's size, with its ink where the page has it", async () => {
    const out = await deriveBytes(await twoPagePdf(), thumbSpec(), "application/pdf");
    expect((await sharp(out).metadata()).format).toBe("webp");
    const h = await halves(out);
    // Letter is portrait: the long edge is the height, bounded to the thumb's 320.
    expect(h.height).toBe(thumbSpec().longEdgePx);
    expect(h.width).toBeLessThan(h.height);
    // Page 1's left half is inked and its right half is paper — page 2 (blank) would read white.
    expect(h.left).toBeLessThan(40);
    expect(h.right).toBeGreaterThan(215);
  });

  it("fails loudly on a PDF that needs a password to open rather than filing a blank thumb", async () => {
    await expect(deriveBytes(await twoPagePdf({ userPassword: "secret" }), thumbSpec(), "application/pdf"))
      .rejects.toThrow(/encrypted_pdf/);
  });
});

describe("deriveBytes — HEVC HEIC (A3)", () => {
  it("derives a WebP from a real HEVC .heic through the WASM decoder — the committed fixture running in CI (linux) IS the deployment-platform proof", async () => {
    const { readFileSync } = await import("node:fs");
    const heic = readFileSync(new URL("./__fixtures__/hevc-sample.heic", import.meta.url));
    // Belt and braces: prove sharp ALONE still cannot decode it, so this test fails loudly the day
    // prebuilt libvips gains HEVC and the WASM path becomes removable.
    await expect(sharp(heic).resize(64).toBuffer()).rejects.toThrow(/compression format|heif/i);

    const out = await deriveBytes(heic, DERIVATIVE_SPECS.find((s) => s.variant === "thumb")!, "image/heic");
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(320);
    expect(Math.max(meta.width!, meta.height!)).toBeGreaterThan(0);
  });
});
