import { describe, expect, it } from "vitest";
import { SIGNATURE_ADOPTION_MAX_BYTES, signatureAdoptionRequestSchema } from "./signatureAdoptionContract.js";

describe("signatureAdoptionRequestSchema (D-AW15)", () => {
  const ok = { kind: "signature", typed_text: "Susan Godfrey", png_base64: "iVBORw0KGgo=" };

  it("takes the two kinds 0376 allows, and nothing else", () => {
    expect(signatureAdoptionRequestSchema.safeParse(ok).success).toBe(true);
    expect(signatureAdoptionRequestSchema.safeParse({ ...ok, kind: "initials" }).success).toBe(true);
    expect(signatureAdoptionRequestSchema.safeParse({ ...ok, kind: "stamp" }).success).toBe(false);
  });

  it("trims the typed text and holds it to 0376's 1–200", () => {
    expect(signatureAdoptionRequestSchema.parse({ ...ok, typed_text: "  SG " }).typed_text).toBe("SG");
    expect(signatureAdoptionRequestSchema.safeParse({ ...ok, typed_text: "   " }).success).toBe(false);
    expect(signatureAdoptionRequestSchema.safeParse({ ...ok, typed_text: "x".repeat(201) }).success).toBe(false);
  });

  it("takes a picture up to the ceiling, encoded, and refuses one past it", () => {
    const at = "A".repeat(Math.ceil(SIGNATURE_ADOPTION_MAX_BYTES / 3) * 4);
    expect(signatureAdoptionRequestSchema.safeParse({ ...ok, png_base64: at }).success).toBe(true);
    expect(signatureAdoptionRequestSchema.safeParse({ ...ok, png_base64: `${at}AAAA` }).success).toBe(false);
  });

  it("never takes a storage key: the server builds it (SA022)", () => {
    const parsed = signatureAdoptionRequestSchema.parse({ ...ok, storage_path: "other/driver/x/y.png" });
    expect(parsed).not.toHaveProperty("storage_path");
  });
});
