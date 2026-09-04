import { buildIncomeStatement, type LedgerTotalRow, type LedgerAccount } from "./incomeStatement.js";
import { periodDenominator, type MonthMileage } from "./mileageCoverage.js";
import { perMileRate } from "./fleetReport.js";

/**
 * The twelve-month trend (G9) — what the fleet earned, spent and kept on every mile, month by
 * month, so a single period's figure can be read as a point on a line rather than as a verdict.
 *
 * **Why a trend is part of the report and not a decoration.** The overview answers "what did July
 * cost per mile"; nobody can act on that answer without knowing whether it is where the fleet has
 * been sitting or where it has just moved to. $2.61 spent per mile is good news after four months
 * at $2.80 and bad news after four at $2.45, and the same number is on the screen either way.
 *
 * **Three rules, each of which is a refusal:**
 *
 *  1. **A month the ledger has not reached is not a month with no money.** The McLeod sweep lands a
 *     month at a time; plotting an unswept month as zero draws a collapse to the axis that never
 *     happened, and a chart is read faster than the footnote under it. Such months are excluded
 *     from the series and NAMED, so their absence is a fact the page can print.
 *  2. **A month whose mileage coverage is short keeps its money and loses its rates** (D-FIN10,
 *     G10). Measured 2026-09-03: January measured 130 of the 139 trucks that delivered a load and
 *     February 135 of 151, so a rate over those months is inflated by roughly the share of the
 *     fleet the denominator is missing — about eleven per cent in February — and looks entirely
 *     plausible. The line breaks over those months and the money still shows.
 *  3. **The per-month reason is the same rule as the per-period one.** It is `periodDenominator`
 *     over the single month, not a second phrasing of the same judgement, so a month rejected here
 *     and a period rejected on the overview can never give a reader two different explanations.
 *
 * Pure, like every other file in this directory: no clock, no I/O, and no constant that is a month,
 * a dollar or a rate. Which months to ask for is the caller's decision (D-FLEET6).
 */

/** One month's inputs: the ledger rows that landed in it, and what Samsara measured over it. */
export interface FleetTrendMonthInput {
  /** `YYYY-MM`. */
  month: string;
  /** The month's `mcleod_gl_totals` rows. Empty means the sweep has not reached it. */
  ledger: LedgerTotalRow[];
  /** The month's coverage assessment, absent when Samsara measured nothing at all. */
  mileage?: MonthMileage;
}

export interface FleetTrendInputs {
  months: FleetTrendMonthInput[];
  /** McLeod's chart of accounts — the same master the income statement classifies against. */
  accounts: LedgerAccount[];
}

export interface FleetTrendPoint {
  month: string;
  revenue: number;
  expenses: number;
  net: number;
  /** Measured miles, or null when this month's coverage cannot support a rate. */
  miles: number | null;
  trucks: number | null;
  revenuePerMile: number | null;
  costPerMile: number | null;
  netPerMile: number | null;
  /** Why this month carries no rate, in the words the overview uses. Null when it carries one. */
  reason: string | null;
}

export interface FleetTrend {
  /** Oldest first — a chart is read left to right, and the sort is here rather than in a template. */
  points: FleetTrendPoint[];
  /** Months asked for that the ledger has not reached. Stated, never plotted as a zero. */
  missing: string[];
  /** How many plotted months carry rates. Zero means the chart has money and no lines at all. */
  rated: number;
}

const round = (n: number) => Math.round(n * 100) / 100 + 0;

export function computeFleetTrend(inputs: FleetTrendInputs): FleetTrend {
  const points: FleetTrendPoint[] = [];
  const missing: string[] = [];

  for (const m of inputs.months) {
    if (!m.ledger.length) {
      missing.push(m.month);
      continue;
    }
    // The same builder the income statement and the fleet report use. A month's revenue and
    // expenses are one statement's totals, so a trend point can never disagree with the tab beside
    // it about what the month earned.
    const statement = buildIncomeStatement({ period: m.ledger, accounts: inputs.accounts });

    // One month is a period of one. Asking `periodDenominator` rather than re-reading `complete`
    // keeps the coverage rule — and its wording — in the single place it is mutation-tested.
    const denom = periodDenominator(m.mileage ? [m.mileage] : []);
    const net = round(statement.revenue - statement.expenses);
    points.push({
      month: m.month,
      revenue: round(statement.revenue),
      expenses: round(statement.expenses),
      net,
      miles: denom.miles,
      trucks: denom.trucks,
      revenuePerMile: perMileRate(statement.revenue, denom.miles),
      costPerMile: perMileRate(statement.expenses, denom.miles),
      netPerMile: perMileRate(net, denom.miles),
      reason: denom.reason,
    });
  }

  points.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  missing.sort();
  return { points, missing, rated: points.filter((p) => p.costPerMile !== null).length };
}
