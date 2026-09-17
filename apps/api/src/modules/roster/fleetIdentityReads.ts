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
  /**
   * The tank and when the vendor read it, or null when this truck has never reported one
   * (`Q-LM20`, the live map's item 8).
   *
   * It is on the ROSTER's interface because `vehicles` is the roster's table — the same reason
   * `unitNumber` and `status` come through here rather than the live map selecting two more columns
   * off a table it does not own (D-ARC3, and the file header above).
   */
  fuel: { percent: number; at: string } | null;
}

const PAGE_CAP = 1000;

type VehicleRow = {
  id: string;
  unit_number: string | null;
  status: string | null;
  assigned_driver_id: string | null;
  /** `numeric(5,1)` (migration 0138), so PostgREST sends it as a STRING — see `toFuel`. */
  samsara_fuel_percent: number | string | null;
  samsara_fuel_at: string | null;
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
 * The fuel pair, or null — the ONE place the vendor's two columns become one fact.
 *
 * ⚠ THE `Number(...)` IS LOAD-BEARING AND NOT DEFENSIVE. `samsara_fuel_percent` is
 * `numeric(5,1)` (migration 0138) and PostgREST serialises `numeric` as a JSON **string** to keep
 * arbitrary precision — production answers `"100.0"` and `"3.0"`, verified against the live database
 * on 2026-09-17. Passed through untouched it would reach a browser as `"68.0"`, where it would
 * render as "68.0%" and compare as a string. `samsaraStatsFeed.ts` already carries its own `num()`
 * for the same column and the same reason.
 *
 * ⚠ BOTH HALVES OR NEITHER. A percent with no reading time cannot be aged, and an unaged percent is
 * precisely what `Q-LM20` refuses to put on the board; a time with no percent describes nothing. On
 * production neither mismatch exists — 207 rows carry both and 65 carry neither, 2026-09-17 — so
 * this is the case the data does not have yet rather than one it has, and it is written down rather
 * than left to `undefined` leaking through the contract.
 */
function toFuel(v: VehicleRow): FleetIdentity["fuel"] {
  if (v.samsara_fuel_percent == null || !v.samsara_fuel_at) return null;
  const percent = Number(v.samsara_fuel_percent);
  if (!Number.isFinite(percent)) return null;
  return { percent, at: v.samsara_fuel_at };
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
    .select("id, unit_number, status, assigned_driver_id, samsara_fuel_percent, samsara_fuel_at")
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
      fuel: toFuel(v),
    });
  }
  return { byVehicleId, truncated: vehicles.length >= PAGE_CAP };
}
