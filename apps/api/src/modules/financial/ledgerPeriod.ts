import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerTotalRow, LedgerAccount } from "@silvicom/shared";
import { readLedgerTotalsRange, readGlAccounts } from "../mcleod/index.js";

/**
 * Reading the ledger for a reporting period, once, for everything that needs it.
 *
 * **Why this is shared rather than duplicated.** Two services need the same three things — the
 * period's rows, the fiscal-year rows behind the comparative column, and which months actually
 * arrived — and both need the same widening rule. A second copy of that rule is a second place for
 * "which months did this figure cover" to drift, and the whole point of this section is that the
 * answer to that question is the same everywhere it is asked.
 *
 * **The widening rule.** GL control totals are month-grained (`period_start`, `period_end`), so a
 * request for 14 July to 3 August is answered with July AND August whole. The alternative is
 * prorating a month's journal entries across its days, which is an allocation, and this section
 * does not allocate (D-FLEET8). Measured 2026-09-03, that is not a marginal concern: 26.2% of
 * July's expenses arrived as 44 journal lines averaging $24,210 — the lease, the insurance and the
 * payroll — so a prorated part-month would be three cheap weeks and one enormous one.
 *
 * **The comparative is fiscal-year-to-date** because that is the column McLeod prints and the
 * carrier's fiscal year is the calendar year — verified: July's printed YTD revenue of
 * 28,687,090.14 is exactly January through July of the staged ledger. A report whose comparative
 * differs from the one the owner already reads has to be explained before it can be used.
 */

/** First day of the month a `YYYY-MM-DD` date falls in. */
export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** First day of the month AFTER the one `iso` falls in — the half-open upper bound. */
export function nextMonthStart(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** Every month start from `from` up to but not including `toExclusive`. */
export function monthsBetween(from: string, toExclusive: string): string[] {
  const out: string[] = [];
  for (let m = from; m < toExclusive; m = nextMonthStart(m)) out.push(m);
  return out;
}

export interface LedgerPeriod {
  /** Rows inside the calendar months the requested window touches. */
  period: LedgerTotalRow[];
  /** Rows from the start of the fiscal year (or the window, if it starts earlier) to the same end. */
  toDate: LedgerTotalRow[];
  accounts: LedgerAccount[];
  monthsCovered: string[];
  /** Months the window asked for that no sweep has landed. A stated absence, never a zero row. */
  monthsMissing: string[];
  toDateFrom: string;
}

const toRow = (r: {
  glid: string;
  post_module: string;
  net_amount: number | string;
  line_count: number;
}): LedgerTotalRow => ({
  glid: r.glid,
  post_module: r.post_module,
  net_amount: Number(r.net_amount),
  line_count: r.line_count,
});

export async function readLedgerForPeriod(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<LedgerPeriod> {
  const periodFrom = monthStart(fromIso);
  const periodTo = nextMonthStart(toIso);
  // A window spanning a year boundary anchors its "year to date" on the LAST month's year, which is
  // what the phrase means on the statement being reproduced. A window that starts before that year
  // reads from where it starts, so nothing it asked for is silently dropped.
  const fiscalStart = `${periodTo.slice(0, 4)}-01-01`;
  const toDateFrom = fiscalStart <= periodFrom ? fiscalStart : periodFrom;

  const [rows, accounts] = await Promise.all([
    readLedgerTotalsRange(admin, orgId, toDateFrom, periodTo),
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
    period,
    toDate,
    accounts,
    monthsCovered: asked.filter((m) => covered.has(m)),
    monthsMissing: asked.filter((m) => !covered.has(m)),
    toDateFrom,
  };
}
