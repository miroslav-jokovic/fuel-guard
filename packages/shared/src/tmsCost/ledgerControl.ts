import { z } from "zod";

/**
 * General-ledger control totals, and the coverage report built from them.
 *
 * Under D-MC12 the ledger is not a source of cost-per-truck — the carrier populates
 * `gl_ledger.tractor` on 0 of 188,179 lines — it is the thing the subledger extractions are checked
 * AGAINST. This file answers two questions that no subledger can answer about itself:
 *
 *  1. **Did we get all of it?** If the `FUEL` module moved more money than `FUEL_PURCHASES` returned,
 *     rows are missing, and only the books can say so.
 *  2. **Which parts of the books has anyone looked at?** Some modules have no subledger extraction
 *     behind them and some never will. Naming them is the point; an integration that reconciles the
 *     two domains it covers and stays quiet about the ten it does not is more misleading than one
 *     that reconciles nothing, because the silence reads as completeness.
 *
 * What this file does NOT produce is a cost total — see the caveat on `buildLedgerCoverageReport`.
 */

export const glModuleTotalSchema = z.object({
  post_module: z.string().min(1).max(4),
  glid: z.string().max(20),
  lines: z.number().int().nonnegative(),
  net_amount: z.number(),
  abs_amount: z.number().nonnegative(),
});
export type GlModuleTotal = z.infer<typeof glModuleTotalSchema>;

/**
 * The wire envelope for a control-totals sweep — CALENDAR-MONTH grained, unlike the row-level
 * sweeps' rolling windows. Control totals are aggregates over a period, so the period must be a
 * stable, meaningful unit or every re-sweep would mint a fresh set of overlapping windows that
 * nothing can reconcile against; the month is the unit the carrier's own close and P&L use. A
 * month is re-swept (and wholly replaced) while McLeod's late manual entry is still landing in it
 * — that lag runs about a month, which is exactly why re-sweeping matters.
 */
/**
 * One row as the wire carries it since W1 (D-FLEET9): the module total for ONE DAY.
 *
 * `glModuleTotalSchema` stays what it was — the shape the ledger-coverage report reasons about,
 * which is per module and has no date in it — and this extends it rather than widening it, so the
 * coverage report is not made to carry a field it has no use for.
 *
 * The date is REQUIRED. An agent that has not been updated sends dateless rows and gets a 400 it can
 * read, which is the failure this wants: the alternative is a fallback path that keeps writing the
 * old grain while everyone believes the new one is live.
 */
