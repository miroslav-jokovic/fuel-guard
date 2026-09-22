import { describe, expect, it } from "vitest";
import { computeCoverage, coverageIsPrintable, type CoverageInvoice, type CoverageVoucher } from "./coverage.js";

/**
 * The coverage bound (FLEETPAL-INTEGRATION-PLAN.md D-FP15, D-FP17; Q9 ruled (a) 2026-09-21).
 *
 * Every case here is a way the bound could stop being a bound. The headline is "at least X%", and
 * that sentence is only true if every source of error moves the number DOWN — so what is asserted
 * below is not "the arithmetic is right" but "each way of being wrong was excluded rather than
 * guessed at".
 */

const inv = (over: Partial<CoverageInvoice> = {}): CoverageInvoice => ({
  number: "WI012764",
  month: "2026-08",
  amount: 1000,
  isCredit: false,
  ...over,
});

const vou = (over: Partial<CoverageVoucher> = {}): CoverageVoucher => ({
  invoiceNumber: "WI012764",
  month: "2026-08",
  amount: 1000,
  ...over,
});

const AUGUST = [{ month: "2026-08", familyTotal: 10_000 }];

describe("the bound only ever moves down", () => {
  it("counts an invoice that matches exactly one voucher", () => {
    const [m] = computeCoverage(AUGUST, [inv()], [vou()]);
    expect(m!.confirmedInLedger).toBe(1000);
    expect(m!.ratioLowerBound).toBe(0.1);
    expect(m!.matchedExactlyOne).toBe(1);
  });

  it("⚠ EXCLUDES a number that hit several vouchers — a collision is reported, never flipped for", () => {
    // The vendor's own documentation says an invoice number is not unique across vendors, and
    // `Vendor.code` is populated on 1 of 761 so there is no vendor key to break the tie with.
    // Picking one would put a tyre shop's money against a parts supplier's invoice and the bound
    // would silently become an estimate.
    const [m] = computeCoverage(AUGUST, [inv()], [vou(), vou({ amount: 250 })]);
    expect(m!.confirmedInLedger).toBe(0);
    expect(m!.matchedSeveral).toBe(1);
    expect(m!.matchedExactlyOne).toBe(0);
    // It is still FleetPal invoicing — only its CONFIRMATION is missing.
    expect(m!.fleetpalInvoiced).toBe(1000);
  });

  it("⚠ EXCLUDES a number found nowhere in the ledger rather than assuming it is there", () => {
    const [m] = computeCoverage(AUGUST, [inv({ number: "NOT-IN-LEDGER" })], [vou()]);
    expect(m!.confirmedInLedger).toBe(0);
    expect(m!.matchedNone).toBe(1);
  });

  it("⚠ never matches across months — a September voucher does not confirm an August invoice", () => {
    // The two sides date differently (FleetPal's invoice date; McLeod's distribution-or-invoice
    // date), so a cross-month match would let one invoice confirm itself in whichever month made
    // the ratio look better.
    const [m] = computeCoverage(AUGUST, [inv()], [vou({ month: "2026-09" })]);
    expect(m!.confirmedInLedger).toBe(0);
    expect(m!.matchedNone).toBe(1);
  });
});

describe("the ways a duplicate could inflate it", () => {
  it("⚠ two FleetPal invoices sharing a number are ONE piece of evidence, not two", () => {
    // Both point at the same voucher. Counting that voucher's confirmation twice would let a
    // duplicate in the vendor's own data push the bound up — the one direction it may not move.
    // The matrix proves the database permits the duplicate; this proves the bound survives it.
    const [m] = computeCoverage(AUGUST, [inv(), inv()], [vou()]);
    expect(m!.matchedExactlyOne).toBe(1);
    // The net of BOTH invoices is what was confirmed, counted once through one number.
    expect(m!.confirmedInLedger).toBe(2000);
    expect(m!.fleetpalInvoiced).toBe(2000);
  });

  it("⚠ a CREDIT subtracts, though its amount arrives positive", () => {
    // The type is the sign at this vendor. Summing amounts without reading it overstates spend by
    // twice every credit note — and the bound is the one number that must not overstate.
    const [m] = computeCoverage(AUGUST, [inv({ amount: 1000 }), inv({ amount: 250, isCredit: true })], [vou()]);
    expect(m!.fleetpalInvoiced).toBe(750);
    expect(m!.confirmedInLedger).toBe(750);
  });
});

