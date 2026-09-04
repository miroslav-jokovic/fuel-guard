import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeFleetTrend,
  assessLedgerMonths,
  type FleetTrend,
  type FleetTrendMonthInput,
  type LedgerMonth,
} from "@silvicom/shared";
import { readLedgerTotalsRange, readGlAccounts } from "../mcleod/index.js";
import { monthStart, nextMonthStart, monthsBetween } from "./ledgerPeriod.js";
import { getMileageCoverage } from "./mileageCoverage.js";

/**
 * The trend behind the overview (G9) — earned, spent and kept per mile for each of the last N
 * months, so the period on screen can be read as a point on a line.
 *
 * I/O only, like every other service in this module: the months are bucketed here and every figure
 * is computed by `computeFleetTrend` in `@silvicom/shared`, where the rules are mutation-tested.
 *
 * **Why it is its own call rather than a field on the fleet report.** The two have different
 * windows. The report reads the period the reader picked plus its fiscal year to date; the trend
 * reads a fixed span of whole months ending at that period, which is neither. Folding the trend
 * into the report would widen every report read to a year for a chart the reader may never scroll
 * to, and folding the report into the trend would recompute twelve income statements to print one.
 *
 * **A month swept before it ended is dropped, not drawn** (G11). The financial sweep runs by hand,
 * so the newest month holds whatever had posted when the last run went — August 2026, measured on
 * the 3rd of September, held eleven lines and no revenue at all. Plotted, that is a cliff to the
 * axis on the final point of the chart, which is the most alarming shape a finance page can draw
 * and would be an artefact of an unfinished sweep. Such months join `missing` and are named beneath
 * the chart with the date they were swept.
 *
 * **The window is whole months, always.** The ledger is month-grained, so a trend of part-months
 * would need the journal entries prorated across days — 26.2% of July's expenses arrived as 44
 * entries averaging $24,210 — and this section does not allocate (D-FLEET8). The last point is
 * therefore the whole month the requested date falls in, which is also the month the overview beside
 * it is describing.
 */

export interface FleetTrendResult extends FleetTrend {
  /** The whole months the series covers, oldest first — what was ASKED for, not what came back. */
  monthsRequested: string[];
  /** Months a sweep reached mid-month. Excluded from the series, named under it (G11). */
  monthsPartial: LedgerMonth[];
}

/** The `YYYY-MM` month `count` months back from (and including) the month `toIso` falls in. */
function windowStart(toIso: string, count: number): string {
  let start = monthStart(toIso);
  for (let i = 1; i < count; i++) {
    const year = Number(start.slice(0, 4));
    const month = Number(start.slice(5, 7));
    start = month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, "0")}-01`;
  }
  return start;
}

export async function getFleetTrend(
  admin: SupabaseClient,
  orgId: string,
  toIso: string,
  monthCount: number,
): Promise<FleetTrendResult> {
  const from = windowStart(toIso, monthCount);
  const toExclusive = nextMonthStart(toIso);
  const asked = monthsBetween(from, toExclusive);

  // Coverage is read through its own service rather than re-derived, so a month refused a rate on
  // the chart is refused for exactly the reason the banner above it gives. It takes the requested
  // date, not the exclusive bound, because it already widens to the month that date falls in. The
  // denominator it computes for the whole span is deliberately unused — a year containing January
  // is short for the year and complete for July, and the chart's question is the month's.
  const [rows, accounts, coverage] = await Promise.all([
    readLedgerTotalsRange(admin, orgId, from, toExclusive),
    readGlAccounts(admin, orgId),
    getMileageCoverage(admin, orgId, from, toIso),
  ]);

  const ledgerByMonth = new Map<string, FleetTrendMonthInput["ledger"]>();
  const sweeps = new Map<string, { periodEnd: string; sweptAt: string | null }>();
  for (const r of rows) {
    const month = String(r.period_start).slice(0, 7);
    const bucket = ledgerByMonth.get(month);
    const row = {
      glid: r.glid,
      post_module: r.post_module,
      net_amount: Number(r.net_amount),
      line_count: r.line_count,
    };
    if (bucket) bucket.push(row);
    else ledgerByMonth.set(month, [row]);

    // The oldest sweep behind the month, for the reason `ledgerPeriod` gives: the month is only
    // finished when every row behind it came from a run that saw a finished month.
    const sweptAt = r.swept_at ? String(r.swept_at) : null;
    const seen = sweeps.get(month);
    if (!seen) sweeps.set(month, { periodEnd: String(r.period_end).slice(0, 10), sweptAt });
    else if (!sweptAt || !seen.sweptAt || sweptAt < seen.sweptAt) seen.sweptAt = sweptAt;
  }

  // A month whose sweep ran before it ended is handed to the harness as if the ledger had not
  // reached it, which is exactly what it deserves: its rows are real, they are not the month, and
  // the harness already knows how to name a month it cannot plot rather than drawing it at zero.
  const partial = assessLedgerMonths(
    [...sweeps.entries()].map(([month, v]) => ({ month, periodEnd: v.periodEnd, sweptAt: v.sweptAt })),
  ).filter((m) => m.shortfall === "partial");
  for (const m of partial) ledgerByMonth.delete(m.month);
  const coverageByMonth = new Map(coverage.months.map((m) => [m.month, m]));

  const trend = computeFleetTrend({
    months: asked.map((m) => {
      const month = m.slice(0, 7);
      return {
        month,
        ledger: ledgerByMonth.get(month) ?? [],
        mileage: coverageByMonth.get(month),
      };
    }),
    accounts,
  });

  return { ...trend, monthsRequested: asked.map((m) => m.slice(0, 7)), monthsPartial: partial };
}
