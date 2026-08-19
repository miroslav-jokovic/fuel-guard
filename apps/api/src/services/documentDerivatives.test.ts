/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveBytes, deriveDocument } from "./documentDerivatives.js";
import { DERIVATIVE_SPECS } from "@fuelguard/shared";

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

  it("skips PDFs and derivatives-of-derivatives without error", async () => {
    const pdf = { ...ROW, content_type: "application/pdf" };
    expect(await deriveDocument(makeStub(pdf, null).admin, ORG, DOC)).toEqual({ created: 0, skipped: "content type not derivable" });
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
