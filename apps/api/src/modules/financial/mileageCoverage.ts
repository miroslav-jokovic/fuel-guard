import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assessMileageCoverage,
  periodDenominator,
  type MonthMileage,
  type MonthMileageInput,
} from "@silvicom/shared";
import { readMonthlyMileageByMonth } from "../samsara/index.js";
import { readBilledMilesByDeliveryMonth } from "../mcleod/index.js";

/**
 * Mileage coverage for a period (G4 + G10) — how many trucks each month measured, whether that was
 * all of them, and therefore whether a per-mile figure over the period means anything.
 *
 * Two collectors, read through their own interfaces (D-SEP1), and no arithmetic here: the rule
 * lives in `assessMileageCoverage` / `periodDenominator` in `@silvicom/shared`, which is where it
 * is tested and mutation-tested. This service exists to fetch and to bucket, nothing else.
 *
 * **Why both sides.** Samsara alone cannot say whether it measured everything — a month in which
 * half the gateways were unplugged looks exactly like a quiet month. Billing knows which trucks
 * delivered a load, so the comparison is what turns "some miles" into "all the miles" or into a
 * named gap. Neither source can answer it alone, which is why this reads two.
 */

export interface MileageCoverageResult {
  months: MonthMileage[];
  /** Total measured miles for the period, or null with a reason a page can print. */
  miles: number | null;
  /** The fleet size behind those miles — the busiest month, not a sum (G4). */
  trucks: number | null;
  /** Why there is no denominator. Null when there is one. */
  reason: string | null;
  billedMiles: number;
  loads: number;
  billedRevenue: number;
}

function monthsBetween(fromIso: string, toIso: string): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  let y = Number(fromIso.slice(0, 4));
  let m = Number(fromIso.slice(5, 7));
  const endY = Number(toIso.slice(0, 4));
  const endM = Number(toIso.slice(5, 7));
  // Inclusive of the month `to` falls in: a period ending mid-month still ran in that month.
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ year: y, month: m });
    if (m === 12) {
      y++;
      m = 1;
    } else m++;
  }
  return out;
}

export async function getMileageCoverage(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<MileageCoverageResult> {
  const months = monthsBetween(fromIso, toIso);
  // The billing read spans whole months too, so a truck that delivered on the 31st is not
  // compared against a Samsara month that includes it.
  const first = `${months[0]!.year}-${String(months[0]!.month).padStart(2, "0")}-01`;
  const last = months[months.length - 1]!;
  const afterLast =
    last.month === 12
      ? `${last.year + 1}-01-01`
      : `${last.year}-${String(last.month + 1).padStart(2, "0")}-01`;

  const [measured, billed] = await Promise.all([
    readMonthlyMileageByMonth(admin, orgId, months),
    readBilledMilesByDeliveryMonth(admin, orgId, first, afterLast),
  ]);

  const inputs: MonthMileageInput[] = months.map(({ year, month }) => {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const s = measured.get(key);
    const b = billed.get(key);
    return {
      month: key,
      measuredTrucks: s?.trucks ?? 0,
      measuredMiles: s?.miles ?? 0,
      deliveringTrucks: b?.trucks ?? 0,
      billedMiles: b?.miles ?? 0,
    };
  });

  const assessed = assessMileageCoverage(inputs);
  const denom = periodDenominator(assessed);
  let billedMiles = 0;
  let loads = 0;
  let billedRevenue = 0;
  for (const b of billed.values()) {
    billedMiles += b.miles;
    loads += b.loads;
    billedRevenue += b.revenue;
  }

  return {
    months: assessed,
    miles: denom.miles,
    trucks: denom.trucks,
    reason: denom.reason,
    billedMiles: Math.round(billedMiles * 10) / 10,
    loads,
    billedRevenue: Math.round(billedRevenue * 100) / 100,
  };
}
