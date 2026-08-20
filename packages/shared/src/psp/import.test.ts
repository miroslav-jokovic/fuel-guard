import { describe, it, expect } from "vitest";
import {
  PSP_IMPORT_CONSENT_ATTESTATION,
  PSP_IMPORT_RESULT,
  PSP_PROGRAM_START,
  pspImportDetail,
  pspImportSchema,
  pspImportUploadSchema,
  validatePspImport,
  type PspImport,
} from "./import.js";
import { isImportedPspRecord } from "./provenance.js";

const TODAY = "2026-08-19";

// Spread, not `??` per field — the same trap this module's siblings document: `note: over.note ??
// null` would restore the default when a test passes an explicit value it wants tested.
const imp = (over: Partial<PspImport> = {}): PspImport => ({
  driver_id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
  document_id: "22222222-3333-4444-8555-666666666666",
  obtained_on: "2025-06-02",
  consent_obtained: true,
  ...over,
});

describe("the dates an imported record may carry", () => {
  it("accepts a record obtained today or any day since PSP opened", () => {
    expect(validatePspImport(imp({ obtained_on: TODAY }), TODAY)).toEqual([]);
    expect(validatePspImport(imp({ obtained_on: PSP_PROGRAM_START }), TODAY)).toEqual([]);
  });

  it("refuses a record obtained tomorrow", () => {
    expect(validatePspImport(imp({ obtained_on: "2026-08-20" }), TODAY).map((i) => i.field)).toEqual(["obtained_on"]);
  });

  /** The mistyped-century case the bound exists for: 1011-03-04 is a date Postgres stores happily. */
  it("refuses a date before the programme existed", () => {
    const issues = validatePspImport(imp({ obtained_on: "1011-03-04" }), TODAY);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("May 2010");
  });
});

describe("what the request may and may not say", () => {
  it("refuses an import that does not assert consent", () => {
    expect(pspImportSchema.safeParse({ ...imp(), consent_obtained: false }).success).toBe(false);
    const { consent_obtained: _omitted, ...withoutConsent } = imp();
    expect(pspImportSchema.safeParse(withoutConsent).success).toBe(false);
  });

  /** The kind carries the §391.53(a)(1) read restriction (0217), so the client never chooses it. */
  it("gives the upload request no way to name a document kind", () => {
    const parsed = pspImportUploadSchema.safeParse({
      driver_id: imp().driver_id,
      document_id: imp().document_id,
      sha256: "a".repeat(64),
      kind: "other",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "kind" in parsed.data).toBe(false);
  });

  it("requires a real content hash", () => {
    const base = { driver_id: imp().driver_id, document_id: imp().document_id };
    expect(pspImportUploadSchema.safeParse({ ...base, sha256: "A".repeat(64) }).success).toBe(false);
    expect(pspImportUploadSchema.safeParse({ ...base, sha256: "abc" }).success).toBe(false);
  });
});

describe("what an imported record claims about the driver", () => {
  /**
   * The rule this whole module is built around (D-PSP5, D-PSP9). Zero inspections is a claim; an
   * absent count is not. A UI or a cross-check reading `detail.inspections` off an imported row
   * would be reading a number nobody produced.
   */
  it("records no inspection or crash counts, because nothing read the PDF", () => {
    const detail = pspImportDetail(imp(), "u-recruiter");
    expect(detail).not.toHaveProperty("inspections");
    expect(detail).not.toHaveProperty("crashes");
    expect(detail).not.toHaveProperty("summary");
    expect(detail.structured).toBe(false);
  });

  it("names who attested the consent, and stores the words they attested to", () => {
    const detail = pspImportDetail(imp(), "u-recruiter");
    expect(detail.consent_attested_by).toBe("u-recruiter");
    expect(detail.consent_attestation).toBe(PSP_IMPORT_CONSENT_ATTESTATION);
  });

  it("keeps an operator note only when there is one", () => {
    expect(pspImportDetail(imp({ note: "  " }), "u")).not.toHaveProperty("note");
    expect(pspImportDetail(imp({ note: " from the 2025 folder " }), "u").note).toBe("from the 2025 folder");
  });

  it("states its provenance rather than the operator's reading of the report", () => {
    expect(PSP_IMPORT_RESULT).toBe("imported");
    expect(isImportedPspRecord(pspImportDetail(imp(), "u"))).toBe(true);
    // An ordered record's detail (pspOrder.ts) has no `source`, and must not be mistaken for one.
    expect(isImportedPspRecord({ summary: {}, inspections: 3, crashes: 0 })).toBe(false);
    expect(isImportedPspRecord(null)).toBe(false);
  });
});
