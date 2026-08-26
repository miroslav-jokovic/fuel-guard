import { describe, it, expect } from "vitest";
import {
  reconcileFuelToLedger,
  summarizeApSpendByAccount,
  tmsApVoucherFactSchema,
  tmsFuelPurchaseFactSchema,
  FUEL_PAYABLE_GLID_PREFIX,
  type TmsLedgerLine,
} from "./index.js";

const purchase = (external_id: string, settled_amount: number, post_key: string | null) =>
  tmsFuelPurchaseFactSchema.parse({
    external_id,
    company_id: "TMS",
    tractor_unit: "101",
    settled_amount,
    post_key,
  });

/** The payable is carried as a credit, so the ledger's own sign is negative. */
const payable = (post_key: string, amount: number): TmsLedgerLine => ({
  post_key,
  glid: `${FUEL_PAYABLE_GLID_PREFIX}            `,
  amount: -amount,
});

describe("reconcileFuelToLedger", () => {
  it("balances when every purchase matches its ledger payable", () => {
    const r = reconcileFuelToLedger(
      [purchase("F1", 100.25, "K1"), purchase("F2", 50.75, "K2")],
      [payable("K1", 100.25), payable("K2", 50.75)],
    );
    expect(r.extracted).toBe(151);
    expect(r.ledger).toBe(151);
    expect(r.difference).toBe(0);
    expect(r.balanced).toBe(true);
  });

  it("ignores the expense leg, which would otherwise net the whole module to zero", () => {
    // Double-entry: the payable credit and the expense debit cancel. Reconciling against the whole
    // FUEL module would always "balance" at zero and prove nothing at all.
    const r = reconcileFuelToLedger(
      [purchase("F1", 100, "K1")],
      [payable("K1", 100), { post_key: "K1", glid: "40050000", amount: 100 }],
    );
    expect(r.ledger).toBe(100);
    expect(r.balanced).toBe(true);
  });

  it("catches a purchase the books do not show", () => {
    const r = reconcileFuelToLedger(
      [purchase("F1", 100, "K1"), purchase("F2", 40, "K-missing")],
      [payable("K1", 100)],
    );
    expect(r.unmatchedPurchases).toBe(1);
    expect(r.difference).toBe(40);
    expect(r.balanced).toBe(false);
  });

  it("catches money the books show that we failed to extract", () => {
    const r = reconcileFuelToLedger([purchase("F1", 100, "K1")], [payable("K1", 100), payable("K2", 60)]);
    expect(r.unmatchedLedgerKeys).toBe(1);
    expect(r.difference).toBe(-60);
    expect(r.balanced).toBe(false);
  });

  it("treats an unposted purchase as unmatched rather than as agreement", () => {
    // A live-table row has no post_key at all. It has not reached the ledger, so it cannot reconcile,
    // and silently counting it as fine would hide a genuinely missing posting.
    const r = reconcileFuelToLedger([purchase("F1", 100, null)], []);
    expect(r.unmatchedPurchases).toBe(1);
    expect(r.balanced).toBe(false);
  });

  it("does not fail a reconciliation over floating-point dust", () => {
    // The two sides must accumulate DIFFERENTLY for this to test anything: two purchases of 0.1 and
    // 0.2 sum to 0.30000000000000004, while one ledger line of 0.3 is exact. Summing the same values
    // in the same order on both sides produces identical dust that cancels, and the test would pass
    // with the rounding removed — which is exactly what a first version of this test did.
    expect(0.1 + 0.2).not.toBe(0.3);
    const r = reconcileFuelToLedger(
      [purchase("F1", 0.1, "K1"), purchase("F2", 0.2, "K1")],
      [payable("K1", 0.3)],
    );
    expect(r.difference).toBe(0);
    expect(r.balanced).toBe(true);
  });

  it("honours a different chart of accounts", () => {
    // The payable account is Silvicom's, not McLeod's. A second carrier points this elsewhere.
    const lines: TmsLedgerLine[] = [{ post_key: "K1", glid: "29999000", amount: -100 }];
    expect(reconcileFuelToLedger([purchase("F1", 100, "K1")], lines).balanced).toBe(false);
    expect(reconcileFuelToLedger([purchase("F1", 100, "K1")], lines, "29999").balanced).toBe(true);
  });
});

describe("summarizeApSpendByAccount", () => {
  const voucher = (external_id: string, amount: number, ap_glid: string | null) =>
    tmsApVoucherFactSchema.parse({ external_id, company_id: "TMS", amount, ap_glid });

  it("groups by expense account, largest first", () => {
    const rows = summarizeApSpendByAccount([
      voucher("V1", 100, "20000000"),
      voucher("V2", 250, "61000000"),
      voucher("V3", 50, "20000000"),
    ]);
    expect(rows.map((r) => r.ap_glid)).toEqual(["61000000", "20000000"]);
    expect(rows[0]!.amount).toBe(250);
    expect(rows[1]!.amount).toBe(150);
    expect(rows[1]!.vouchers).toBe(2);
  });

  it("surfaces unclassified spend rather than dropping it", () => {
    // A bucket of cost nobody can categorise is exactly what a reviewer needs to see.
    const rows = summarizeApSpendByAccount([voucher("V1", 900, null)]);
    expect(rows[0]!.ap_glid).toBe("(unclassified)");
    expect(rows[0]!.amount).toBe(900);
  });

  it("lets a credit memo reduce its account rather than inflating it", () => {
    const rows = summarizeApSpendByAccount([voucher("V1", 500, "20000000"), voucher("V2", -200, "20000000")]);
    expect(rows[0]!.amount).toBe(300);
  });
});