describe("the residual risk is reported, not joined away", () => {
  it("⚠ an exactly-one match whose amounts disagree is COUNTED and FLAGGED", () => {
    // Q9 was ruled: the number alone decides. Adding the amount to the join would have been a
    // quieter answer to a different question, so the disagreement is surfaced instead — a real
    // match agrees on the money and a coincidental one usually does not.
    const [m] = computeCoverage(AUGUST, [inv({ amount: 1000 })], [vou({ amount: 412.5 })]);
    expect(m!.matchedExactlyOne).toBe(1);
    expect(m!.confirmedInLedger).toBe(1000);
    expect(m!.amountDiffers).toBe(1);
  });

  it("does not flag a cent of float drift as a disagreement", () => {
    const [m] = computeCoverage(AUGUST, [inv({ amount: 1808.1 })], [vou({ amount: 1808.1000000000001 })]);
    expect(m!.amountDiffers).toBe(0);
  });
});

describe("a month the ledger cannot answer for", () => {
  it("⚠ yields a null ratio rather than a zero — and a null is what refuses the cost figure", () => {
    // A month never swept is not a month with no maintenance spend. Rendering it as 0% would say
    // "FleetPal saw none of it", which is a claim about the shop rather than about our data.
    const [m] = computeCoverage([{ month: "2026-08", familyTotal: null }], [inv()], [vou()]);
    expect(m!.ratioLowerBound).toBeNull();
    expect(m!.glMaintenance).toBeNull();
    expect(coverageIsPrintable([m!])).toBe(false);
  });

  it("a zero denominator is null too, not an infinite ratio", () => {
    const [m] = computeCoverage([{ month: "2026-08", familyTotal: 0 }], [inv()], [vou()]);
    expect(m!.ratioLowerBound).toBeNull();
  });

  it("⚠ ONE unanswerable month refuses the WHOLE window (D-FP4)", () => {
    // Otherwise a six-month cost figure prints beside a ratio covering three of them, and it looks
    // more trustworthy than a refusal rather than less.
    const months = computeCoverage(
      [{ month: "2026-07", familyTotal: 10_000 }, { month: "2026-08", familyTotal: null }],
      [inv({ month: "2026-07" })],
      [vou({ month: "2026-07" })],
    );
    expect(months[0]!.ratioLowerBound).toBe(0.1);
    expect(coverageIsPrintable(months)).toBe(false);
  });

  it("an empty window is not printable either — nothing is not a bound", () => {
    expect(coverageIsPrintable([])).toBe(false);
  });
});

describe("the shape of the answer", () => {
  it("⚠ reports a month with no FleetPal invoicing rather than dropping it", () => {
    // "FleetPal saw none of August" and "August is not in this report" are different statements,
    // and only one of them is an answer.
    const months = computeCoverage(
      [{ month: "2026-07", familyTotal: 8_000 }, { month: "2026-08", familyTotal: 10_000 }],
      [inv({ month: "2026-07" })],
      [vou({ month: "2026-07" })],
    );
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-08"]);
    expect(months[1]!.fleetpalInvoiced).toBe(0);
    expect(months[1]!.ratioLowerBound).toBe(0);
  });

  it("is pure — the same inputs twice give the same answer, and the inputs are not mutated", () => {
    const invoices = [inv()];
    const vouchers = [vou()];
    const frozen = JSON.stringify({ invoices, vouchers });
    const a = computeCoverage(AUGUST, invoices, vouchers);
    const b = computeCoverage(AUGUST, invoices, vouchers);
    expect(a).toEqual(b);
    expect(JSON.stringify({ invoices, vouchers })).toBe(frozen);
  });
});
