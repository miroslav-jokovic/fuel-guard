import { describe, it, expect } from "vitest";
import {
  APPLICATION_CAPTURE_CONTENT_TYPES,
  APPLICATION_CAPTURE_DOCUMENT_KIND,
  APPLICATION_CAPTURE_EXTENSIONS,
  APPLICATION_CAPTURE_PAGE,
  APPLICATION_CAPTURE_REQUESTED,
  APPLICATION_CAPTURE_SLOTS,
  APPLICATION_CAPTURE_SLOT_LABELS,
  applicationCaptureConfirmSchema,
  applicationCaptureStartSchema,
  applicationCaptureStoragePath,
} from "./applicationCaptureContract.js";
import { DOCUMENT_CONTENT_TYPES, DOCUMENT_KINDS } from "./complianceContract.js";

/**
 * The staging vocabulary, and the two promises it makes to the qualification file (A8).
 *
 * A slot is what an applicant is asked for; a kind is what the file calls the result. The mapping
 * between them is the only thing standing between an unauthenticated caller and the carrier's whole
 * filing vocabulary, so it is total, closed, and checked here rather than trusted.
 */

describe("the capture slot vocabulary", () => {
  it("maps every slot to a kind `documents` will actually accept", () => {
    for (const slot of APPLICATION_CAPTURE_SLOTS) {
      const kind = APPLICATION_CAPTURE_DOCUMENT_KIND[slot];
      expect(kind, slot).toBeTruthy();
      expect(DOCUMENT_KINDS as readonly string[]).toContain(kind);
    }
  });

  it("ships a label and a page for every slot", () => {
    for (const slot of APPLICATION_CAPTURE_SLOTS) {
      expect(APPLICATION_CAPTURE_SLOT_LABELS[slot], slot).toBeTruthy();
      expect(APPLICATION_CAPTURE_PAGE[slot], slot).toBeGreaterThanOrEqual(1);
    }
  });

  /** Two sides of one licence: one kind, two pages, so the pair stays ordered wherever it is listed. */
  it("files the back of a licence as page two of the same kind", () => {
    expect(APPLICATION_CAPTURE_DOCUMENT_KIND.cdl_back).toBe(APPLICATION_CAPTURE_DOCUMENT_KIND.cdl_front);
    expect(APPLICATION_CAPTURE_PAGE.cdl_front).toBe(1);
    expect(APPLICATION_CAPTURE_PAGE.cdl_back).toBe(2);
  });

  /** The signing ceremony writes it, not the capture screen — see the contract's own note. */
  it("does not ask the driver to photograph their signature", () => {
    expect(APPLICATION_CAPTURE_REQUESTED).not.toContain("signature_mark");
    expect(APPLICATION_CAPTURE_REQUESTED).not.toContain("other");
    for (const slot of APPLICATION_CAPTURE_REQUESTED) {
      expect(APPLICATION_CAPTURE_SLOTS as readonly string[]).toContain(slot);
    }
  });

  it("accepts only content types `documents` also accepts", () => {
    for (const type of APPLICATION_CAPTURE_CONTENT_TYPES) {
      expect(DOCUMENT_CONTENT_TYPES as readonly string[]).toContain(type);
      expect(APPLICATION_CAPTURE_EXTENSIONS[type]).toBeTruthy();
    }
  });
});

describe("the capture requests", () => {
  it("refuses a slot outside the closed set — the carrier's vocabulary is not the applicant's", () => {
    expect(applicationCaptureStartSchema.safeParse({ slot: "hazmat_training", content_type: "image/webp" }).success)
      .toBe(false);
    expect(applicationCaptureStartSchema.safeParse({ slot: "cdl_front", content_type: "application/pdf" }).success)
      .toBe(false);
    expect(applicationCaptureStartSchema.safeParse({ slot: "cdl_front", content_type: "image/webp" }).success)
      .toBe(true);
  });

  it("wants a real digest, not a promise of one", () => {
    const confirm = (sha256: string) =>
      applicationCaptureConfirmSchema.safeParse({ slot: "cdl_front", content_type: "image/webp", sha256 }).success;
    expect(confirm("abc")).toBe(false);
    // Upper case is not the same digest twice: one canonical form, or the column holds two.
    expect(confirm("A".repeat(64))).toBe(false);
    expect(confirm("a1".repeat(32))).toBe(true);
  });

  /** Keyed by the INVITATION: a staged object belongs to one session and dies with it. */
  it("keys the staged object by the session that produced it", () => {
    expect(applicationCaptureStoragePath("org-1", "inv-2", "cap-3", "image/webp")).toBe("org-1/inv-2/cap-3.webp");
    expect(applicationCaptureStoragePath("org-1", "inv-2", "cap-3", "image/jpeg")).toBe("org-1/inv-2/cap-3.jpg");
  });
});
