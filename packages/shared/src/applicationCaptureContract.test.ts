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
  NEVER_PROMOTED_CAPTURE_SLOTS,
  applicationCaptureStoragePath,
  isPromotedCaptureSlot,
  APPLICATION_CAPTURE_MAX_PER_SLOT,
  APPLICATION_ONLY_CAPTURE_SLOTS,
  IMAGE_ONLY_CAPTURE_SLOTS,
  MULTI_DOCUMENT_CAPTURE_SLOTS,
  PART_ONE_CAPTURE_SLOTS,
  captureAcceptsContentType,
} from "./applicationCaptureContract.js";
import { APPLICANT_PAPER_KINDS } from "./complianceContract.js";
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
  it("maps every promoted slot to a kind `documents` will actually accept", () => {
    for (const slot of APPLICATION_CAPTURE_SLOTS.filter(isPromotedCaptureSlot)) {
      const kind = APPLICATION_CAPTURE_DOCUMENT_KIND[slot];
      expect(kind, slot).toBeTruthy();
      expect(DOCUMENT_KINDS as readonly string[]).toContain(kind);
    }
  });

  it("ships a label for every slot, and a page for every promoted one", () => {
    for (const slot of APPLICATION_CAPTURE_SLOTS) {
      expect(APPLICATION_CAPTURE_SLOT_LABELS[slot], slot).toBeTruthy();
      if (isPromotedCaptureSlot(slot)) expect(APPLICATION_CAPTURE_PAGE[slot], slot).toBeGreaterThanOrEqual(1);
    }
  });

  /** AW6: a selfie is never evidence — `documents` would keep it forever (see the slot's note). */
  it("never promotes the selfie, and has no kind or page to file it under", () => {
    expect(NEVER_PROMOTED_CAPTURE_SLOTS).toEqual(["selfie"]);
    expect(isPromotedCaptureSlot("selfie")).toBe(false);
    expect(isPromotedCaptureSlot("cdl_front")).toBe(true);
    expect(Object.keys(APPLICATION_CAPTURE_DOCUMENT_KIND)).not.toContain("selfie");
    expect(Object.keys(APPLICATION_CAPTURE_PAGE)).not.toContain("selfie");
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
    expect(applicationCaptureStartSchema.safeParse({ slot: "selfie", content_type: "application/pdf" }).success)
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

/**
 * §9 P9 (HIRING-WORKFLOW-AUDIT-2026-10-31 §4.7), the reader of 0534: every paper offered, each a photo or
 * a PDF, several of the ones that come in several — and the same limits as 0534's three CHECKs.
 */
describe("every document an applicant may have (§9 P9)", () => {
  const SHA = "a1".repeat(32);
  const NEW_SLOTS = ["twic", "passport", "work_authorization", "hazmat_endorsement", "road_test_certificate", "training_certificate"] as const;

  it("offers every slot on the documents list, the licence first and Part 1's sides never re-asked", () => {
    for (const slot of [...NEW_SLOTS, "medical_card", "ssn_card", "other"] as const) {
      expect(APPLICATION_CAPTURE_REQUESTED, slot).toContain(slot);
    }
    expect(APPLICATION_CAPTURE_REQUESTED.slice(0, 2)).toEqual(PART_ONE_CAPTURE_SLOTS);
  });

  it("takes every new slot as a photo and as a PDF, through both requests", () => {
    for (const slot of NEW_SLOTS) {
      for (const content_type of ["image/webp", "application/pdf"] as const) {
        expect(applicationCaptureStartSchema.safeParse({ slot, content_type }).success, `${slot} ${content_type}`).toBe(true);
        expect(applicationCaptureConfirmSchema.safeParse({ slot, content_type, sha256: SHA }).success, `${slot} ${content_type}`).toBe(true);
      }
    }
  });

  it("takes a PDF for every slot but the three that are pictures by nature", () => {
    expect(IMAGE_ONLY_CAPTURE_SLOTS).toEqual(["selfie", "signature_mark", "initials_mark"]);
    for (const slot of APPLICATION_CAPTURE_SLOTS) {
      expect(captureAcceptsContentType(slot, "application/pdf"), slot).toBe(!IMAGE_ONLY_CAPTURE_SLOTS.includes(slot));
      expect(captureAcceptsContentType(slot, "image/jpeg"), slot).toBe(true);
    }
    expect(applicationCaptureConfirmSchema.safeParse({ slot: "signature_mark", content_type: "application/pdf", sha256: SHA }).success).toBe(false);
    expect(applicationCaptureStoragePath("o", "i", "c", "application/pdf")).toBe("o/i/c.pdf");
  });

  it("keeps several training certificates — up to five — and one of everything else", () => {
    const confirm = (slot: string, ordinal: number) =>
      applicationCaptureConfirmSchema.safeParse({ slot, content_type: "application/pdf", sha256: SHA, ordinal }).success;
    expect(MULTI_DOCUMENT_CAPTURE_SLOTS).toEqual(["training_certificate", "road_test_certificate", "other"]);
    for (const slot of MULTI_DOCUMENT_CAPTURE_SLOTS) {
      expect(confirm(slot, APPLICATION_CAPTURE_MAX_PER_SLOT - 1), slot).toBe(true);
      expect(confirm(slot, APPLICATION_CAPTURE_MAX_PER_SLOT), slot).toBe(false);
    }
    expect(confirm("passport", 0)).toBe(true);
    expect(confirm("passport", 1)).toBe(false);
    // A page served before P9 sends no ordinal: it means 0, the only one there was.
    const parsed = applicationCaptureConfirmSchema.parse({ slot: "cdl_front", content_type: "image/webp", sha256: SHA });
    expect(parsed.ordinal).toBe(0);
  });

  it("files each new paper under a kind of its own, and the SSN card no longer as `other`", () => {
    expect(APPLICATION_CAPTURE_DOCUMENT_KIND.ssn_card).toBe("ssn_card");
    expect(APPLICATION_CAPTURE_DOCUMENT_KIND.passport).toBe("passport");
    expect(APPLICATION_CAPTURE_DOCUMENT_KIND.twic).toBe("twic");
    expect(APPLICATION_CAPTURE_DOCUMENT_KIND.hazmat_endorsement).toBe("endorsement");
    for (const kind of APPLICANT_PAPER_KINDS) {
      expect(Object.values(APPLICATION_CAPTURE_DOCUMENT_KIND), kind).toContain(kind);
    }
  });

  it("asks for the new papers only once the office has sent the application", () => {
    for (const slot of [...NEW_SLOTS, "other"] as const) expect(APPLICATION_ONLY_CAPTURE_SLOTS, slot).toContain(slot);
    for (const slot of PART_ONE_CAPTURE_SLOTS) expect(APPLICATION_ONLY_CAPTURE_SLOTS, slot).not.toContain(slot);
  });
});
