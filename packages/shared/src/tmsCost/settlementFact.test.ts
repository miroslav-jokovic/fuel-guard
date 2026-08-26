import { describe, it, expect } from "vitest";
import {
  reconcileSettlementToLedger,
  settlementCostByTruck,
  tmsSettlementFactSchema,
  SETTLEMENT_PAYABLE_GLID_PREFIX,
  type TmsLedgerLine,
} from "./index.js";

const settlement = (
  external_id: string,
  opts: {
    posted?: number;
    total?: number;
    key?: string | null;
    tractor?: string | null;
    payee?: "company_driver" | "owner_operator" | "other";
  } = {},
) =>
  tmsSettlementFactSchema.parse({
    external_id,
    company_id: "TMS",
    tractor_unit: opts.tractor ?? "101",
    payee_type: opts.payee ?? "company_driver",
    posted_pay: opts.posted ?? 0,
    total_pay: opts.total ?? opts.posted ?? 0,
    accrual_key: opts.key === undefined ? "A1" : opts.key,
  });

/** The accrual payable is a credit, so the ledger's own sign is negative. */
const payable = (post_key: string, amount: number): TmsLedgerLine => ({
  post_key,
  glid: `${SETTLEMENT_PAYABLE_GLID_PREFIX}10          `,
  amount: -amount,
});

describe("reconcileSettlementToLedger", () => {
  it("balances posted pay against the accrual payable", () => {
    const r = reconcileSettlementToLedger(
      [
        settlement("S1", { posted: 400.5, key: "A1" }),
        settlement("S2", { posted: 100.25, key: "A2" }),
      ],
      [payable("A1", 400.5), payable("A2", 100.25)],
    );
    expect(r.extracted).toBe(500.75);
    expect(r.ledger).toBe(500.75);
    expect(r.difference).toBe(0);
    expect(r.balanced).toBe(true);
  });

  it("reconciles posted_pay, NOT total_pay", () => {
    // June 2026: total_pay $1,268,565.31 against a payable of $1,262,893.74. The gap is real money
    // paid after the accrual posted, so a reconciler that used total_pay would fail every month.
    const r = reconcileSettlementToLedger(
      [settlement("S1", { posted: 1000, total: 1050, key: "A1" })],
      [payable("A1", 1000)],
    );
    expect(r.extracted).toBe(1000);
    expect(r.balanced).toBe(true);
  });

  it("ignores the expense leg, which would otherwise net the accrual to zero", () => {
    const r = reconcileSettlementToLedger(
      [settlement("S1", { posted: 1000, key: "A1" })],
      [payable("A1", 1000), { post_key: "A1", glid: "40000001", amount: 1000 }],
    );
    expect(r.ledger).toBe(1000);
    expect(r.balanced).toBe(true);
  });

  it("treats a zero-value settlement as matched, since it posts no ledger line", () => {
    // 14 of June's 2,765 rows are zero-value. Counting them as unmatched would fail a
    // reconciliation that is in fact exact to the cent.
    const r = reconcileSettlementToLedger(
      [settlement("S1", { posted: 1000, key: "A1" }), settlement("S0", { posted: 0, key: null })],
      [payable("A1", 1000)],
    );
    expect(r.unmatchedSettlements).toBe(0);
    expect(r.balanced).toBe(true);
  });

  it("still flags a non-zero settlement that reaches no ledger line", () => {
    const r = reconcileSettlementToLedger(
      [settlement("S1", { posted: 1000, key: "A1" }), settlement("S2", { posted: 250, key: null })],
      [payable("A1", 1000)],
    );
    expect(r.unmatchedSettlements).toBe(1);
    expect(r.difference).toBe(250);
    expect(r.balanced).toBe(false);
  });

  it("flags ledger keys with no settlement behind them", () => {
    const r = reconcileSettlementToLedger(
      [settlement("S1", { posted: 1000, key: "A1" })],
      [payable("A1", 1000), payable("A-ghost", 75)],
    );
    expect(r.unmatchedLedgerKeys).toBe(1);
    expect(r.difference).toBe(-75);
    expect(r.balanced).toBe(false);
  });

  it("does not fail over floating-point dust", () => {
    // Two rows summing to 0.30000000000000004 against one exact ledger line of 0.3.
    expect(0.1 + 0.2).not.toBe(0.3);
    const r = reconcileSettlementToLedger(
      [settlement("S1", { posted: 0.1, key: "A1" }), settlement("S2", { posted: 0.2, key: "A1" })],
      [payable("A1", 0.3)],
    );
    expect(r.difference).toBe(0);
    expect(r.balanced).toBe(true);
  });
});

describe("settlementCostByTruck", () => {
  it("never pools a company driver with an owner-operator on the same truck", () => {
    // D-MC20: an owner-operator settlement already contains the truck, its fuel and its maintenance.
    // Adding it to a company driver's wages produces a figure that describes neither.
    const rows = settlementCostByTruck([
      settlement("S1", { total: 400, tractor: "101", payee: "company_driver" }),
      settlement("S2", { total: 2900, tractor: "101", payee: "owner_operator" }),
      settlement("S3", { total: 350, tractor: "101", payee: "company_driver" }),
    ]);
    expect(rows).toHaveLength(2);
    const oo = rows.find((r) => r.payee_type === "owner_operator")!;
    const cd = rows.find((r) => r.payee_type === "company_driver")!;
    expect(oo.total_pay).toBe(2900);
    expect(cd.total_pay).toBe(750);
    expect(cd.settlements).toBe(2);
  });

  it("uses total_pay, because the question is what the truck cost", () => {
    const rows = settlementCostByTruck([settlement("S1", { posted: 1000, total: 1050, tractor: "101" })]);
    expect(rows[0]!.total_pay).toBe(1050);
  });

  it("drops rows with no truck rather than inventing a bucket for them", () => {
    const rows = settlementCostByTruck([
      settlement("S1", { total: 100, tractor: null }),
      settlement("S2", { total: 200, tractor: "101" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tractor_unit).toBe("101");
  });

  it("ranks the most expensive truck first", () => {
    const rows = settlementCostByTruck([
      settlement("S1", { total: 100, tractor: "101" }),
      settlement("S2", { total: 900, tractor: "202" }),
    ]);
    expect(rows.map((r) => r.tractor_unit)).toEqual(["202", "101"]);
  });
});
