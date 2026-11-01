import { describe, expect, it } from "vitest";
import {
  APPLICANT_DOCUMENT_KINDS,
  APPLICANT_DOCUMENT_SLOTS,
  applicantDocumentKind,
  applicantDocumentSlot,
  applicantDocumentUploadSchema,
} from "./applicantDocumentsContract.js";
import { APPLICATION_CAPTURE_REQUESTED } from "./applicationCaptureContract.js";
import { isRestrictedQualificationKind } from "./auth.js";

/** §9 P9: the office's upload offers the applicant's own list, and composes the kind from it. */
describe("the office's upload on the applicant's record", () => {
  const BODY = { document_id: "11111111-2222-4333-8444-555555555555", content_type: "application/pdf", sha256: "a1".repeat(32) };

  it("offers exactly the applicant's list — one list for both sides", () => {
    expect(APPLICANT_DOCUMENT_SLOTS).toEqual(APPLICATION_CAPTURE_REQUESTED);
  });

  it("takes a slot and never a kind — a caller cannot name what the paper is filed as", () => {
    expect(applicantDocumentUploadSchema.safeParse({ ...BODY, slot: "twic" }).success).toBe(true);
    expect(applicantDocumentUploadSchema.safeParse({ ...BODY, slot: "drug_test" }).success).toBe(false);
    expect(applicantDocumentUploadSchema.safeParse({ ...BODY, slot: "selfie" }).success).toBe(false);
    expect(applicantDocumentKind("passport")).toBe("passport");
  });

  it("produces no restricted kind — nothing on the list is a testing or investigation record", () => {
    for (const kind of APPLICANT_DOCUMENT_KINDS) expect(isRestrictedQualificationKind(kind), kind).toBe(false);
  });

  it("names a filed paper by the slot it answers, the licence's back by its page", () => {
    expect(applicantDocumentSlot("cdl", 2)).toBe("cdl_back");
    expect(applicantDocumentSlot("cdl", 1)).toBe("cdl_front");
    expect(applicantDocumentSlot("training_certificate", 1)).toBe("training_certificate");
    expect(applicantDocumentSlot("mvr", 1)).toBeNull();
  });
});
