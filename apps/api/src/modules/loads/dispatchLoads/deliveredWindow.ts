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

/** Is this instant inside the half-open window [from, before)? */
export const inWindow = (at: string | null, fromIso: string, beforeIso: string): boolean =>
  at != null && Date.parse(at) >= Date.parse(fromIso) && Date.parse(at) < Date.parse(beforeIso);
