import type { SupabaseClient } from "@supabase/supabase-js";
import {
  billExcise,
  billRevenue,
  buildLedgerCoverageReport,
  isReversedBySetv,
  isUntypedBill,
  settlementBookedPay,
  settlementsBookedBySet,
  type LedgerCoverageReport,
  type GlModuleTotal,
  type SubledgerClaim,
} from "@silvicom/shared";
import { readLedgerTotals, readSettlementsWindow, readSettlementVoidsWindow, readBillingWindow } from "../mcleod/index.js";
import { getFuelTieOut } from "./fuelTieOut.js";
import type { FuelTieOut } from "@silvicom/shared";

/**
 * The month's answer to "are entries missing?" — McLeod's own control totals against what our
 * staging actually holds, module by module (ledgerControl.ts's report, fed from the 0269 table).
 * Lives in `financial`, not `mcleod`, for the same reason the projection does: the collector
 * exports readers over its raw staging (D-SEP1), and the module that OWNS money semantics decides
 * what a claim means — accounting then reads it through this module's interface, the only door the
 * boundary gate allows it.
 *
 * Claims are stated ONLY for modules whose reconciliation basis is documented. SET: settlements
 * reconcile on the accrual side via accrual_key — 2,751 keys to 2,751 ledger lines, $0.00
 * difference (D-MC23) — and `posted_pay` is the figure that ties (D-MC24), over the rows SET books
 * (`settlementsBookedBySet`). SETV: voided, transferred rows on their void date, negative in the
 * books and claimed here one-sided like every module (TRUCK-DRIVER-PNL-PLAN §1.3 D3). BILL: 0257 measured
 * one receivable line per invoice for exactly the GL-booked rows (1,595 of June's 1,640), so the
 * claim is the booked rows on the receivable basis. AP staging exists but its per-line tie-out
 * has not been proven, so it reports as UNCOVERED rather than carrying a claim that would show
 * meaningless drift; an uncovered module is an honest gap, a wrong claim is noise wearing a
 * number (the shared report's own doctrine: silence about ten modules reads as completeness, so
 * the report names them instead).
 */
export async function getLedgerCoverage(
  admin: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<LedgerCoverageReport & { period_start: string; period_end: string; sweptMonth: boolean; fuel: FuelTieOut }> {
  const totalRows = await readLedgerTotals(admin, orgId, periodStart);
  const totals: GlModuleTotal[] = totalRows.map((r) => ({
    post_module: r.post_module,
    glid: r.glid,
    lines: r.line_count,
    net_amount: Number(r.net_amount),
    abs_amount: Number(r.abs_amount),
  }));

  const claims: SubledgerClaim[] = [];
  const [settlements, voids] = await Promise.all([
    readSettlementsWindow(admin, orgId, periodStart, periodEnd),
    readSettlementVoidsWindow(admin, orgId, periodStart, periodEnd),
  ]);
  const booked = settlementsBookedBySet(settlements);
  if (booked.length) {
    const extracted = booked.reduce((sum, s) => sum + settlementBookedPay(s), 0);
    claims.push({
      post_module: "SET",
      // The named residual: SET lines with no settlement row behind them, $1.1k–$8.2k a month on the
      // sandbox, May–August 2026. A drift of that size is those lines, not a missing sweep.
      source:
        "settlement sweep (mcleod_settlements.posted_pay on accrual, D-MC23/D-MC24) — the ledger's " +
        "\"Payable from Settlement\" lines carry no settlement row and stay as drift",
      extracted: Math.round(extracted * 100) / 100,
    });
  }

  // A voided, transferred row swept before 0497 has no void date, so no window can find it: SETV's
  // claim is short by those rows until the next sweep refills the column, and the source says how many.
  const reversed = voids.filter(isReversedBySetv);
  const undated = settlements.filter((s) => isReversedBySetv(s) && !s.void_date).length;
  if (reversed.length || undated) {
    const extracted = reversed.reduce((sum, s) => sum + settlementBookedPay(s), 0);
    claims.push({
      post_module: "SETV",
      source:
        "settlement sweep (voided, transferred settlements on their void date)" +
        (undated ? ` — ${undated} voided settlement${undated === 1 ? "" : "s"} swept before void_date existed, not yet dated` : ""),
      extracted: Math.round(extracted * 100) / 100,
    });
  }

  // BILL: the sweep's GL-BOOKED rows, on the receivable basis — 0257 measured one receivable line
  // per invoice, and billing_history's own `totalcharge_and_excisetax` names the receivable as
  // charges + excise. This claim doubles as the CONTINUOUS acceptance check for the billing
  // extraction: the month's drift against the carrier's own books, recomputed every sweep, is the
  // income-statement comparison the dry-run CLI performs once. Unposted rows carry no claim — the
  // projection holds them out for the same reason (F3's vocabulary is still unmeasured).
  const billing = await readBillingWindow(admin, orgId, periodStart, periodEnd);
  const bookedBills = billing.filter((b) => b.post_key && b.post_module === "BILL");
  if (bookedBills.length) {
    const extracted = bookedBills.reduce(
      // The receivable is the bill plus its excise (`totalcharge_and_excisetax`); the accessorials
      // are already inside `total_charges` (`billRevenue`). A credit memo is negative (`billSign`):
      // July 2026's 1,467 invoices and 55 credits tie to the receivable this way to the cent.
      (sum, b) => sum + billRevenue(b) + billExcise(b),
      0,
    );
    // A row swept before 0500 has no bill_type and is read as an invoice. If a credit is among them
    // the drift says so as a number; this says why, until the next sweep fills the column.
    const untyped = bookedBills.filter(isUntypedBill).length;
    claims.push({
      post_module: "BILL",
      source:
        "billing sweep (mcleod_billing, GL-booked rows on the receivable basis, credit memos negative)" +
        (untyped ? ` — ${untyped} bill${untyped === 1 ? "" : "s"} swept before bill_type existed, read as invoices` : ""),
      extracted: Math.round(extracted * 100) / 100,
    });
  }

  // FUEL: EFS card lines by PRODUCT against the accounts each product posts to, owner-operator
  // fuel against the asset account (D-FIN12). The claim is every dollar the decomposition placed;
  // the per-account residual is the posting-lag term until McLeod's fuel_detail is staged (F12b).
  const fuel = await getFuelTieOut(admin, orgId, periodStart, periodEnd);
  if (fuel.totals.efsMapped + fuel.totals.efsOwnerOperator > 0) {
    claims.push({
      post_module: "FUEL",
      source: "EFS card lines by product against McLeod's posting accounts (D-FIN12); owner-operator fuel to 17000000",
      extracted: Math.round((fuel.totals.efsMapped + fuel.totals.efsOwnerOperator) * 100) / 100,
    });
  }
  return {
    ...buildLedgerCoverageReport(totals, claims),
    period_start: periodStart,
    period_end: periodEnd,
    sweptMonth: totals.length > 0,
    fuel,
  };
}
