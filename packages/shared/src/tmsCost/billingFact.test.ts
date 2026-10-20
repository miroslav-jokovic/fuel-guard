import { describe, expect, it } from "vitest";
import { billAccessorials, billExcise, billLinehaul, billRevenue, billSign, isCreditBill, isUntypedBill } from "./billingFact.js";

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

describe("credit memos (bill_type C)", () => {
  // McLeod stages a credit with a POSITIVE total_charges; the ledger posts it against the receivable.
  const credit = { total_charges: 3000, other_charge: 400, excise_tax: 12, bill_type: "C" };

  it("takes the bill's revenue back, so a credit is negative in every reader", () => {
    expect(billSign(credit)).toBe(-1);
    expect(billRevenue(credit)).toBe(-3000);
  });

  it("signs linehaul, accessorials and excise alike, so the parts still add up to the bill", () => {
    expect(billLinehaul(credit)).toBe(-2600);
    expect(billAccessorials(credit)).toBe(-400);
    expect(billExcise(credit)).toBe(-12);
    expect(billLinehaul(credit) + billAccessorials(credit)).toBe(billRevenue(credit));
  });

  it("reads McLeod's padded or lower-case code as the same credit", () => {
    expect(isCreditBill({ bill_type: " c " })).toBe(true);
  });

  it("reads an invoice, and a bill swept before bill_type existed, as positive", () => {
    expect(billRevenue({ total_charges: 3000, bill_type: "I" })).toBe(3000);
    expect(billRevenue({ total_charges: 3000, bill_type: null })).toBe(3000);
    expect(isUntypedBill({ bill_type: null })).toBe(true);
    expect(isUntypedBill({ bill_type: "I" })).toBe(false);
  });

  it("ties July 2026's 1,467 invoices and 55 credits to the BILL receivable's net", () => {
    // The two sums as the sandbox measured them on 2026-10-19 (TRUCK-DRIVER-PNL-PLAN §1.3 D2).
    const invoices = billRevenue({ total_charges: 5_028_444.73, bill_type: "I" });
    const credits = billRevenue({ total_charges: 213_124.32, bill_type: "C" });
    expect(Math.round((invoices + credits) * 100) / 100).toBe(4_815_320.41);
  });
});
