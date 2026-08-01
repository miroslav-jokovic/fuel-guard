import { describe, expect, it } from "vitest";
import {
  buildHazmatAttestation,
  checkHazmatClear,
  hazmatHasViolation,
  hazmatUnclearableReason,
  HAZMAT_ATTESTATION_TEXT,
} from "./hazmatReview.js";

const base = { datasetProvisional: false, specialPermits: [] as string[], overrideReason: null as string | null, spAcknowledged: false };

describe("hazmatReview — violation + unusable classification", () => {
  it("real regulatory violations are override-able", () => {
    expect(hazmatHasViolation(["eligibility_blocked"])).toBe(true);
    expect(hazmatHasViolation(["violation:cleaned_tank"])).toBe(true);
    expect(hazmatHasViolation(["segregation:x"])).toBe(true);
  });
  it("provisional + conditional flags are NOT override-able violations", () => {
    expect(hazmatHasViolation(["dataset_provisional"])).toBe(false);
    expect(hazmatHasViolation(["eligibility_not_checked", "lines_unconfirmed"])).toBe(false);
  });
  it("unusable-read flags mean there is nothing to attest to", () => {
    for (const f of ["recapture_needed", "extraction_failed", "no_documents", "document_unreadable"]) {
      expect(hazmatUnclearableReason([f])).toBeTruthy();
    }
    expect(hazmatUnclearableReason(["eligibility_not_checked"])).toBeNull();
  });
});

describe("checkHazmatClear — the server-enforced gate (D2/D8)", () => {
  it("a clean flagged load clears on the base attestation alone", () => {
    expect(checkHazmatClear({ ...base, flags: ["eligibility_not_checked"] }).ok).toBe(true);
  });

  it("a provisional dataset hard-blocks, even with an override + SP ack", () => {
    const r = checkHazmatClear({ ...base, flags: ["eligibility_blocked"], datasetProvisional: true, specialPermits: ["DOT-SP 1"], overrideReason: "x".repeat(30), spAcknowledged: true });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("provisional_dataset");
  });

  it("an unusable read cannot be override-cleared — must reject/re-run", () => {
    const r = checkHazmatClear({ ...base, flags: ["extraction_failed"], overrideReason: "x".repeat(30) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("document_unusable");
  });

  it("a violation demands an override reason >= 20 chars", () => {
    expect(checkHazmatClear({ ...base, flags: ["eligibility_blocked"] }).code).toBe("override_required");
    expect(checkHazmatClear({ ...base, flags: ["eligibility_blocked"], overrideReason: "too short" }).code).toBe("override_required");
    expect(checkHazmatClear({ ...base, flags: ["eligibility_blocked"], overrideReason: "this genuinely covers it" }).ok).toBe(true);
  });

  it("a special-permit load can NEVER clear on the standard attestation alone", () => {
    expect(checkHazmatClear({ ...base, flags: [], specialPermits: ["DOT-SP 12345"] }).code).toBe("sp_attestation_required");
    expect(checkHazmatClear({ ...base, flags: [], specialPermits: ["DOT-SP 12345"], spAcknowledged: true }).ok).toBe(true);
  });

  it("SP + violation both required together", () => {
    const r = checkHazmatClear({ ...base, flags: ["violation:x"], specialPermits: ["DOT-SP 1"], spAcknowledged: true, overrideReason: "covers the deviation fully" });
    expect(r.ok).toBe(true);
    expect(r.requiresOverride && r.requiresSpAttestation).toBe(true);
  });
});

describe("buildHazmatAttestation", () => {
  it("appends SP + override text to the exact base string", () => {
    const check = checkHazmatClear({ ...base, flags: ["eligibility_blocked"], specialPermits: ["DOT-SP 12345"], spAcknowledged: true, overrideReason: "shipper confirmed the permit covers this" });
    const s = buildHazmatAttestation(check, ["DOT-SP 12345"], "shipper confirmed the permit covers this");
    expect(s.startsWith(HAZMAT_ATTESTATION_TEXT)).toBe(true);
    expect(s).toContain("DOT-SP 12345");
    expect(s).toContain("OVERRIDE: shipper confirmed the permit covers this");
  });
});
