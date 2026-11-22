import { describe, expect, it } from "vitest";
import { AD_MONEY_PER } from "../../ads/contracts.js";
import { dollarsText, openingPayText, PAY_PER_LABEL } from "./openingText.js";

/** The careers page's pay sentence (APPLY-PAGE-PLAN AP3, D-AP2): what an applicant reads as the job's pay range. */
describe("openingPayText", () => {
  it("a range reads bottom to top with its unit; cents only when there are any", () => {
    expect(openingPayText({ per: "mile", min_cents: 62, max_cents: 70 })).toBe("$0.62–$0.70 per mile");
    expect(openingPayText({ per: "week", min_cents: 150_000, max_cents: 180_050 })).toBe("$1,500–$1,800.50 per week");
    expect(openingPayText({ per: "year", min_cents: 8_500_000, max_cents: 9_500_000 })).toBe("$85,000–$95,000 per year");
  });

  it("a range of one figure is that figure; a missing top says From rather than inventing one", () => {
    expect(openingPayText({ per: "hour", min_cents: 2_950, max_cents: 2_950 })).toBe("$29.50 per hour");
    expect(openingPayText({ per: "load", min_cents: 40_000, max_cents: null })).toBe("From $400 per load");
  });

  it("every pay basis the contract allows has words", () => {
    for (const per of AD_MONEY_PER) expect(openingPayText({ per, min_cents: 100, max_cents: 200 })).toBe(`$1–$2 ${PAY_PER_LABEL[per].toLowerCase()}`);
  });

  it("dollars: a whole amount has no cents, a part amount has two", () => {
    expect([dollarsText(5), dollarsText(100), dollarsText(123_456_78)]).toEqual(["$0.05", "$1", "$123,456.78"]);
  });
});
