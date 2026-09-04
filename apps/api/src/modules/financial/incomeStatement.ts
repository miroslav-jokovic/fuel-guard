import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIncomeStatement, type IncomeStatement, type LedgerMonth } from "@silvicom/shared";
import { monthStart, monthsBetween, nextMonthStart, readLedgerForPeriod } from "./ledgerPeriod.js";

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
 *
 * ── The comparative column (R6 of the UI plan) ────────────────────────────────────────────────
 * The harness takes one set of comparative rows and calls them `toDate`, because the printed
 * statement's comparative is the fiscal year to date. A reader comparing July with June wants the
 * same column holding June instead, and a reader printing the month alone wants no column at all.
 * `compare` chooses which rows go in: the fiscal year to the period's end (`ytd`, the default),
 * the period of the same length immediately before (`previous`), or nothing (`none`). Whichever it
 * is, `comparison` says so in the response, so the page labels the column by what it holds rather
 * than by what the harness calls it.
 */

export type StatementCompare = "ytd" | "previous" | "none";

export interface StatementComparison {
  kind: StatementCompare;
  /** The comparative window's inclusive first day and exclusive bound, `YYYY-MM-DD`. Null for `none`. */
  from: string | null;
  to: string | null;
  /** Which of the comparative window's months the sweep has finished, and which it has not. */
  monthsCovered: string[];
  monthsMissing: string[];
}

export interface IncomeStatementResult extends IncomeStatement {
  /** Months whose GL totals are staged, of the months the period asked for. */
  monthsCovered: string[];
  monthsMissing: string[];
  /** Months a sweep reached mid-month; their rows are staged, real, and left out (G11). */
  monthsPartial: LedgerMonth[];
  ledgerReason: string | null;
  /** The window the comparative column covers, for the page to state. */
  toDateFrom: string;
  comparison: StatementComparison;
}

/** `shiftMonthStart("2026-07-01", -3)` is `"2026-04-01"`. Pure calendar arithmetic on a month start. */
function shiftMonthStart(iso: string, by: number): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)) - 1 + by;
  const d = new Date(Date.UTC(year, month, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function getIncomeStatement(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
  compare: StatementCompare = "ytd",
): Promise<IncomeStatementResult> {
  const ledger = await readLedgerForPeriod(admin, orgId, fromIso, toIso);

  let comparativeRows: typeof ledger.toDate | undefined = ledger.toDate;
  let comparison: StatementComparison = {
    kind: "ytd",
    from: ledger.toDateFrom,
    to: nextMonthStart(toIso),
    monthsCovered: ledger.monthsCovered,
    monthsMissing: ledger.monthsMissing,
  };

  if (compare === "none") {
    comparativeRows = undefined;
    comparison = { kind: "none", from: null, to: null, monthsCovered: [], monthsMissing: [] };
  } else if (compare === "previous") {
    // The same number of whole months, ending where this period starts. A month compares with the
    // month before, a quarter with the quarter before; a custom run of n months with the n before
    // it. Read through the same reader, so a comparative month the sweep reached mid-month is
    // withheld from the comparison exactly as it would be from the period (G11).
    const periodFrom = monthStart(fromIso);
    const span = monthsBetween(periodFrom, nextMonthStart(toIso)).length;
    const previousFrom = shiftMonthStart(periodFrom, -span);
    const previousLast = shiftMonthStart(periodFrom, -1);
    const previous = await readLedgerForPeriod(admin, orgId, previousFrom, previousLast);
    comparativeRows = previous.period;
    comparison = {
      kind: "previous",
      from: previousFrom,
      to: periodFrom,
      monthsCovered: previous.monthsCovered,
      monthsMissing: previous.monthsMissing,
    };
  }

  return {
    ...buildIncomeStatement({
      period: ledger.period,
      toDate: comparativeRows,
      accounts: ledger.accounts,
    }),
    monthsCovered: ledger.monthsCovered,
    monthsMissing: ledger.monthsMissing,
    monthsPartial: ledger.monthsPartial,
    ledgerReason: ledger.ledgerReason,
    toDateFrom: comparison.from ?? ledger.toDateFrom,
    comparison,
  };
}
