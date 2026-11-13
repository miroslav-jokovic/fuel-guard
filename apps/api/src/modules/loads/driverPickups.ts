import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged, fetchAllPagedIn } from "@silvicom/shared";

/**
 * Pickups that actually happened since an instant, with who was on the load — the loads module's
 * answer to "has this driver gone back to work?" (HOME-TIME-PLAN D-HT6).
 *
 * ── WHY A PICKUP, AND NOT ANY STOP ──────────────────────────────────────────────────────────────
 * Home time is often marked while the driver is still finishing his last load, so a DELIVERY after the
 * mark is that load ending, not new work. A pickup after it is a new load: McLeod's actual arrival on a
 * pickup stop, which the mirror keeps as `load_stops.actual_arrival_at`.
 *
 * ── STOPS FIRST, THEN THEIR LOADS ───────────────────────────────────────────────────────────────
 * The stops are bounded by the instant (weeks at most — home time is marked at most 30 days back) and
 * read with `fetchAllPaged`, so PostgREST's 1,000-row cap cannot cut the answer short; the loads are
 * then read 50 ids at a time (`fetchAllPagedIn`), the Node 22 header limit's bound. Both filter on
 * `org_id`: the service role bypasses RLS.
 */
export interface DriverPickup {
  /** Either seat of the load; a load with no driver resolved yet has neither and is no evidence. */
  driverId: string | null;
  coDriverId: string | null;
  loadId: string;
  loadRef: string | null;
  /** When the truck arrived at the pickup, as McLeod recorded it. */
  at: string;
}

export async function readDriverPickupsSince(admin: SupabaseClient, orgId: string, since: Date): Promise<DriverPickup[]> {
  const stops = await fetchAllPaged<{ load_id: string; actual_arrival_at: string }>((from, to) =>
    admin
      .from("load_stops")
      .select("load_id, actual_arrival_at")
      .eq("org_id", orgId)
      .eq("kind", "pickup")
      .gte("actual_arrival_at", since.toISOString())
      .order("actual_arrival_at", { ascending: true })
      .range(from, to),
  );
  if (stops.length === 0) return [];

  const loadIds = [...new Set(stops.map((s) => s.load_id))];
  const loads = await fetchAllPagedIn<{ id: string; ref: string | null; driver_id: string | null; co_driver_id: string | null }>(loadIds, (ids) => (from, to) =>
    admin.from("loads").select("id, ref, driver_id, co_driver_id").eq("org_id", orgId).in("id", [...ids]).range(from, to),
  );
  const byId = new Map(loads.map((l) => [l.id, l]));
  return stops.flatMap((s) => {
    const l = byId.get(s.load_id);
    return l ? [{ driverId: l.driver_id, coDriverId: l.co_driver_id, loadId: l.id, loadRef: l.ref, at: s.actual_arrival_at }] : [];
  });
}
