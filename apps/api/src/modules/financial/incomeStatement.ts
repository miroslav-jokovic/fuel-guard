import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIncomeStatement, type IncomeStatement, type LedgerMonth } from "@silvicom/shared";
import { readLedgerForPeriod } from "./ledgerPeriod.js";

/**
 * The income statement, as the owner's own printed P&L reads it (G3, FINANCE-FLEET-REPORT-PLAN §2).
 *
 * This service does I/O and nothing else — the statement itself is built by the pure
 * `buildIncomeStatement` in `@silvicom/shared`, which is where every rule about ordering, signs,
 * classes and shares lives and where the tests are. One read, one call, no arithmetic here.
 *
 * The period reading, the fiscal-year comparative and the month-widening rule live in
 * `ledgerPeriod.ts`, shared with the fleet report so that "which months did this figure cover" has
 * one answer wherever it is asked.
 */

export interface IncomeStatementResult extends IncomeStatement {
  /** Months whose GL totals are staged, of the months the period asked for. */
  monthsCovered: string[];
  monthsMissing: string[];
  /** Months a sweep reached mid-month; their rows are staged, real, and left out (G11). */
  monthsPartial: LedgerMonth[];
  ledgerReason: string | null;
  /** The fiscal-year window the to-date column covers, for the page to state. */
  toDateFrom: string;
}

export async function getIncomeStatement(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<IncomeStatementResult> {
  const ledger = await readLedgerForPeriod(admin, orgId, fromIso, toIso);
  return {
    ...buildIncomeStatement({
      period: ledger.period,
      toDate: ledger.toDate,
      accounts: ledger.accounts,
    }),
    monthsCovered: ledger.monthsCovered,
    monthsMissing: ledger.monthsMissing,
    monthsPartial: ledger.monthsPartial,
    ledgerReason: ledger.ledgerReason,
    toDateFrom: ledger.toDateFrom,
  };
}
