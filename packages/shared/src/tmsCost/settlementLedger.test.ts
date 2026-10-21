import { describe, it, expect } from "vitest";
import {
  isReversedBySetv,
  settlementBookedPay,
  settlementReversalPay,
  settlementsBookedBySet,
} from "./settlementLedger.js";

/**
 * The rule the general ledger posts settlement pay by, measured on the sandbox 2026-10-19
 * (TRUCK-DRIVER-PNL-PLAN §1.3 D3): SET books each accrual key once — the live row when the key carries
 * a re-issue, the row itself when it is alone — and SETV reverses a voided, transferred row.
 */
describe("settlementsBookedBySet", () => {
  it("books the live row of a key that also carries its voided original, and not the original", () => {
    const original = { id: "a", accrual_key: "K1", is_void: true, posted_pay: 900 };
    const reissue = { id: "b", accrual_key: "K1", is_void: false, posted_pay: 850 };
    expect(settlementsBookedBySet([original, reissue]).map((r) => r.id)).toEqual(["b"]);
  });

  it("books a voided row that is alone on its key — the void does not un-post its accrual", () => {
    const lone = { id: "a", accrual_key: "K2", is_void: true, posted_pay: 400 };
    expect(settlementsBookedBySet([lone])).toEqual([lone]);
  });

  it("matches keys as McLeod pads them, and treats a row without a key as its own", () => {
    const rows = [
      { id: "a", accrual_key: "K3 ", is_void: true, posted_pay: 1 },
      { id: "b", accrual_key: "K3", is_void: false, posted_pay: 1 },
      { id: "c", accrual_key: null, is_void: true, posted_pay: 1 },
    ];
    expect(settlementsBookedBySet(rows).map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("always books a live row", () => {
    const rows = [
      { id: "a", accrual_key: "K4", is_void: false, posted_pay: 1 },
      { id: "b", accrual_key: "K4", is_void: false, posted_pay: 2 },
    ];
    expect(settlementsBookedBySet(rows)).toHaveLength(2);
  });
});

describe("isReversedBySetv", () => {
  const voided = { is_void: true, post_key: "PK-1", transferred_at: "2026-07-02T00:00:00Z", posted_pay: 10 };

  it("reverses a voided row that had been transferred", () => {
    expect(isReversedBySetv(voided)).toBe(true);
  });

  it("does not reverse a row voided before transfer, a blank payment key, or a live row", () => {
    expect(isReversedBySetv({ ...voided, transferred_at: null })).toBe(false);
    expect(isReversedBySetv({ ...voided, post_key: "  " })).toBe(false);
    expect(isReversedBySetv({ ...voided, is_void: false })).toBe(false);
  });
});

describe("settlement pay as booked", () => {
  it("books posted_pay to the cent on SET and its negative on SETV, from the wire's strings too", () => {
    expect(settlementBookedPay({ posted_pay: "47338.004" })).toBe(47_338);
    expect(settlementReversalPay({ posted_pay: "47338.00" })).toBe(-47_338);
    expect(settlementBookedPay({ posted_pay: null })).toBe(0);
  });
});
