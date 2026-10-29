import type { SupabaseClient } from "@supabase/supabase-js";
import { IN_LIST_CHUNK, chunks, fetchAllPaged } from "../../../lib/paging.js";
import { traced } from "../inspections/serviceError.js";
import type { ServiceError } from "./types.js";

/**
 * Driver-held equipment, as the kit check reads it (DE2; D-DE1, D-DE4). Out of `units.ts` only for that
 * file's size budget: these two readers are the kit check's, and nothing else calls them.
 */

/**
 * What each truck's driver holds (D-DE4, owner 2026-10-27): a tablet follows its driver (D-DE1), so a
 * tractor's kit counts the driver-held things of the driver `vehicles.assigned_driver_id` names — the
 * same inference D-INV3 uses to SHOW the driver. Truck 654's "Tablet 1 of 1" stays true when the
 * tablet is Dana's, and goes short when 654 has no driver or Dana has no tablet.
 *
 * Two reads for the fleet, never one per truck: every driver-held asset (paged past the 1,000-row cap),
 * then the trucks those drivers are assigned to (chunked, `IN_LIST_CHUNK`). Keyed by truck.
 */
export async function loadDriverHeldByTruck(
  admin: SupabaseClient,
  orgId: string,
): Promise<Map<string, { driverId: string; typeIds: string[] }> | ServiceError> {
  try {
    const held = await fetchAllPaged<{ asset_type_id: string; driver_id: string | null }>((from, to) =>
      admin
        .from("inventory_assets")
        .select("asset_type_id, driver_id")
        .eq("org_id", orgId)
        .not("driver_id", "is", null)
        .neq("status", "retired")
        .order("id", { ascending: true })
        .range(from, to),
    );
    const byDriver = new Map<string, string[]>();
    for (const a of held) {
      if (!a.driver_id) continue;
      byDriver.set(a.driver_id, [...(byDriver.get(a.driver_id) ?? []), a.asset_type_id]);
    }
    const out = new Map<string, { driverId: string; typeIds: string[] }>();
    for (const part of chunks([...byDriver.keys()], IN_LIST_CHUNK)) {
      const { data, error } = await admin
        .from("vehicles")
        .select("id, assigned_driver_id")
        .eq("org_id", orgId)
        .in("assigned_driver_id", part);
      if (error) return traced("loadDriverHeldByTruck", "db_error", "Could not read which trucks the drivers are on", error);
      for (const v of (data ?? []) as Array<{ id: string; assigned_driver_id: string | null }>) {
        if (v.assigned_driver_id) out.set(v.id, { driverId: v.assigned_driver_id, typeIds: byDriver.get(v.assigned_driver_id) ?? [] });
      }
    }
    return out;
  } catch (e) {
    return traced("loadDriverHeldByTruck", "db_error", "Could not read what the drivers hold", e);
  }
}

/** The driver a truck is assigned to right now — D-INV3's inference, read for one truck. */
export async function assignedDriverOf(admin: SupabaseClient, orgId: string, vehicleId: string): Promise<string | null | ServiceError> {
  const { data, error } = await admin
    .from("vehicles")
    .select("assigned_driver_id")
    .eq("org_id", orgId)
    .eq("id", vehicleId)
    .maybeSingle();
  if (error) return traced("assignedDriverOf", "db_error", "Could not read the truck's driver", error);
  return (data as { assigned_driver_id: string | null } | null)?.assigned_driver_id ?? null;
}

/**
 * When each of one driver's tablets reached them (DE2b) — the driver page's "since 10/29/2026".
 *
 * `listAssets` leaves `since` null on purpose (`getAsset` says why: one bounded query per asset, never one
 * per page). A driver's own list is the bounded case — a driver holds one tablet, two at most — so it is
 * answered for that list alone: the latest movement that put each asset in THIS driver's hands. One read,
 * chunked by asset id; the first row per asset in occurred_at-descending order is the answer.
 */
export async function sinceGivenTo(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  assetIds: string[],
): Promise<Map<string, string> | ServiceError> {
  const out = new Map<string, string>();
  for (const part of chunks(assetIds, IN_LIST_CHUNK)) {
    const { data, error } = await admin
      .from("asset_movements")
      .select("asset_id, occurred_at")
      .eq("org_id", orgId)
      .eq("to_driver_id", driverId)
      .in("asset_id", part)
      .order("occurred_at", { ascending: false });
    if (error) return traced("sinceGivenTo", "db_error", "Could not read when the driver took it", error);
    for (const m of (data ?? []) as { asset_id: string; occurred_at: string }[]) {
      if (!out.has(m.asset_id)) out.set(m.asset_id, m.occurred_at);
    }
  }
  return out;
}
