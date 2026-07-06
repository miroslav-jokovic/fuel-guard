import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseSamsaraVehicles,
  parseVehicleStatsOdometer,
  parseVehicleFuelPercents,
  parseCurrentAssignments,
  type SamsaraVehicle,
  type VehicleFuelLevel,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import {
  makeSamsaraVehicleLister,
  makeSamsaraOdometerFetcher,
  makeSamsaraAssignmentFetcher,
  type SamsaraVehicleLister,
  type SamsaraOdometerFetcher,
  type SamsaraAssignmentFetcher,
} from "../lib/samsara.js";

export interface VehicleSyncResult {
  total: number; // vehicles returned by Samsara
  created: number; // new rows inserted
  updated: number; // existing rows matched + refreshed
  assigned: number; // vehicles whose driver assignment was pulled from Samsara
  needsCompletion: string[]; // unit numbers of NEW vehicles missing tank capacity / baseline MPG
}

export class NoSamsaraTokenError extends Error {
  constructor() {
    super("No Samsara API token configured for this organization");
    this.name = "NoSamsaraTokenError";
  }
}

interface ExistingRow {
  id: string;
  samsara_vehicle_id: string | null;
  vin: string | null;
  unit_number: string;
}

/**
 * Pull the org's powered vehicles from Samsara and upsert them into `vehicles`. Matching precedence:
 * samsara_vehicle_id → VIN → unit number. On a match we refresh identity (make/model/year/plate/vin)
 * and stamp `samsara_vehicle_id`, but never clobber user-owned fields (unit_number, tank capacity,
 * baseline MPG, fuel type). New trucks are created with tank capacity 0 / no baseline and reported in
 * `needsCompletion` so the admin knows to finish them before those drive fuel/efficiency detection.
 */
export async function syncVehiclesFromSamsara(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  listerOverride?: SamsaraVehicleLister,
  odometerOverride?: SamsaraOdometerFetcher,
  assignmentOverride?: SamsaraAssignmentFetcher,
): Promise<VehicleSyncResult> {
  const token = listerOverride ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const lister = listerOverride ?? makeSamsaraVehicleLister(env, token);
  const raw = await lister();
  const vehicles = parseSamsaraVehicles({ data: raw as { id?: string }[] });

  // Current odometer + fuel level per vehicle (best-effort — identity sync still succeeds without stats).
  let odometerMiles = new Map<string, number>();
  let fuelByVehicle = new Map<string, VehicleFuelLevel>();
  try {
    const fetcher = odometerOverride ?? makeSamsaraOdometerFetcher(env, token);
    const stats = (await fetcher()) as Parameters<typeof parseVehicleStatsOdometer>[0];
    odometerMiles = parseVehicleStatsOdometer(stats);
    fuelByVehicle = parseVehicleFuelPercents(stats);
  } catch {
    /* leave stats unset; not fatal */
  }

  const { data: existingData } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id, vin, unit_number")
    .eq("org_id", orgId);
  const existing = (existingData ?? []) as ExistingRow[];

  const bySamsara = new Map(existing.filter((r) => r.samsara_vehicle_id).map((r) => [r.samsara_vehicle_id!, r]));
  const byVin = new Map(existing.filter((r) => r.vin).map((r) => [r.vin!.toUpperCase(), r]));
  const byUnit = new Map(existing.map((r) => [r.unit_number, r]));

  const result: VehicleSyncResult = { total: vehicles.length, created: 0, updated: 0, assigned: 0, needsCompletion: [] };

  for (const sv of vehicles) {
    const identity = { make: sv.make, model: sv.model, year: sv.year, plate: sv.licensePlate, vin: sv.vin };
    const odo = odometerMiles.get(sv.samsaraId);
    const fuel = fuelByVehicle.get(sv.samsaraId);
    // Attach odometer + fuel level only when Samsara actually reported them (never overwrite with null).
    const withStats = <T extends object>(o: T) => {
      let out: T & { current_odometer?: number; samsara_fuel_percent?: number; samsara_fuel_at?: string | null } = { ...o };
      if (odo != null) out = { ...out, current_odometer: odo };
      if (fuel) out = { ...out, samsara_fuel_percent: fuel.percent, samsara_fuel_at: fuel.time };
      return out;
    };
    const withOdo = withStats;
    const match =
      bySamsara.get(sv.samsaraId) ??
      (sv.vin ? byVin.get(sv.vin.toUpperCase()) : undefined) ??
      byUnit.get(sv.name);

    if (match) {
      await admin
        .from("vehicles")
        .update(withOdo({ ...identity, samsara_vehicle_id: sv.samsaraId }))
        .eq("id", match.id)
        .eq("org_id", orgId);
      result.updated++;
      continue;
    }

    const unit = pickUnitNumber(sv);
    const { error } = await admin.from("vehicles").insert(
      withOdo({
        org_id: orgId,
        unit_number: unit,
        ...identity,
        samsara_vehicle_id: sv.samsaraId,
        fuel_type: "diesel",
        tank_capacity_gal: 0,
        status: "active",
      }),
    );
    if (error) {
      // Most likely a unit_number collision with a row we couldn't pre-match → link it instead.
      if (error.code === "23505") {
        await admin
          .from("vehicles")
          .update(withOdo({ ...identity, samsara_vehicle_id: sv.samsaraId }))
          .eq("org_id", orgId)
          .eq("unit_number", unit);
        result.updated++;
        continue;
      }
      throw new Error(error.message);
    }
    result.created++;
    result.needsCompletion.push(unit);
  }

  // ── Driver assignments: pull each truck's current driver and set assigned_driver_id ──────────
  // Best-effort: needs drivers synced first (so they carry samsara_driver_id) + the "Read Assignments"
  // token scope. Any failure here leaves identity/odometer sync intact.
  try {
    const fetcher = assignmentOverride ?? makeSamsaraAssignmentFetcher(env, token);
    const links = parseCurrentAssignments(
      (await fetcher()) as Parameters<typeof parseCurrentAssignments>[0],
      new Date().toISOString(),
    );
    if (links.length) {
      const [{ data: vRows }, { data: dRows }] = await Promise.all([
        admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId).not("samsara_vehicle_id", "is", null),
        admin.from("drivers").select("id, samsara_driver_id").eq("org_id", orgId).not("samsara_driver_id", "is", null),
      ]);
      const vehById = new Map((vRows ?? []).map((r) => [r.samsara_vehicle_id as string, r.id as string]));
      const drvById = new Map((dRows ?? []).map((r) => [r.samsara_driver_id as string, r.id as string]));
      for (const link of links) {
        const vehId = vehById.get(link.vehicleSamsaraId);
        const drvId = drvById.get(link.driverSamsaraId);
        if (vehId && drvId) {
          await admin.from("vehicles").update({ assigned_driver_id: drvId }).eq("id", vehId).eq("org_id", orgId);
          result.assigned++;
        }
      }
    }
  } catch {
    /* assignments are best-effort */
  }

  return result;
}