export const glDayTotalSchema = glModuleTotalSchema.extend({
  /** The ledger line's own transaction date, `YYYY-MM-DD`, as McLeod states it. */
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type GlDayTotal = z.infer<typeof glDayTotalSchema>;

export const tmsLedgerTotalsPayloadSchema = z.object({
  /** First day of the month, YYYY-MM-DD. */
  period_start: z.string().regex(/^\d{4}-\d{2}-01$/),
  /** First day of the NEXT month — half-open, like every window in this integration. */
  period_end: z.string().regex(/^\d{4}-\d{2}-01$/),
  /**
   * The month's rows at DAILY grain. The cap rose with the grain: a month's day rows land near
   * 2,000 against the ~140 the monthly grain produced (§1.8.1's measurement), and the ceiling is
   * there to refuse a runaway payload, not to bound a normal one.
   */
  totals: z.array(glDayTotalSchema).max(20000),
  /** The McLeod company the month was swept for (0303, D-FIN8) — the books are per legal entity. */
  company_id: z.string().min(1).max(4).nullish(),
});
export type TmsLedgerTotalsPayload = z.infer<typeof tmsLedgerTotalsPayloadSchema>;

/**
 * The chart of accounts (gl_account master) — glid, name, and McLeod's OWN classification
 * (`type_id`: "Revenue" / "Operating Expenses" / "General & Admin Expenses" / …). Swept whole with
 * every --financial pass (123 rows measured 2026-08-28) so the GL totals can be read as an income
 * statement without anyone re-deriving what an account means.
 */
export const glAccountSchema = z.object({
  glid: z.string().min(1).max(20),
  descr: z.string().max(120).nullish(),
  type_id: z.string().max(60).nullish(),
});
export const tmsGlAccountsPayloadSchema = z.object({
  accounts: z.array(glAccountSchema).max(5000),
});
export type TmsGlAccountsPayload = z.infer<typeof tmsGlAccountsPayloadSchema>;

/** The account classes that constitute the income statement, exactly as gl_account.type_id spells
 *  them. Balance-sheet classes (assets, liabilities, equity) are deliberately absent: a loan draw
 *  is not revenue and a driver-advance repayment is not an expense. */
export const PNL_REVENUE_TYPES = ["Revenue"] as const;
export const PNL_EXPENSE_TYPES = ["Operating Expenses", "General & Admin Expenses", "Income Tax Expense"] as const;

/** What a subledger extraction claims it captured for one module. */
export interface SubledgerClaim {
  post_module: string;
  /** Human name of the sweep that produced it, for the report. */
  source: string;
  /** The reconciling figure the sweep extracted, on the same one-sided basis as the ledger. */
  extracted: number;
}

export interface ModuleCoverage {
  post_module: string;
  lines: number;
  /**
   * The money that actually moved through this module.
   *
   * Half the absolute sum, because double-entry books every posting twice — once as a debit and once
   * as a credit. The SIGNED sum of a complete module is zero, so reporting that would show $0.00 for
   * a month in which the carrier spent millions.
   */
  oneSidedValue: number;
  /** Null when no sweep covers this module — an honest gap, not a zero. */
  source: string | null;
  extracted: number | null;
  /** extracted − oneSidedValue, or null when uncovered. */
  drift: number | null;
}

export interface LedgerCoverageReport {
  modules: ModuleCoverage[];
  /** See the caveat above `buildLedgerCoverageReport`. Not a cost total. */
  ledgerThroughput: number;
  coveredThroughput: number;
  uncoveredThroughput: number;
  /** Share of ledger THROUGHPUT a sweep stands behind, 0–100. A breadth signal, not a cost ratio. */
  throughputCoveragePct: number;
  /** Covered modules whose drift is not zero. Empty is the pass condition. */
  driftingModules: string[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Build the coverage report.
 *
 * `oneSidedValue` deliberately does NOT try to be the same quantity as a subledger's reconciling
 * figure for every module, because it is not. Fuel is the clearest case: the `FUEL` module moved
 * $1,191,574.09 one-sided in June 2026 while the fuel payable — the leg that has one line per
 * purchase — was $1,017,601.81, the difference being the card discount posting through its own
 * accounts. A caller therefore passes the claim it wants compared, and a module with a genuine
 * per-line reconciliation (fuel, settlement) should pass the figure that reconciler proved, not a
 * gross total. Drift is reported for visibility; `reconcileFuelToLedger` and
 * `reconcileSettlementToLedger` remain the authorities on whether a domain actually ties.
 *
 * ⚠ `ledgerThroughput` IS NOT "the carrier's money". It is the sum of what passed through every
 * posting module, and the modules are LIFECYCLE VIEWS OF THE SAME DOLLARS — D-MC13 at module scale.
 * Proven in this very dataset: `SET` ($1,390,599) is the settlement accrual and `DRS` ($2,067,340) is
 * the payment of those same settlements; `AP` ($2,770,827) contains the fuel-card invoices that
 * `FUEL` ($1,191,574) already booked, to the cent; `CASH` is the bank side of most of the rest.
 *
 * So the coverage percentage is a BREADTH signal — "which modules has anyone looked at" — and must
 * never be presented as "Silvicom 360 sees N% of the carrier's costs". Doing so would understate reality
 * badly, because a genuine cost total would count each dollar once. Deriving that total is a finance
 * exercise in choosing one lifecycle stage per dollar, which is exactly the work D-MC13 reserves for
 * the harness with finance's sign-off.
 */
export function buildLedgerCoverageReport(
  totals: GlModuleTotal[],
  claims: SubledgerClaim[] = [],
): LedgerCoverageReport {
  const claimByModule = new Map(claims.map((c) => [c.post_module, c]));

  const byModule = new Map<string, ModuleCoverage>();
  for (const t of totals) {
    const row = byModule.get(t.post_module);
    if (row) {
      row.lines += t.lines;
      row.oneSidedValue = round(row.oneSidedValue + t.abs_amount / 2);
    } else {
      byModule.set(t.post_module, {
        post_module: t.post_module,
        lines: t.lines,
        oneSidedValue: round(t.abs_amount / 2),
        source: null,
        extracted: null,
        drift: null,
      });
    }
  }

  let ledgerThroughput = 0;
  let coveredThroughput = 0;
  const driftingModules: string[] = [];

  for (const row of byModule.values()) {
    ledgerThroughput = round(ledgerThroughput + row.oneSidedValue);
    const claim = claimByModule.get(row.post_module);
    if (!claim) continue;
    row.source = claim.source;
    row.extracted = round(claim.extracted);
    row.drift = round(claim.extracted - row.oneSidedValue);
    coveredThroughput = round(coveredThroughput + row.oneSidedValue);
    if (row.drift !== 0) driftingModules.push(row.post_module);
  }

  return {
    modules: [...byModule.values()].sort((a, b) => b.oneSidedValue - a.oneSidedValue),
    ledgerThroughput,
    coveredThroughput,
    uncoveredThroughput: round(ledgerThroughput - coveredThroughput),
    throughputCoveragePct:
      ledgerThroughput === 0 ? 0 : round((coveredThroughput / ledgerThroughput) * 100),
    driftingModules,
  };
}

/**
 * One office-settlement line.
 *
 * The `OFF` module is the exception to "the GL carries only totals": it has no subledger at all.
 * Office payroll, bonuses and staff reimbursements post straight to the ledger, and the only
 * description is a 40-character free-text `descr` reading like "ARKADZIO, Office Payroll" or
 * "BIGRIG, Towing (truck # 506) reimbur". The line IS the record, so it is imported as one.
 *
 * `descr` is carried verbatim and NOT parsed. Truck numbers do appear in it — the same pattern that
 * puts repair vouchers into accounts payable — but a unit number scraped out of an abbreviated,
 * truncated note is a guess, and D-MC12 forbids the extraction layer from asserting an attribution
 * McLeod does not make itself. If the carrier wants office cost attributed to trucks, that is an
 * allocation rule the harness applies, with finance's sign-off, not a regex applied here.
 */
export const tmsOfficeSettlementLineSchema = z.object({
  /**
   * `gl_ledger.id` — the line's own key. Added when these stopped being report-only and started
   * being STAGED (0276): a rolling window re-reads the same lines every pass, so the upsert needs
   * an identity or each sweep would duplicate the payroll it already holds.
   */
  external_id: z.string().min(1).max(32),
  glid: z.string().max(20),
  descr: z.string().max(40).nullish(),
  payee_id: z.string().trim().min(1).max(8).nullish(),
  transacted_at: z.string().nullish(),
  amount: z.number().default(0),
  /** The McLeod company the line belongs to (0303, D-FIN8). */
  company_id: z.string().min(1).max(4).nullish(),
});
export type TmsOfficeSettlementLine = z.infer<typeof tmsOfficeSettlementLineSchema>;

export const tmsOfficeLinesPayloadSchema = z.object({
  lines: z.array(tmsOfficeSettlementLineSchema).max(2000),
  window_start: z.string(),
  window_end: z.string(),
});
export type TmsOfficeLinesPayload = z.infer<typeof tmsOfficeLinesPayloadSchema>;
