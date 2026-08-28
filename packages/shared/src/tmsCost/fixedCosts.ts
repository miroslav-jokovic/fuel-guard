import { z } from "zod";

/**
 * Fixed per-truck costs from the office's schedule (T1, TRUCK-COST-ATTRIBUTION-PLAN) — the lease,
 * insurance and GPS dollars McLeod structurally cannot attribute (0 of 188,179 GL lines carry a
 * tractor, D-MC12). A schedule row is a CONTRACT's assertion, not a measurement, so everything
 * here keeps the same posture as the CPM harness: charged per truck, reported in its own column,
 * never blended into the measured direct figures.
 *
 * The charging rule, printed on the report rather than hidden here: amounts are MONTHLY, ranges
 * are half-open `[effective_from, effective_to)` with both ends first-of-month (the migration
 * constrains this), and a month is charged whole when the range covers its first day. No
 * proration — a monthly premium has no daily granularity to prorate to.
 */

export const FIXED_COST_CATEGORIES = ["lease", "insurance", "gps", "permit", "other"] as const;
export type FixedCostCategory = (typeof FIXED_COST_CATEGORIES)[number];

/** One schedule row, as stored and as the API accepts it. */
export const truckCostScheduleSchema = z.object({
  unit_number: z.string().trim().min(1).max(20),
  category: z.enum(FIXED_COST_CATEGORIES),
  label: z.string().trim().min(1).max(120),
  monthly_amount: z.number().positive().max(1_000_000),
  /** First of a month, YYYY-MM-01 — the DB constraint's mirror, refused here before it 500s there. */
  effective_from: z.string().regex(/^\d{4}-\d{2}-01$/),
  effective_to: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/)
    .nullish(),
  notes: z.string().max(500).nullish(),
});
export type TruckCostScheduleInput = z.infer<typeof truckCostScheduleSchema>;

export interface TruckCostScheduleRow extends TruckCostScheduleInput {
  id: string;
}

export interface FixedCostSummary {
  /** Dollars charged per tractor unit over the window's months. */
  byUnit: Record<string, number>;
  /** Dollars per category, fleet-wide — the figure finance eyeballs against the P&L line. */
  byCategory: Record<string, number>;
  total: number;
  /** Months the window covered — the multiplier a reviewer needs to sanity-check a figure. */
  monthCount: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Charge the schedule over a set of calendar months. Pure; months come from the caller because
 * only the caller knows the report window (the CPM endpoint already computes them for Samsara).
 */
export function sumFixedCosts(
  rows: TruckCostScheduleRow[],
  months: Array<{ year: number; month: number }>,
): FixedCostSummary {
  const byUnit: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const m of months) {
    const first = `${m.year}-${String(m.month).padStart(2, "0")}-01`;
    for (const r of rows) {
      if (r.effective_from > first) continue;
      if (r.effective_to != null && r.effective_to <= first) continue;
      const unit = r.unit_number.trim();
      byUnit[unit] = round((byUnit[unit] ?? 0) + r.monthly_amount);
      byCategory[r.category] = round((byCategory[r.category] ?? 0) + r.monthly_amount);
      total = round(total + r.monthly_amount);
    }
  }
  return { byUnit, byCategory, total, monthCount: months.length };
}

/**
 * The caveats a report carrying these figures must print — generated from what THIS summary
 * contains, same doctrine as the harness's own caveat list.
 */
export function fixedCostCaveats(summary: FixedCostSummary, uncoveredActiveTrucks: number): string[] {
  const caveats: string[] = [];
  if (summary.total <= 0) {
    caveats.push(
      "The fixed-cost schedule has no rows for this window — lease, insurance and GPS are NOT in " +
        "these figures, and full cost per mile equals direct cost per mile until the office enters " +
        "the schedule.",
    );
    return caveats;
  }
  const perCategory = Object.entries(summary.byCategory)
    .sort(([, a], [, b]) => b - a)
    .map(([c, d]) => `${c} $${d.toFixed(2)}`)
    .join(", ");
  caveats.push(
    `Fixed costs charge the office's schedule — contracts, not measurements — whole months over ` +
      `${summary.monthCount} month(s): ${perCategory}. Compare each category total against its ` +
      `income-statement line; a shortfall means the schedule is incomplete, not that the cost is low.`,
  );
  if (uncoveredActiveTrucks > 0) {
    caveats.push(
      `${uncoveredActiveTrucks} truck(s) with activity in this window have no fixed-cost schedule ` +
        `row — their full cost per mile omits lease/insurance/GPS and reads low against the fleet.`,
    );
  }
  return caveats;
}
