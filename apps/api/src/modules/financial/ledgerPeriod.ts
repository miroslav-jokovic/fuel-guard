import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assessLedgerMonths,
  ledgerMonthsReason,
  type LedgerTotalRow,
  type LedgerAccount,
  type LedgerMonth,
} from "@silvicom/shared";
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
 * **A month that was swept before it ended is not a month** (G11, `ledgerMonths.ts`). The financial
 * sweep is run by hand, so between the 1st and the next run the newest month holds whatever had
 * posted when the last sweep went — measured 2026-09-03, August held eleven lines, $8,430.00 of
 * expense and no revenue, and the page that opens on the last full month reported exactly that as
 * the month. Such months are excluded from BOTH the period and the year to date and returned in
 * `monthsPartial` with the date they were swept, on the same principle as `monthsMissing`: a stated
 * absence, never a figure that is real and is not the answer.
 *
 * **A month swept after it ended but not yet posted is not a month either** (Q10, ruled
 * 2026-10-10). McLeod's accountant posts a month 10–39 days after it ends, so September 2026, swept
 * on 10-09, held eight recurring-journal lines and nothing else. `assessLedgerMonths` refuses a
 * month that lacks the module that earned or spent the most in the last complete month before it,
 * which is why the read below reaches back over the WHOLE staged history and not just the window:
 * January is judged against December, and a window that starts in January has no December in it.
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
  /**
   * Months a sweep reached while they were still running (G11), or after they ended but before
   * McLeod posted them (`unposted`, Q10). Their rows are real and are excluded, because part of a
   * month reported as the month is a precise and entirely wrong answer.
   */
  monthsPartial: LedgerMonth[];
  /** What a page prints in place of the excluded months' figures. Null when nothing is short. */
  ledgerReason: string | null;
  toDateFrom: string;
}

/**
 * The whole staged history's lower bound. Not a reporting decision — every month the collector ever
 * staged is read so that each one is judged against the month before it (Q10). The ledger is a few
 * hundred rows a month, so this is pages, not a scan.
 */
export const HISTORY_FROM = "1900-01-01";

type StagedRow = Awaited<ReturnType<typeof readLedgerTotalsRange>>[number];

/**
 * Every staged month's verdict, from rows already read. Shared with `fleetTrend.ts` so the report
 * and the chart beside it can never disagree about which month is finished.
 *
 * The OLDEST sweep behind a month, not the newest. `mcleod_gl_totals` is keyed per company as well
 * as per month, so a month can hold one company swept after it closed and another swept while it
 * was still running — and a fleet total built from those is short by one company's books. The
 * oldest stamp is the one that says whether every row behind the total saw a finished month.
 * (Today this carrier stages one company, "TMS", so the two agree; the rule is written for the day
 * it does not, which no assertion about today's data would catch.)
 */
export function assessStagedRows(rows: StagedRow[], accounts: LedgerAccount[]): LedgerMonth[] {
  const seen = new Map<string, { periodEnd: string; sweptAt: string | null; rows: LedgerTotalRow[] }>();
  for (const r of rows) {
    const month = String(r.period_start).slice(0, 7);
    const cur = seen.get(month);
    const sweptAt = r.swept_at ? String(r.swept_at) : null;
    if (!cur) seen.set(month, { periodEnd: String(r.period_end).slice(0, 10), sweptAt, rows: [toRow(r)] });
    else {
      cur.rows.push(toRow(r));
      if (!sweptAt || !cur.sweptAt || sweptAt < cur.sweptAt) cur.sweptAt = sweptAt;
    }
  }
  return assessLedgerMonths(
    [...seen.entries()].map(([month, v]) => ({ month, periodEnd: v.periodEnd, sweptAt: v.sweptAt, rows: v.rows })),
    accounts,
  );
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

  const [history, accounts] = await Promise.all([
    readLedgerTotalsRange(admin, orgId, HISTORY_FROM, periodTo),
    readGlAccounts(admin, orgId),
  ]);

  // Which months the sweep actually finished, before a single figure is added up — judged over the
  // whole history (Q10), then narrowed to the rows this period reads. The rules live in
  // `@silvicom/shared`, where they are mutation-tested.
  const assessed = assessStagedRows(history, accounts);
  const rows = history.filter((r) => String(r.period_start).slice(0, 10) >= toDateFrom);
  const usable = new Set(assessed.filter((m) => m.complete).map((m) => m.month));

  const period: LedgerTotalRow[] = [];
  const toDate: LedgerTotalRow[] = [];
  const covered = new Set<string>();
  for (const r of rows) {
    const month = String(r.period_start).slice(0, 10);
    if (!usable.has(month.slice(0, 7))) continue;
    toDate.push(toRow(r));
    if (month >= periodFrom && month < periodTo) {
      period.push(toRow(r));
      covered.add(month.slice(0, 7));
    }
  }

  const asked = monthsBetween(periodFrom, periodTo).map((m) => m.slice(0, 7));
  // Only the months the WINDOW asked for are reported as short. A fiscal year-to-date read reaches
  // back to January, and a January the sweep never finished is not this period's news.
  const partial = assessed.filter(
    (m) => (m.shortfall === "partial" || m.shortfall === "unposted") && asked.includes(m.month),
  );
  return {
    period,
    toDate,
    accounts,
    monthsCovered: asked.filter((m) => covered.has(m)),
    monthsMissing: asked.filter((m) => !covered.has(m) && !partial.some((p) => p.month === m)),
    monthsPartial: partial,
    ledgerReason: ledgerMonthsReason(partial),
    toDateFrom,
  };
}
