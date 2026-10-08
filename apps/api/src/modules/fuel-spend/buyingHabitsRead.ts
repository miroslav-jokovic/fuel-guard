/**
 * The buying-habits table's read (F02-F04 chunk 9a, Q-F2). The arithmetic is `buyingHabitsTable` in
 * shared; this file only reads, scopes and pages.
 *
 * Whole months: the window's start is moved to the first of its month, because a habit finding is a
 * truck-month dated on the first day, and a window opening on the 12th would otherwise drop the month it
 * opens in. Trucks resolve to unit numbers, as every read of this ledger does (`vehicle_id` is never
 * written on it). Paged to the end, not capped: a total that stops at PostgREST's 1,000 rows would be a
 * ceiling reported as a sum.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUYING_HABIT_KINDS,
  BUYING_HABIT_STATUSES,
  buyingHabitsTable,
  monthStartOf,
  type BuyingHabitFinding,
  type BuyingHabitsTable,
} from "@silvicom/shared";
import { fetchAllPaged } from "../../lib/paging.js";
import { fleetScope } from "./findingsRead.js";

export interface BuyingHabitFilters {
  from?: string | null;
  to?: string | null;
  vehicleIds?: string[] | null;
}

export async function readBuyingHabits(
  admin: SupabaseClient,
  orgId: string,
  f: BuyingHabitFilters = {},
): Promise<BuyingHabitsTable> {
  const fleet = f.vehicleIds?.length ? await fleetScope(admin, orgId, f.vehicleIds) : null;
  // A truck filter that matches no vehicle is nothing, not everything (the queue's rule).
  if (fleet && fleet.units.length === 0) return buyingHabitsTable([]);

  const rows = await fetchAllPaged<BuyingHabitFinding>((from, to) => {
    let q = admin
      .from("fuel_exceptions")
      .select("kind, occurred_on, unit_number, amount, evidence")
      .eq("org_id", orgId)
      .in("kind", [...BUYING_HABIT_KINDS])
      .in("status", [...BUYING_HABIT_STATUSES]);
    if (fleet) q = q.in("unit_number", fleet.units);
    if (f.from) q = q.gte("occurred_on", monthStartOf(f.from));
    if (f.to) q = q.lte("occurred_on", f.to);
    // A stable order is what makes `.range()` pages disjoint.
    return q.order("occurred_on", { ascending: true }).order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{
      data: BuyingHabitFinding[] | null;
      error: { message: string } | null;
    }>;
  });
  return buyingHabitsTable(rows);
}
