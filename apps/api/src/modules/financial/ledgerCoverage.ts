import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildLedgerCoverageReport,
  type LedgerCoverageReport,
  type GlModuleTotal,
  type SubledgerClaim,
} from "@silvicom/shared";
import { readLedgerTotals, readSettlementsWindow } from "../mcleod/index.js";

/**
 * The month's answer to "are entries missing?" — McLeod's own control totals against what our
 * staging actually holds, module by module (ledgerControl.ts's report, fed from the 0269 table).
 * Lives in `financial`, not `mcleod`, for the same reason the projection does: the collector
 * exports readers over its raw staging (D-SEP1), and the module that OWNS money semantics decides
 * what a claim means — accounting then reads it through this module's interface, the only door the
 * boundary gate allows it.
 *
 * Claims are stated ONLY for modules whose reconciliation basis is proven. Today that is SET
 * alone: settlements reconcile on the accrual side via accrual_key — 2,751 keys to 2,751 ledger
 * lines, $0.00 difference (D-MC23) — and `posted_pay` is the figure that ties (D-MC24). AP and
 * BILL staging exist but their per-line tie-out has not been proven, so they report as UNCOVERED
 * rather than carrying a claim that would show meaningless drift; an uncovered module is an honest
 * gap, a wrong claim is noise wearing a number (the shared report's own doctrine: silence about
 * ten modules reads as completeness, so the report names them instead).
 */
export async function getLedgerCoverage(
  admin: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<LedgerCoverageReport & { period_start: string; period_end: string; sweptMonth: boolean }> {
  const totalRows = await readLedgerTotals(admin, orgId, periodStart);
  const totals: GlModuleTotal[] = totalRows.map((r) => ({
    post_module: r.post_module,
    glid: r.glid,
    lines: r.line_count,
    net_amount: Number(r.net_amount),
    abs_amount: Number(r.abs_amount),
  }));

  const claims: SubledgerClaim[] = [];
  const settlements = await readSettlementsWindow(admin, orgId, periodStart, periodEnd);
  const live = settlements.filter((s) => !s.is_void);
  if (live.length) {
    const extracted = live.reduce((sum, s) => sum + Number(s.posted_pay), 0);
    claims.push({
      post_module: "SET",
      source: "settlement sweep (mcleod_settlements.posted_pay on accrual, D-MC23/D-MC24)",
      extracted: Math.round(extracted * 100) / 100,
    });
  }

  return {
    ...buildLedgerCoverageReport(totals, claims),
    period_start: periodStart,
    period_end: periodEnd,
    sweptMonth: totals.length > 0,
  };
}
