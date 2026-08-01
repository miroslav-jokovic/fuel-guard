import { describe, expect, it } from "vitest";
import {
  ATTESTATION_TEXT,
  buildAttestation,
  canSubmitClear,
  clearGate,
  deriveReviewItems,
  hasViolation,
  labelForFlag,
} from "./reviewModel";

describe("reviewModel — flag → review items", () => {
  it("maps known codes and orders violations first", () => {
    const items = deriveReviewItems(["eligibility_not_checked", "violation:cleaned_tank", "has_preprinted_lines"]);
    expect(items[0]!.tier).toBe("violation");
    expect(items.map((i) => i.code)).toContain("violation:cleaned_tank");
  });
  it("labels prefixed codes readably", () => {
    expect(labelForFlag("pass_disagreement:idNumber:line1").tier).toBe("conditional");
    expect(labelForFlag("segregation:incompatible").tier).toBe("violation");
  });
  it("unknown codes fall back to a readable conditional (never hidden)", () => {
    expect(labelForFlag("some_new_flag")).toMatchObject({ tier: "conditional", label: "some new flag" });
  });
  it("a provisional-dataset flag is not an OVERRIDE-able violation (it's a hard block)", () => {
    expect(hasViolation(["dataset_provisional"])).toBe(false);
    expect(hasViolation(["eligibility_blocked"])).toBe(true);
  });
});

describe("reviewModel — clearing gate (D2/D8)", () => {
  it("a provisional dataset hard-blocks clearing regardless of attestation", () => {
    const gate = clearGate(["eligibility_not_checked"], true, []);
    expect(gate.canAttest).toBe(false);
    expect(gate.hardBlockReason).toMatch(/provisional/i);
    expect(canSubmitClear(gate, { attested: true, spAttested: true, overrideReason: "x".repeat(30) })).toBe(false);
  });

  it("a clean-ish flagged load clears on the base attestation alone", () => {
    const gate = clearGate(["eligibility_not_checked"], false, []);
    expect(gate.requiresOverride).toBe(false);
    expect(canSubmitClear(gate, { attested: false, spAttested: false, overrideReason: "" })).toBe(false);
    expect(canSubmitClear(gate, { attested: true, spAttested: false, overrideReason: "" })).toBe(true);
  });

  it("a violation requires an override reason of >= 20 chars", () => {
    const gate = clearGate(["eligibility_blocked"], false, []);
    expect(gate.requiresOverride).toBe(true);
    expect(canSubmitClear(gate, { attested: true, spAttested: false, overrideReason: "too short" })).toBe(false);
    expect(canSubmitClear(gate, { attested: true, spAttested: false, overrideReason: "this genuinely covers it" })).toBe(true);
  });

  it("a special-permit load additionally requires the SP attestation", () => {
    const gate = clearGate(["eligibility_not_checked"], false, ["DOT-SP 12345"]);
    expect(gate.requiresSpAttestation).toBe(true);
    expect(canSubmitClear(gate, { attested: true, spAttested: false, overrideReason: "" })).toBe(false);
    expect(canSubmitClear(gate, { attested: true, spAttested: true, overrideReason: "" })).toBe(true);
  });

  it("buildAttestation appends SP + override text to the exact base string", () => {
    const gate = clearGate(["eligibility_blocked"], false, ["DOT-SP 12345"]);
    const s = buildAttestation(gate, { attested: true, spAttested: true, overrideReason: "shipper confirmed the permit covers this" }, ["DOT-SP 12345"]);
    expect(s.startsWith(ATTESTATION_TEXT)).toBe(true);
    expect(s).toContain("DOT-SP 12345");
    expect(s).toContain("OVERRIDE: shipper confirmed the permit covers this");
  });
});
