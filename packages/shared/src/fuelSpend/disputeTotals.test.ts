import { describe, expect, it } from "vitest";
import { CLAIMABLE_AMOUNT_KINDS, disputeTotals, type DisputeTotalsRow } from "./disputeTotals.js";
import { QUEUE_EXCEPTION_KINDS, QUEUE_FINDING_KINDS } from "../findingAssignment.js";
import { BUYING_HABIT_KINDS } from "./buyingHabits.js";

const r = (o: Partial<DisputeTotalsRow> = {}): DisputeTotalsRow => ({
  status: "open", amount_kind: "overbilled", amount: "10.00", credited_amount: null, ...o,
});

describe("the queue's kinds after the buying habits left (chunk 9b)", () => {
  it("holds every ledger kind but the habits, plus the fill case and the incident", () => {
    for (const k of BUYING_HABIT_KINDS) expect(QUEUE_FINDING_KINDS).not.toContain(k);
    expect([...QUEUE_EXCEPTION_KINDS].sort()).toEqual(
      ["contract_variance", "recon_amount", "recon_gallons", "recon_missing_in_system", "recon_missing_on_report"],
    );
    expect(QUEUE_FINDING_KINDS).toEqual(expect.arrayContaining(["theft_case", "card_fraud"]));
  });
});

describe("the three money tiles (chunk 9b)", () => {
  it("claims only the money the fleet can claim: overbilled and unrecorded", () => {
    expect([...CLAIMABLE_AMOUNT_KINDS].sort()).toEqual(["overbilled", "unrecorded"]);
  });

  /**
   * The 9b accept, on production's shape (2026-10-08): 14 open items, the 4 overbilled worth $56.34 the
   * only money to claim. The billing gaps are counted, never added (D-FX5).
   */
  it("counts every open item and sums only the claimable ones", () => {
    const rows = [
      ...["10.12", "20.05", "13.10", "13.07"].map((amount) => r({ amount })),
      ...["100.00", "50.00", "40.00", "18.60"].map((amount) => r({ amount_kind: "underbilled", amount })),
      ...Array.from({ length: 6 }, () => r({ amount_kind: "unbilled", amount: "389.94" })),
    ];
    expect(disputeTotals(rows).canDispute).toEqual({ count: 14, claims: 4, amount: 56.34 });
  });

  it("follows a claim from open to paid", () => {
    const t = disputeTotals([
      r({ status: "investigating", amount: "0.07" }),
      r({ status: "disputed", amount: "500" }),
      r({ status: "disputed", amount_kind: "unbilled", amount: "900" }),
      r({ status: "credited", amount: "300", credited_amount: "275.10" }),
      r({ status: "dismissed", amount: "999" }),
      r({ status: "resolved_by_reingest", amount: "999" }),
    ]);
    expect(t.canDispute).toEqual({ count: 1, claims: 1, amount: 0.07 });
    expect(t.disputed).toEqual({ count: 2, amount: 500 });
    // What came back, which is not what was claimed (E3).
    expect(t.creditedBack).toEqual({ count: 1, amount: 275.1 });
  });

  it("adds small amounts to the cent", () => {
    expect(disputeTotals(Array.from({ length: 40 }, () => r({ amount: "0.07" }))).canDispute.amount).toBe(2.8);
  });
});
