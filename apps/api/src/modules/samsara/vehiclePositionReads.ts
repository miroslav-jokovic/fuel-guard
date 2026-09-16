/**
 * The owner's read interface for `vehicle_positions` (LIVE-MAP-PLAN.md LM6, D-ARC3).
 *
 * ── WHY THE LIVE MAP CANNOT JUST SELECT FROM THE TABLE ───────────────────────────────────────────
 * `vehicle_positions` is `layer=raw`, `module=samsara` in `scripts/table-modules.json`, and
 * `check-table-access.mjs` seals every raw table to the collector that owns it: a `.from()` on one
 * outside `apps/api/src/modules/samsara/` fails the build. That is the data-plane half of D-ARC1 —
 * the 2026-08-27 audit found 39 places a feature read a collector's staging tables directly, which
 * is how a collector's schema becomes everybody's problem. So the collector exposes a read, and the
 * map calls it.
 *
 * It returns the raw row shape on purpose. Turning a row into a marker is the map's judgement — which
 * state, which age, against which bounds — and a collector that decided those would be making a
 * product decision on the way past.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** One truck's current fix, as `vehicle_positions` stores it (0341). */
export interface VehiclePositionRow {
  vehicle_id: string;
  lat: number;
  lng: number;
  heading_degrees: number | null;
  speed_mph: number | null;
  is_ecu_speed: boolean | null;
  formatted_location: string | null;
  sampled_at: string;
  received_at: string | null;
}

export interface VehiclePositionsResult {
  rows: VehiclePositionRow[];
  /**
   * The read came back exactly at the cap, so there may be more.
   *
   * ⚠ PostgREST caps EVERY response at 1,000 rows however large a `.limit()` you pass — measured, and
   * it cost nine filter menus 30% of their values before anybody noticed, because a truncated list
   * looks exactly like a short one. This fleet is ~200 trucks so it is false today; it is reported
   * rather than assumed away because the failure it guards is silent by construction.
   */
  truncated: boolean;
}

/** PostgREST's own ceiling, stated here so the truncation check cannot drift from the request. */
const POSITION_PAGE_CAP = 1000;

/**
 * Every truck's current position for one org.
 *
 * Org-scoped in the query and not by RLS: the API reads with the SERVICE ROLE, which bypasses RLS
 * entirely, so this `.eq("org_id", …)` is the only tenant boundary the read has. `expectOrgScoped`
 * is what proves it did not get dropped in a refactor.
 */
export async function readVehiclePositions(
  admin: SupabaseClient,
  orgId: string,
): Promise<VehiclePositionsResult> {
  const { data, error } = await admin
    .from("vehicle_positions")
    .select(
      "vehicle_id, lat, lng, heading_degrees, speed_mph, is_ecu_speed, formatted_location, sampled_at, received_at",
    )
    .eq("org_id", orgId)
    .order("sampled_at", { ascending: false })
    .limit(POSITION_PAGE_CAP);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as VehiclePositionRow[];
  return { rows, truncated: rows.length >= POSITION_PAGE_CAP };
}
