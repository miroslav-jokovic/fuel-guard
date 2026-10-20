import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "../../../lib/paging.js";

/**
 * Which delivered loads fall inside a window of DELIVERY time (LOADS-ACTIVITY-PLAN D-LA1, D-LA6).
 *
 * Delivery time is a stop column, not a load column: the last delivery stop's McLeod departure, else
 * the driver app's completion (`loadDeliveredAt`). So the window is asked of `load_stops`, and these
 * ids are only CANDIDATES. Any delivery stop that left inside the window qualifies here, and the caller
 * keeps a load only when `loadDeliveredAt` over all its stops is inside. A two-drop load whose first
 * drop is in the window and whose last is after it is a candidate and then dropped. That is exact and
 * needs no margin.
 *
 * `loads.external_closed_at` is not used even as a pre-filter. On 2026-10-19 McLeod's close ran from
 * 44 hours BEFORE the recorded departure (a departure keyed ahead) to three weeks after, so any margin
 * would be a guess.
 */
export async function deliveredCandidateIds(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  beforeIso: string,
): Promise<string[]> {
  const ids = new Set<string>();
  for (const column of ["actual_departure_at", "completed_at"] as const) {
    const rows = await fetchAllPaged<{ load_id: string }>((from, to) =>
      admin
        .from("load_stops")
        .select("load_id")
        .eq("org_id", orgId)
        .eq("kind", "dropoff")
        .gte(column, fromIso)
        .lt(column, beforeIso)
        .order("id")
        .range(from, to)
        .then(({ data, error }) => ({ data: data as { load_id: string }[] | null, error })),
    );
    for (const r of rows) ids.add(r.load_id);
  }
  return [...ids];
}

/**
 * The first moment the mirror holds a load from — the floor the Loads page names beside its Delivered
 * window (DISPATCH-LOADS-COUNTS-PLAN D-DLC6): "Delivery history begins 09/17/2026". A load delivered
 * before the mirror began is not in core until the backfill (DLC4) brings it, so a 30-day window must
 * not read as the whole history.
 *
 * The moment is the earliest DELIVERY held, not the earliest row (D-DLC10, 2026-10-20): the backfill
 * stores an April delivery with today's `created_at`, so a floor on `created_at` would go on saying
 * 09/17/2026 over six months of older history. Delivery time is the delivery stop's McLeod departure,
 * the same column the window keys on above. An org whose stops carry no departure yet (nothing
 * delivered) falls back to its earliest row, so the floor is never later than the first load; null
 * for an org with no loads at all.
 */
export async function loadsHistoryFrom(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const [stop, load] = await Promise.all([
    admin
      .from("load_stops")
      .select("actual_departure_at")
      .eq("org_id", orgId)
      .eq("kind", "dropoff")
      .not("actual_departure_at", "is", null)
      .order("actual_departure_at", { ascending: true })
      .limit(1),
    admin.from("loads").select("created_at").eq("org_id", orgId).order("created_at", { ascending: true }).limit(1),
  ]);
  if (stop.error) throw new Error(stop.error.message);
  if (load.error) throw new Error(load.error.message);
  const delivered = ((stop.data ?? []) as { actual_departure_at: string | null }[])[0]?.actual_departure_at ?? null;
  const created = ((load.data ?? []) as { created_at: string | null }[])[0]?.created_at ?? null;
  if (delivered == null || created == null) return delivered ?? created;
  return Date.parse(delivered) < Date.parse(created) ? delivered : created;
}

/** Is this instant inside the half-open window [from, before)? */
export const inWindow = (at: string | null, fromIso: string, beforeIso: string): boolean =>
  at != null && Date.parse(at) >= Date.parse(fromIso) && Date.parse(at) < Date.parse(beforeIso);
