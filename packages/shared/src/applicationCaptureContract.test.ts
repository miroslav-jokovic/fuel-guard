import { describe, it, expect } from "vitest";
import {
  APPLICATION_CAPTURE_CONTENT_TYPES,
  APPLICATION_CAPTURE_DOCUMENT_KIND,
  APPLICATION_CAPTURE_EXTENSIONS,
  APPLICATION_CAPTURE_MARK_SLOT,
  APPLICATION_CAPTURE_PAGE,
  APPLICATION_CAPTURE_REQUESTED,
  APPLICATION_CAPTURE_SLOTS,
  APPLICATION_CAPTURE_SLOT_LABELS,
  applicationCaptureConfirmSchema,
  applicationCaptureStartSchema,
  applicationCaptureStoragePath,
} from "./applicationCaptureContract.js";
import { DOCUMENT_CONTENT_TYPES, DOCUMENT_KINDS } from "./complianceContract.js";
import { PACKET_MARK_KINDS } from "./packetPlacements.js";

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

  /**
   * The signing ceremony writes them, not the capture screen — see the contract's own note.
   *
   * ⚠ **`initials_mark` was the one addition Q-HUI14's writer half had to be careful NOT to make.**
   * This list drives the capture screen, `reviewSummary.ts` and `ApplyExpectations.vue`, so an entry
   * here would have asked every applicant to photograph their own initials — and the mark is produced
   * by the ceremony in the browser, so what it would collect is a photograph of a piece of paper.
   *
   * ⚠ Written over the MARK SLOTS rather than as two string literals, so a third kind of mark cannot
   * be added to the storage vocabulary and quietly appear on the capture screen.
   */
  it("does not ask the driver to photograph either of their adopted marks", () => {
    for (const slot of Object.values(APPLICATION_CAPTURE_MARK_SLOT)) {
      expect(APPLICATION_CAPTURE_REQUESTED, slot).not.toContain(slot);
    }
    expect(APPLICATION_CAPTURE_REQUESTED).not.toContain("other");
    for (const slot of APPLICATION_CAPTURE_REQUESTED) {
      expect(APPLICATION_CAPTURE_SLOTS as readonly string[]).toContain(slot);
    }
  });

  /**
   * ⚠ **Every kind of mark the carrier's paper asks for has its own slot, and no two share one**
   * (Q-HUI14, D-PKT6).
   *
   * `application_captures` holds ONE ROW PER SLOT (0230's unique index), so two kinds of mark mapped
   * to the same slot would overwrite each other: adopting initials would silently delete the signature
   * picture, and the packet would file nineteen typed lines beside three drawn ones. ⚠ The totality is
   * what makes it worth a test — a third kind of mark on somebody's paper cannot compile until it has
   * been given a slot, and this is where the DISTINCTNESS is checked, which the type cannot express.
   */
  it("gives every kind of mark its own slot, because one row per slot means sharing overwrites", () => {
    const slots = Object.values(APPLICATION_CAPTURE_MARK_SLOT);
    expect(slots).toHaveLength(PACKET_MARK_KINDS.length);
    expect(new Set(slots).size).toBe(slots.length);
    for (const kind of PACKET_MARK_KINDS) {
      const slot = APPLICATION_CAPTURE_MARK_SLOT[kind];
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
