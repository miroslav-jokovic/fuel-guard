/**
 * The roster's read for "which unit or driver does this Samsara id mean, and who holds it now" — the
 * warning desk's line (WARNING-DESK-PLAN WD4, D-WD15).
 *
 * The desk stores Samsara ids, never roster foreign keys (0653 §1: a `drivers(id)` FK would oblige every
 * driver merge to move the row, and a unit Samsara lists that the roster does not — "783 - OLD" — would
 * have nowhere to go). So the roster is asked when a line is DRAWN, which is also when "who holds this
 * trailer now" is the right question: that is the person to call.
 *
 * Narrow by construction, like `readFleetIdentities`: unit numbers, the driver's display name and
 * phone, and the two links the desk follows — truck → assigned driver, trailer → its truck. Every read is
 * org-scoped: the API reads with the service role, which bypasses RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunks } from "@silvicom/shared";

export interface SubjectTruck {
  id: string;
  unitNumber: string;
  driverId: string | null;
}
export interface SubjectTrailer {
  id: string;
  unitNumber: string;
  /** The truck Samsara (or a dispatcher) paired it with now — `trailers.assigned_vehicle_id`. */
  vehicleId: string | null;
}
export interface SubjectDriver {
  id: string;
  name: string;
  phone: string | null;
}

export interface SamsaraSubjects {
  trucksBySamsaraId: Map<string, SubjectTruck>;
  trailersBySamsaraId: Map<string, SubjectTrailer>;
  driversBySamsaraId: Map<string, SubjectDriver>;
  /** Every truck and driver reached by a link above, by roster id. */
  trucksById: Map<string, SubjectTruck>;
  driversById: Map<string, SubjectDriver>;
}

const LIMIT = 1000;

function displayName(d: { first_name: string | null; last_name: string | null }): string {
  return [d.first_name, d.last_name].filter((p) => typeof p === "string" && p.trim()).join(" ").trim() || "Unnamed driver";
}

type VehicleRow = { id: string; samsara_vehicle_id: string | null; unit_number: string | null; assigned_driver_id: string | null };
type TrailerRow = { id: string; samsara_asset_id: string | null; unit_number: string; assigned_vehicle_id: string | null };
type DriverRow = { id: string; samsara_driver_id: string | null; first_name: string | null; last_name: string | null; phone: string | null };

const truckOf = (v: VehicleRow): SubjectTruck => ({ id: v.id, unitNumber: v.unit_number?.trim() || "—", driverId: v.assigned_driver_id });
const driverOf = (d: DriverRow): SubjectDriver => ({ id: d.id, name: displayName(d), phone: d.phone?.trim() || null });

export async function readSamsaraSubjects(
  admin: SupabaseClient,
  orgId: string,
  ids: { vehicleSamsaraIds: readonly string[]; trailerSamsaraIds: readonly string[]; driverSamsaraIds: readonly string[] },
): Promise<SamsaraSubjects> {
  const out: SamsaraSubjects = {
    trucksBySamsaraId: new Map(),
    trailersBySamsaraId: new Map(),
    driversBySamsaraId: new Map(),
    trucksById: new Map(),
    driversById: new Map(),
  };

  for (const part of chunks([...new Set(ids.trailerSamsaraIds)])) {
    const { data, error } = await admin
      .from("trailers")
      .select("id, samsara_asset_id, unit_number, assigned_vehicle_id")
      .eq("org_id", orgId)
      .in("samsara_asset_id", part)
      .limit(LIMIT);
    if (error) throw new Error(`trailers: ${error.message}`);
    for (const t of (data ?? []) as TrailerRow[]) {
      if (t.samsara_asset_id) out.trailersBySamsaraId.set(t.samsara_asset_id, { id: t.id, unitNumber: t.unit_number, vehicleId: t.assigned_vehicle_id });
    }
  }

  const pairedTruckIds = [...out.trailersBySamsaraId.values()].map((t) => t.vehicleId).filter((v): v is string => !!v);
  const addTrucks = (rows: VehicleRow[]) => {
    for (const v of rows) {
      const t = truckOf(v);
      out.trucksById.set(v.id, t);
      if (v.samsara_vehicle_id) out.trucksBySamsaraId.set(v.samsara_vehicle_id, t);
    }
  };
  const vehicleColumns = "id, samsara_vehicle_id, unit_number, assigned_driver_id";
  for (const part of chunks([...new Set(ids.vehicleSamsaraIds)])) {
    const { data, error } = await admin.from("vehicles").select(vehicleColumns).eq("org_id", orgId).in("samsara_vehicle_id", part).limit(LIMIT);
    if (error) throw new Error(`vehicles: ${error.message}`);
    addTrucks((data ?? []) as VehicleRow[]);
  }
  for (const part of chunks([...new Set(pairedTruckIds)].filter((id) => !out.trucksById.has(id)))) {
    const { data, error } = await admin.from("vehicles").select(vehicleColumns).eq("org_id", orgId).in("id", part).limit(LIMIT);
    if (error) throw new Error(`vehicles: ${error.message}`);
    addTrucks((data ?? []) as VehicleRow[]);
  }

  const driverColumns = "id, samsara_driver_id, first_name, last_name, phone";
  const addDrivers = (rows: DriverRow[]) => {
    for (const d of rows) {
      const driver = driverOf(d);
      out.driversById.set(d.id, driver);
      if (d.samsara_driver_id) out.driversBySamsaraId.set(d.samsara_driver_id, driver);
    }
  };
  for (const part of chunks([...new Set(ids.driverSamsaraIds)])) {
    const { data, error } = await admin.from("drivers").select(driverColumns).eq("org_id", orgId).in("samsara_driver_id", part).limit(LIMIT);
    if (error) throw new Error(`drivers: ${error.message}`);
    addDrivers((data ?? []) as DriverRow[]);
  }
  const heldBy = [...out.trucksById.values()].map((t) => t.driverId).filter((d): d is string => !!d && !out.driversById.has(d));
  for (const part of chunks([...new Set(heldBy)])) {
    const { data, error } = await admin.from("drivers").select(driverColumns).eq("org_id", orgId).in("id", part).limit(LIMIT);
    if (error) throw new Error(`drivers: ${error.message}`);
    addDrivers((data ?? []) as DriverRow[]);
  }
  return out;
}