function pickUnitNumber(sv: SamsaraVehicle): string {
  return sv.name?.trim() || sv.vin || `SAMSARA-${sv.samsaraId}`;
}

export interface VehicleStatsSyncResult {
  updated: number; // vehicles whose current odometer / fuel level was refreshed
}

/**
 * LIVE STATS ONLY — refresh current odometer + fuel level for already-mapped vehicles. This is the
 * cheap tier (one paginated `/fleet/vehicles/stats` call), safe to run every few minutes. It never
 * touches identity, creates rows, or resolves assignments — those are the slow-changing identity tier.
 */
export async function syncVehicleStatsFromSamsara(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  odometerOverride?: SamsaraOdometerFetcher,
): Promise<VehicleStatsSyncResult> {
  const token = odometerOverride ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const fetcher = odometerOverride ?? makeSamsaraOdometerFetcher(env, token);
  const stats = (await fetcher()) as Parameters<typeof parseVehicleStatsOdometer>[0];
  const odometerMiles = parseVehicleStatsOdometer(stats);
  const fuelByVehicle = parseVehicleFuelPercents(stats);
  if (odometerMiles.size === 0 && fuelByVehicle.size === 0) return { updated: 0 };

  const { data: rows } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id")
    .eq("org_id", orgId)
    .not("samsara_vehicle_id", "is", null);

  let updated = 0;
  for (const r of (rows ?? []) as { id: string; samsara_vehicle_id: string }[]) {
    const odo = odometerMiles.get(r.samsara_vehicle_id);
    const fuel = fuelByVehicle.get(r.samsara_vehicle_id);
    if (odo == null && !fuel) continue; // Samsara reported nothing for this truck → leave it be
    const patch: { current_odometer?: number; samsara_fuel_percent?: number; samsara_fuel_at?: string | null } = {};
    if (odo != null) patch.current_odometer = odo;
    if (fuel) { patch.samsara_fuel_percent = fuel.percent; patch.samsara_fuel_at = fuel.time; }
    await admin.from("vehicles").update(patch).eq("id", r.id).eq("org_id", orgId);
    updated++;
  }
  return { updated };
}
