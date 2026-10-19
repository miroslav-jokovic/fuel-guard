import { describe, expect, it } from "vitest";
import { billLinehaul, billRevenue } from "./billingFact.js";

describe("billRevenue", () => {
  // Order 0131243, July 2026: a 4,250.00 flat rate with 614.64 of other charges.
  const bill = { total_charges: 4864.64, other_charge: 614.64 };

  it("is total_charges alone, because McLeod's total already includes the accessorials", () => {
    expect(billRevenue(bill)).toBe(4864.64);
  });

  it("reads the string form PostgREST returns for numeric columns", () => {
    expect(billRevenue({ total_charges: "4864.64" })).toBe(4864.64);
  });

  it("is zero, not NaN, for a bill with no charge", () => {
    expect(billRevenue({ total_charges: null })).toBe(0);
  });
});

describe("billLinehaul", () => {
  it("is the whole bill less its accessorials, so linehaul plus accessorial is the bill", () => {
    const bill = { total_charges: 4864.64, other_charge: 614.64 };
    expect(billLinehaul(bill)).toBe(4250);
    expect(billLinehaul(bill) + bill.other_charge).toBe(billRevenue(bill));
  });

  it("is the whole bill when there are no accessorials", () => {
    expect(billLinehaul({ total_charges: "1800", other_charge: null })).toBe(1800);
  });
});
