/**
 * The fuel module's answer to one question another module has a right to ask: **which trucks have
 * bought diesel lately?**
 *
 * It exists because of what happened on 2026-09-14. A `mcleod.roster_reconciled` sweep retired 33
 * vehicles, 11 of which were still fuelling — and unit 732, the one the carrier noticed, had taken a
 * fill that very day. The retirement guard that shipped with F6 asked the telematics feed whether the
 * truck had moved, and 732's gateway had been swapped out a fortnight earlier, so the feed had
 * nothing to say. Its FUEL CARD did: eleven fills since the swap, the most recent the same morning.
 *
 * A truck that is buying diesel has not been sold. That is the whole of the rule, and the reason this
 * read is here rather than a `.from("fuel_transactions")` in the roster sweep: `fuel_transactions` is
 * fuel's table (module=fuel in `scripts/table-modules.json`), and a collector reaching across to
 * decide something about another module's data is how a schema becomes everybody's problem
 * (D-ARC1/D-ARC3). The sweep asks a question; this module answers it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Vehicles with at least one fuel transaction since `sinceIso`, for one org.
 *
 * Returns ids rather than rows on purpose. The caller is deciding whether a truck is alive, not
 * reading its fuel history, and handing it transactions would invite it to start judging gallons —
 * which is this module's job and not the roster's.
 *
 * Org-scoped in the query and not by RLS: the API reads with the SERVICE ROLE, which bypasses RLS, so
 * this `.eq("org_id", …)` is the only tenant boundary the read has.
 *
 * ⚠ `select("vehicle_id")` with no aggregation returns one row per FILL, not per truck, and PostgREST
 * caps every response at 1,000 rows however large a `.limit()` — measured, and it cost nine filter
 * menus 30% of their values before anybody noticed. At ~200 trucks fuelling a few times a week a
 * 7-day window is nowhere near that, but the cap is silent when it bites, so the caller is told when
 * the read came back at it rather than being left to assume.
 */
export interface RecentFuelResult {
  vehicleIds: Set<string>;
  truncated: boolean;
}

const FUEL_PAGE_CAP = 1000;

export async function readRecentlyFuelledVehicleIds(
  admin: SupabaseClient,
  orgId: string,
  sinceIso: string,
): Promise<RecentFuelResult> {
  const { data, error } = await admin
    .from("fuel_transactions")
    .select("vehicle_id")
    .eq("org_id", orgId)
    .gte("fueled_at", sinceIso)
    .not("vehicle_id", "is", null)
    .limit(FUEL_PAGE_CAP);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as { vehicle_id: string | null }[];
  const vehicleIds = new Set<string>();
  for (const row of rows) if (row.vehicle_id) vehicleIds.add(row.vehicle_id);
  return { vehicleIds, truncated: rows.length >= FUEL_PAGE_CAP };
}
