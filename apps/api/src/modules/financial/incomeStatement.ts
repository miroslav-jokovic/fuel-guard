import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIncomeStatement, type IncomeStatement, type LedgerTotalRow } from "@silvicom/shared";
import { readLedgerTotalsRange, readGlAccounts } from "../mcleod/index.js";

/**
 * The income statement, as the owner's own printed P&L reads it (G3, FINANCE-FLEET-REPORT-PLAN §2).
 *
 * This service does I/O and nothing else — the statement itself is built by the pure
 * `buildIncomeStatement` in `@silvicom/shared`, which is where every rule about ordering, signs,
 * classes and shares lives and where the tests are. Two reads, one call, no arithmetic here.
 *
 * **Why the to-date column is fiscal-year-to-date rather than trailing-twelve.** It is the column
 * McLeod prints, the carrier's fiscal year is the calendar year (verified: the July statement's YTD
 * revenue 28,687,090.14 is exactly January through July of the staged ledger), and a report whose
 * comparative differs from the one the owner already reads is a report that has to be explained
 * before it can be used.
 */

export interface IncomeStatementResult extends IncomeStatement {
  /** Months whose GL totals are staged, of the months the period asked for. */
  monthsCovered: string[];
  monthsMissing: string[];
  /** The fiscal-year window the to-date column covers, for the page to state. */
  toDateFrom: string;
}

/** First day of the month a `YYYY-MM-DD` date falls in. */
function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** First day of the month AFTER the one `iso` falls in — the half-open upper bound. */
function nextMonthStart(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** Every month start from `from` up to but not including `toExclusive`. */
function monthsBetween(from: string, toExclusive: string): string[] {
  const out: string[] = [];
  for (let m = from; m < toExclusive; m = nextMonthStart(m)) out.push(m);
  return out;
}

const toRow = (r: { glid: string; post_module: string; net_amount: number | string; line_count: number }): LedgerTotalRow => ({
  glid: r.glid,
  post_module: r.post_module,
  net_amount: Number(r.net_amount),
  line_count: r.line_count,
});

/**
 * Build the statement for the calendar months touched by `[from, to)`.
 *
 * GL totals are month-grained, so a request for part of a month gets that whole month and the
 * caller is told which months it covered — the alternative is prorating a month's journal entries
 * across days, which is an allocation, and this section does not allocate (D-FLEET8). W1 is the
 * step that makes a sub-month period possible; until it lands, the honest answer is the month.
 */
export async function getIncomeStatement(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<IncomeStatementResult> {
  const periodFrom = monthStart(fromIso);
  const periodTo = nextMonthStart(toIso);
  // Fiscal year to the end of the period. A period spanning a year boundary anchors on its LAST
  // month's year, which is what "year to date" means on the statement being reproduced.
  const toDateFrom = `${periodTo.slice(0, 4)}-01-01`;
  const toDateStart = toDateFrom <= periodFrom ? toDateFrom : periodFrom;

  const [rows, accounts] = await Promise.all([
    readLedgerTotalsRange(admin, orgId, toDateStart, periodTo),
    readGlAccounts(admin, orgId),
  ]);

  const period: LedgerTotalRow[] = [];
  const toDate: LedgerTotalRow[] = [];
  const covered = new Set<string>();
  for (const r of rows) {
    const month = String(r.period_start).slice(0, 10);
    toDate.push(toRow(r));
    if (month >= periodFrom && month < periodTo) {
      period.push(toRow(r));
      covered.add(month.slice(0, 7));
    }
  }

  const asked = monthsBetween(periodFrom, periodTo).map((m) => m.slice(0, 7));
  return {
    ...buildIncomeStatement({ period, toDate, accounts }),
    monthsCovered: asked.filter((m) => covered.has(m)),
    // A month the sweep has not reached is a stated absence, never a zero row on a statement
    // (D-FIN10 at month grain): the page says which months are missing rather than showing a
    // total that quietly excludes them.
    monthsMissing: asked.filter((m) => !covered.has(m)),
    toDateFrom: toDateStart,
  };
}
