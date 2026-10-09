import { describe, it, expect } from "vitest";
import { classifyDeclineReason, countDeclineCategories, plainDeclineReason } from "./declineReason.js";

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

/**
 * `plainDeclineReason` (F02-F04 chunk 14b, W7). Every input below is a description as production
 * stored it, read 2026-10-09; the expected text is what the Declines tab shows in its place.
 */
describe("plainDeclineReason — EFS's trace as one plain reason", () => {
  const cases: [string, string, string][] = [
    ["4", "INVALID CARD|GetCatScalesCard: no card found|", "Card number not recognized"],
    ["1", "INVALID TRUCKSTOP|Failed restrictions|", "Truck stop not allowed for this card"],
    ["1", "INVALID TRUCKSTOP IN39681|Failed restrictions|", "Truck stop not allowed for this card"],
    ["1", "INVALID TRUCKSTOP IN0900251718|Merchant Position Too Far|", "Truck was not near this truck stop"],
    ["2", "INVALID TRUCKSTOP FOR CUSTOMER IN3596585740|Location Check:ChkLocGrp|", "Truck stop not allowed for this company"],
    ["3", "INACTIVE CARD IN111111|Smartfunds Driver Profile Not Found|", "Card is not active"],
    ["3", "INACTIVE CARD IN0861769830|Non-Active Card|", "Card is not active"],
    ["55", "MAX AMOUNT EXCEEDED|MCodeAuth|", "Money code over its maximum amount"],
    ["68", "DAILY MONEY CODE LIMIT EXCEEDED|MCodeAuth|", "Daily money code limit reached"],
    ["19", "LIMIT EXCEEDED|SCALES|525|CheckItems|", "Limit reached: scales"],
    ["19", "LIMIT EXCEEDED|CASH ADVANCE|2400 IN4886423923|CheckItems|", "Limit reached: cash advance"],
    ["25", "LIMIT EXCEEDED IN533242078|CheckItems|ULSD |", "Limit reached: diesel"],
    ["18", "ITEM NOT ALLOWED|OIL|SCALES IN3951403734|CheckItems|", "Not allowed on this card: oil, scales"],
    ["18", "ITEM NOT ALLOWED|DIESEL EXHAUST FLUID IN3083160108|CheckItems|", "Not allowed on this card: DEF"],
    ["17", "INVALID INFORMATION|UNIT NUMBER|779 IN0856977138||", "Wrong unit number entered at the pump: 779"],
    ["17", "INVALID INFORMATION|DRIVER ID|ODOMETER||", "Wrong driver ID and odometer entered at the pump"],
    ["119", "NO SECUREFUEL DATA IN0825426216|No Carrier SecureFuel Event|", "No location from the truck to check against"],
    ["20", "SYSTEM ERROR IN2165180071|supp_fee|", "EFS system error"],
  ];
  for (const [code, raw, plain] of cases) {
    it(`reads "${raw}" as "${plain}"`, () => expect(plainDeclineReason(code, raw)).toBe(plain));
  }

  it("shows a headline it does not know as EFS wrote it, in sentence case, rather than guessing", () => {
    expect(plainDeclineReason("99", "CARD SUSPENDED BY ISSUER IN123|Whatever|")).toBe("Card suspended by issuer");
  });

  it("leaves out a typed value it cannot pin to one prompt", () => {
    // Not seen on production yet; written so that a value is never shown against the wrong prompt.
    expect(plainDeclineReason("17", "INVALID INFORMATION|DRIVER ID|ODOMETER|8757 IN0819233740||"))
      .toBe("Wrong driver ID and odometer entered at the pump");
  });

  it("never hands the table an empty cell or a bare transaction id", () => {
    expect(plainDeclineReason("7", null)).toBe("EFS code 7");
    expect(plainDeclineReason(null, "")).toBe("No reason given");
    expect(plainDeclineReason("7", "IN0123|x|")).not.toMatch(/IN0123/);
  });

  it("agrees with the scorer about proximity, which outranks the INVALID TRUCKSTOP headline", () => {
    const raw = "INVALID TRUCKSTOP IN0851226257|Merchant Position Too Far|";
    expect(classifyDeclineReason("1", raw).category).toBe("proximity_failure");
    expect(plainDeclineReason("1", raw)).toBe("Truck was not near this truck stop");
  });
});
