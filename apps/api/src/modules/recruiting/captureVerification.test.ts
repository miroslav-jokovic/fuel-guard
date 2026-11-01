import { createHash } from "node:crypto";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { CAPTURE_MAX_PIXELS, verifyCaptureBytes } from "./captureVerification.js";

/**
 * The server's reading of one capture (D-AW9) — and, since the 2026-10-20 audit, the ceiling on
 * how big a picture it will decode (`CAPTURE_MAX_PIXELS`).
 *
 * ⚠ The ceiling is proved with a 3 × 3 picture and a ceiling of 4, through the parameter that
 * exists for exactly this: encoding a 36-megapixel PNG to prove the real number would cost the
 * test suite the memory the ceiling exists to protect. What the small picture proves is the
 * MECHANISM — the header is read before a pixel is decoded, and a picture over the line is refused
 * by name. The real number is pinned separately, as a number.
 */

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

let tiny: Buffer;
beforeAll(async () => {
  const px = Buffer.alloc(3 * 3 * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 29) % 251;
  tiny = await sharp(px, { raw: { width: 3, height: 3, channels: 3 } }).png().toBuffer();
});

describe("what it refuses, and why", () => {
  it("refuses a picture over the pixel ceiling before decoding it, by name", async () => {
    const result = await verifyCaptureBytes(tiny, sha(tiny), "cdl_front", "image/png", 4);
    expect(result).toMatchObject({ ok: false, reason: "too_many_pixels" });
  });

  it("takes the same picture under the ceiling, and measures it", async () => {
    const result = await verifyCaptureBytes(tiny, sha(tiny), "cdl_front", "image/png", 9);
    expect(result).toMatchObject({ ok: true, bytes: tiny.byteLength });
    expect(result.ok && result.metrics?.configVersion).toBeTruthy();
  });

  it("takes an ordinary capture under the shipped ceiling", async () => {
    const result = await verifyCaptureBytes(tiny, sha(tiny), "cdl_front", "image/png");
    expect(result.ok).toBe(true);
  });

  it("refuses bytes that are not a picture — the header gives no size", async () => {
    const junk = Buffer.from("not a picture at all");
    expect(await verifyCaptureBytes(junk, sha(junk), "cdl_front", "image/png")).toMatchObject({ ok: false, reason: "not_an_image" });
  });

  it("refuses a hash that is not the bytes', before looking at the picture", async () => {
    expect(await verifyCaptureBytes(tiny, "0".repeat(64), "cdl_front", "image/png")).toMatchObject({ ok: false, reason: "hash_mismatch" });
  });
});

/** §9 P9: a PDF is sent as the driver holds it — checked for its hash and its signature, never decoded. */
describe("a PDF", () => {
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

  it("takes a PDF whose bytes are the ones sent, and measures nothing — a scan has no camera", async () => {
    const result = await verifyCaptureBytes(pdf, sha(pdf), "training_certificate", "application/pdf");
    expect(result).toMatchObject({ ok: true, bytes: pdf.byteLength, metrics: null });
  });

  it("refuses bytes sent as a PDF that are not one", async () => {
    expect(await verifyCaptureBytes(tiny, sha(tiny), "medical_card", "application/pdf")).toMatchObject({ ok: false, reason: "not_a_pdf" });
  });

  it("refuses a PDF whose hash is not the bytes'", async () => {
    expect(await verifyCaptureBytes(pdf, "0".repeat(64), "passport", "application/pdf")).toMatchObject({ ok: false, reason: "hash_mismatch" });
  });
});

describe("the shipped ceiling", () => {
  it("is thirty-six million pixels — a 6,000 × 6,000 frame, three times the provider's own output", () => {
    expect(CAPTURE_MAX_PIXELS).toBe(36_000_000);
    // And under sharp's default (~268 million), or the parameter would not be a ceiling at all.
    expect(CAPTURE_MAX_PIXELS).toBeLessThan(268_402_689);
  });
});
