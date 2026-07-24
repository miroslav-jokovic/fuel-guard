import { describe, it, expect } from "vitest";
import { classifyDeclineReason, countDeclineCategories } from "./declineReason.js";

// Every verbatim phrase below is from real EFS data: data-samples/RejectTransactionReport-260707092249.xlsx
// or the 0851226257 proximity case (docs/plans/ALERTS-DECLINES-AUDIT.md).
describe("classifyDeclineReason — real EFS phrasings", () => {
  it("proximity failure is alert-grade (the 0851226257 case: Clear → Alert)", () => {
    const r = classifyDeclineReason("1", "INVALID TRUCKSTOP IN0851226257|Merchant Position Too Far|");
    expect(r.category).toBe("proximity_failure");
    expect(r.weight).toBeGreaterThanOrEqual(75); // ≥ OVERWHELMING → alert on its own
  });
  it("EFS alert wording variants classify as proximity", () => {
    expect(classifyDeclineReason(null, "Failed Proximity Validation").category).toBe("proximity_failure");
    expect(classifyDeclineReason(null, "POSITION TOO FAR").category).toBe("proximity_failure");
  });
  it("INVALID TRUCKSTOP with 'Failed restrictions' is a benign site restriction — the qualifier decides", () => {
    const r = classifyDeclineReason("1", "INVALID TRUCKSTOP IN53790|Failed restrictions|");
    expect(r.category).toBe("site_restriction");
    expect(r.weight).toBe(30);
  });
  it("inactive card is its own (weak) category", () => {
    const r = classifyDeclineReason("3", "INACTIVE CARD IN0873548890|Non-Active Card|");
    expect(r.category).toBe("card_not_active");
    expect(r.weight).toBe(10);
  });
  it("pump-prompt mismatches (odometer / driver id) are data-quality, weight 0", () => {
    expect(classifyDeclineReason("17", "INVALID INFORMATION|ODOMETER|8757 IN0819233740||").category).toBe("invalid_info");
    expect(classifyDeclineReason("17", "INVALID INFORMATION|DRIVER ID|ODOMETER||").category).toBe("invalid_info");
  });
  it("limit exceeded stays restriction-weight", () => {
    const r = classifyDeclineReason(null, "DAILY LIMIT EXCEEDED");
    expect(r.category).toBe("limit");
    expect(r.weight).toBe(30);
  });
  it("unknown phrasing is NEVER silently benign — it is named 'unknown' so it can be surfaced", () => {
    const r = classifyDeclineReason("99", "SOME BRAND NEW EFS PHRASING");
    expect(r.category).toBe("unknown");
    expect(r.weight).toBe(0);
    expect(classifyDeclineReason(null, null).category).toBe("unknown");
  });
});

describe("countDeclineCategories", () => {
  it("counts per category (the observability surface)", () => {
    const counts = countDeclineCategories([
      { error_code: "1", error_description: "INVALID TRUCKSTOP|Merchant Position Too Far|" },
      { error_code: "1", error_description: "INVALID TRUCKSTOP|Failed restrictions|" },
      { error_code: "3", error_description: "INACTIVE CARD" },
      { error_code: "99", error_description: "???" },
    ]);
    expect(counts.proximity_failure).toBe(1);
    expect(counts.site_restriction).toBe(1);
    expect(counts.card_not_active).toBe(1);
    expect(counts.unknown).toBe(1);
  });
});
