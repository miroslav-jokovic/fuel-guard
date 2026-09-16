/**
 * The roster's read interface for "which truck is this, and who is on it" (LIVE-MAP-PLAN.md LM6).
 *
 * `vehicles` and `drivers` are `layer=core`, `module=roster`. Unlike a raw table they are not sealed
 * by `check-table-access.mjs`, so the live map COULD select from them directly — and that is exactly
 * why this exists instead. D-ARC3 gives every table one owning module, and a reader that reaches past
 * an owner because no gate happens to stop it is the shape this repo's register calls a workaround:
 * locally cheap, visible only in aggregate, and the reason `drivers` was once touched from 54 files.
 *
 * Narrow by construction. It answers the map's question — unit number and the assigned driver's
 * display name — and nothing else. Anything wider belongs to the roster's own surfaces.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FleetIdentity {
  vehicleId: string;
  unitNumber: string;
  status: string | null;
  driver: { id: string; name: string } | null;
}

const PAGE_CAP = 1000;

type VehicleRow = {
  id: string;
  unit_number: string | null;
  status: string | null;
  assigned_driver_id: string | null;
};
type DriverRow = { id: string; first_name: string | null; last_name: string | null };

/**
 * A driver's display name from the parts the roster stores.
 *
 * Falls back to whichever half exists rather than rendering "null null" or an empty string — a truck
 * whose driver has one recorded name is a data problem for the roster page to fix, not a reason for
 * the map to show a blank where a person should be.
 */
function displayName(d: DriverRow): string {
  const name = [d.first_name, d.last_name].filter((p) => typeof p === "string" && p.trim()).join(" ");
  return name.trim() || "Unnamed driver";
}

/**
 * Identity for every vehicle in an org, keyed by vehicle id.
 *
 * Org-scoped on BOTH reads: `admin` is the service role and bypasses RLS, so these filters are the
 * only tenant boundary. The drivers read is filtered by org as well as by id — an id list alone would
 * be scoped by accident, and only for as long as the ids happened to be right.
 */
export async function readFleetIdentities(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ byVehicleId: Map<string, FleetIdentity>; truncated: boolean }> {
  const { data: vData, error: vErr } = await admin
    .from("vehicles")
    .select("id, unit_number, status, assigned_driver_id")
    .eq("org_id", orgId)
    .limit(PAGE_CAP);
  if (vErr) throw new Error(vErr.message);
  const vehicles = (vData ?? []) as unknown as VehicleRow[];

  const driverIds = [...new Set(vehicles.map((v) => v.assigned_driver_id).filter((id): id is string => !!id))];
  const drivers = new Map<string, DriverRow>();
  if (driverIds.length > 0) {
    const { data: dData, error: dErr } = await admin
      .from("drivers")
      .select("id, first_name, last_name")
      .eq("org_id", orgId)
      .in("id", driverIds)
      .limit(PAGE_CAP);
    if (dErr) throw new Error(dErr.message);
    for (const d of (dData ?? []) as unknown as DriverRow[]) drivers.set(d.id, d);
  }

  const byVehicleId = new Map<string, FleetIdentity>();
  for (const v of vehicles) {
    const d = v.assigned_driver_id ? drivers.get(v.assigned_driver_id) : undefined;
    byVehicleId.set(v.id, {
      vehicleId: v.id,
      // A vehicle with no unit number is a roster defect, not a truck to hide: the map shows it with
      // a placeholder so somebody can see there is a truck and go fix the row.
      unitNumber: v.unit_number?.trim() || "—",
      status: v.status,
      driver: d ? { id: d.id, name: displayName(d) } : null,
    });
  }
  return { byVehicleId, truncated: vehicles.length >= PAGE_CAP };
}
