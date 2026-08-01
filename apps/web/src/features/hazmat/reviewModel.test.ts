import { describe, expect, it } from "vitest";
import { deriveReviewItems, hasViolation, labelForFlag } from "./reviewModel";

// The clearing RULES are tested in @fuelguard/shared (hazmatReview.test.ts); here we cover the UI-only
// flag → review-item mapping, and re-confirm the re-exported violation classifier is wired through.

describe("reviewModel — flag → review items (UI)", () => {
  it("maps known codes and orders violations first", () => {
    const items = deriveReviewItems(["eligibility_not_checked", "violation:cleaned_tank", "has_preprinted_lines"]);
    expect(items[0]!.tier).toBe("violation");
    expect(items.map((i) => i.code)).toContain("violation:cleaned_tank");
  });
  it("labels prefixed codes readably with the right tier", () => {
    expect(labelForFlag("pass_disagreement:idNumber:line1").tier).toBe("conditional");
    expect(labelForFlag("segregation:incompatible").tier).toBe("violation");
    expect(labelForFlag("line_unresolved:psn_no_match").tier).toBe("violation");
  });
  it("unknown codes fall back to a readable conditional (never hidden)", () => {
    expect(labelForFlag("some_new_flag")).toMatchObject({ tier: "conditional", label: "some new flag" });
  });
  it("re-exports the shared violation classifier", () => {
    expect(hasViolation(["eligibility_blocked"])).toBe(true);
    expect(hasViolation(["dataset_provisional"])).toBe(false);
  });
});
