import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseSamsaraVehicles,
  parseVehicleStatsOdometer,
  parseVehicleFuelPercents,
  parseCurrentAssignments,
  parseAssignmentIntervals,
  type SamsaraVehicle,
  type VehicleFuelLevel,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { loadSamsaraToken } from "../../lib/samsaraToken.js";
import { isTmsRosterMaster } from "../mcleod/index.js";
import {
  makeSamsaraVehicleLister,
  makeSamsaraOdometerFetcher,
  makeSamsaraAssignmentFetcher,
  type SamsaraVehicleLister,
  type SamsaraOdometerFetcher,
  type SamsaraAssignmentFetcher,
} from "../../lib/samsara.js";

export interface VehicleSyncResult {
  total: number; // vehicles returned by Samsara
  created: number; // new rows inserted
  updated: number; // existing rows matched + refreshed
  assigned: number; // vehicles whose driver assignment was pulled from Samsara
  needsCompletion: string[]; // unit numbers of NEW vehicles missing tank capacity / baseline MPG
  /** Unit numbers of ACTIVE trucks whose mapped Samsara vehicle no longer exists (likely replaced). */
  samsaraMissing: string[];
  /**
   * Link-only mode: Samsara vehicles that matched no Silvicom 360 row. Present ONLY when the carrier's
   * TMS masters the roster, where an unmatched truck is a finding rather than a row to invent — a
   * vehicle reporting telematics that the carrier's own fleet list does not contain.
   */
  unlinked?: string[];
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
  status: string | null;
  samsara_missing_since: string | null;
}

/**
 * Pull the org's powered vehicles from Samsara and upsert them into `vehicles`. Matching precedence:
 * samsara_vehicle_id → VIN → unit number. On a match we refresh identity (make/model/year/plate/vin)
 * and stamp `samsara_vehicle_id`, but never clobber user-owned fields (unit_number, tank capacity,
 * baseline MPG, fuel type). New trucks are created with tank capacity 0 / no baseline and reported in
 * `needsCompletion` so the admin knows to finish them before those drive fuel/efficiency detection.
 */
async function fetchSamsaraVehicles(
  env: Env,
  token: string,
  listerOverride?: SamsaraVehicleLister,
  odometerOverride?: SamsaraOdometerFetcher,
): Promise<{ vehicles: SamsaraVehicle[]; odometerMiles: Map<string, number>; fuelByVehicle: Map<string, VehicleFuelLevel> }> {
  const lister = listerOverride ?? makeSamsaraVehicleLister(env, token);
  const raw = await lister();
  const vehicles = parseSamsaraVehicles({ data: raw as { id?: string }[] });

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
  return { vehicles, odometerMiles, fuelByVehicle };
}

function buildVehicleMaps(existing: ExistingRow[]) {
  return {
    bySamsara: new Map(existing.filter((r) => r.samsara_vehicle_id).map((r) => [r.samsara_vehicle_id!, r])),
    byVin: new Map(existing.filter((r) => r.vin).map((r) => [r.vin!.toUpperCase(), r])),
    byUnit: new Map(existing.map((r) => [r.unit_number, r])),
  };
}

async function applyReplacementLifecycle(
  admin: SupabaseClient,
  orgId: string,
  existing: ExistingRow[],
  liveIds: Set<string>,
): Promise<string[]> {
  const nowIso = new Date().toISOString();
  const missing = existing.filter(
    (r) => r.status !== "retired" && r.samsara_vehicle_id != null && !liveIds.has(r.samsara_vehicle_id),
  );
  const toStamp = missing.filter((r) => r.samsara_missing_since == null).map((r) => r.id);
  if (toStamp.length) {
    const { error } = await admin
      .from("vehicles")
      .update({ samsara_missing_since: nowIso })
      .in("id", toStamp)
      .eq("org_id", orgId);
    if (error) throw new Error(`vehicle samsara-missing stamp failed: ${error.message}`);
  }
  const toClear = existing
    .filter(
      (r) =>
        r.samsara_missing_since != null &&
        r.samsara_vehicle_id != null &&
        liveIds.has(r.samsara_vehicle_id),
    )
    .map((r) => r.id);
  if (toClear.length) {
    const { error } = await admin
      .from("vehicles")
      .update({ samsara_missing_since: null })
      .in("id", toClear)
      .eq("org_id", orgId);
    if (error) throw new Error(`vehicle samsara-missing clear failed: ${error.message}`);
  }
  return missing.map((r) => r.unit_number).sort();
}

async function upsertSamsaraVehicle(
  admin: SupabaseClient,
  orgId: string,
  sv: SamsaraVehicle,
  odometerMiles: Map<string, number>,
  fuelByVehicle: Map<string, VehicleFuelLevel>,
  maps: ReturnType<typeof buildVehicleMaps>,
  linkOnly: boolean,
): Promise<{ kind: "created" | "updated" | "unlinked"; unit?: string }> {
  const identity = {
    make: sv.make,
    model: sv.model,
    year: sv.year,
    plate: sv.licensePlate,
    vin: sv.vin,
  };
  const odo = odometerMiles.get(sv.samsaraId);
  const fuel = fuelByVehicle.get(sv.samsaraId);
  const withStats = <T extends object>(o: T) => {
    let out: T & {
      current_odometer?: number;
      samsara_fuel_percent?: number;
      samsara_fuel_at?: string | null;
    } = { ...o };
    if (odo != null) out = { ...out, current_odometer: odo };
    if (fuel) out = { ...out, samsara_fuel_percent: fuel.percent, samsara_fuel_at: fuel.time };
    return out;
  };
  const match =
    maps.bySamsara.get(sv.samsaraId) ??
    (sv.vin ? maps.byVin.get(sv.vin.toUpperCase()) : undefined) ??
    maps.byUnit.get(sv.name);
  if (match) {
    // ── LINK-ONLY: the link and the MEASUREMENTS, never the identity (D-MR5) ─────────────────────
    //
    // `identity` above is built unconditionally from the Samsara response, and `clean()` returns null
    // for a field the response omits — so spreading it writes an explicit NULL over whatever is
    // stored. That is harmless while Samsara is the only writer of these columns and destructive the
    // moment a second one exists. Measured against production on 2026-08-24, Samsara supplies a plate
    // for 21 of 194 vehicles and a plate STATE for none of them (its API has no such field), while
    // McLeod carries a plate for 175 of 190 active tractors. Leaving this line as it was would have
    // McLeod write 175 plates and Samsara null them on the next tick, silently.
    //
    // The stats stay in both modes because they are not identity: odometer and fuel level are
    // MEASURED by the gateway, McLeod does not carry them for a tractor, and the plan (§4.2) already
    // rules them out as an import. Nothing McLeod owns is in this patch.
    const patch = linkOnly
      ? withStats({ samsara_vehicle_id: sv.samsaraId })
      : withStats({ ...identity, samsara_vehicle_id: sv.samsaraId });
    await admin.from("vehicles").update(patch).eq("id", match.id).eq("org_id", orgId);
    return { kind: "updated" };
  }

  const unit = pickUnitNumber(sv);
  // A truck Samsara reports and the carrier's fleet list does not is REPORTED, never created. The
  // insert below would have to invent `tank_capacity_gal` (it writes 0, which `learnVehicle` then has
  // to unlearn) and `fuel_type` (it writes 'diesel'), and under TMS mastery the fleet list is the
  // authority on what exists. Same posture as the driver sync: an unmatched telematics record means
  // something is running that the carrier's system of record does not know about, and that is a line
  // in a report for a human, not a row.
  if (linkOnly) return { kind: "unlinked", unit };

  const { error } = await admin.from("vehicles").insert(
    withStats({
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
    if (error.code === "23505") {
      await admin
        .from("vehicles")
        .update(withStats({ ...identity, samsara_vehicle_id: sv.samsaraId }))
        .eq("org_id", orgId)
        .eq("unit_number", unit);
      return { kind: "updated" };
    }
    throw new Error(error.message);
  }
  return { kind: "created", unit };
}

async function syncDriverAssignments(
  admin: SupabaseClient,
  env: Env,
  token: string,
  orgId: string,
  assignmentOverride?: SamsaraAssignmentFetcher,
): Promise<number> {
  try {
    const fetcher = assignmentOverride ?? makeSamsaraAssignmentFetcher(env, token);
    const rawAssign = (await fetcher()) as Parameters<typeof parseCurrentAssignments>[0];
    const links = parseCurrentAssignments(rawAssign, new Date().toISOString());
    const intervals = parseAssignmentIntervals(rawAssign);
    if (intervals.length) {
      const now = new Date().toISOString();
      const arows = intervals.map((iv) => ({
        org_id: orgId,
        vehicle_samsara_id: iv.vehicleSamsaraId,
        driver_samsara_id: iv.driverSamsaraId,
        start_at: new Date(iv.startMs).toISOString(),
        end_at: iv.endMs != null ? new Date(iv.endMs).toISOString() : null,
        updated_at: now,
      }));
      for (let i = 0; i < arows.length; i += 500) {
        await admin.from("driver_vehicle_assignments").upsert(arows.slice(i, i + 500), {
          onConflict: "org_id,vehicle_samsara_id,driver_samsara_id,start_at",
        });
      }
    }
    if (!links.length) return 0;
    const [{ data: vRows }, { data: dRows }] = await Promise.all([
      admin
        .from("vehicles")
        .select("id, samsara_vehicle_id")
        .eq("org_id", orgId)
        .not("samsara_vehicle_id", "is", null),
      admin
        .from("drivers")
        .select("id, samsara_driver_id")
        .eq("org_id", orgId)
        .not("samsara_driver_id", "is", null),
    ]);
    const vehById = new Map((vRows ?? []).map((r) => [r.samsara_vehicle_id as string, r.id as string]));
    const drvById = new Map((dRows ?? []).map((r) => [r.samsara_driver_id as string, r.id as string]));
    let assigned = 0;
    for (const link of links) {
      const vehId = vehById.get(link.vehicleSamsaraId);
      const drvId = drvById.get(link.driverSamsaraId);
      if (vehId && drvId) {
        await admin.from("vehicles").update({ assigned_driver_id: drvId }).eq("id", vehId).eq("org_id", orgId);
        assigned++;
      }
    }
    return assigned;
  } catch {
    /* assignments are best-effort */
    return 0;
  }
}

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

  const { vehicles, odometerMiles, fuelByVehicle } = await fetchSamsaraVehicles(
    env,
    token,
    listerOverride,
    odometerOverride,
  );

  const { data: existingData } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id, vin, unit_number, status, samsara_missing_since")
    .eq("org_id", orgId);
  const existing = (existingData ?? []) as ExistingRow[];

  const maps = buildVehicleMaps(existing);

  // Does the carrier's TMS master the roster? Two conditions, both explicit (see rosterMastery), and
  // it fails CLOSED — any error leaves this sync in the full behaviour it has had for a year.
  //
  // WHY THE ASSET RULE IS STRICTER THAN THE DRIVER RULE. `syncDriversFromSamsara` keeps writing PHONE
  // in link-only mode, because McLeod holds no phone number for any of its 1,463 driver rows and
  // Silvicom 360's 164 all came from Samsara — dropping it would break SMS consent and driver-app
  // invitations. There is no asset analogue, and that is a measurement rather than a symmetry
  // argument. Production and the carrier's sandbox on 2026-08-24:
  //
  //   vehicles.vin          McLeod 197/198 distinct among active tractors · Samsara 186/194
  //   vehicles.make/model/year   McLeod every active tractor · Samsara 188/194
  //   vehicles.plate        McLeod 175/190 · Samsara  21/194
  //   vehicles.plate_state  McLeod 175/190 · Samsara   0/194 — the API has no such field
  //
  // For every identity column on this table McLeod is an equal or better source, so link-only mode
  // writes NO identity at all rather than carving out an exception nothing in the data supports.
  const linkOnly = await isTmsRosterMaster(admin, orgId);

  const result: VehicleSyncResult = {
    total: vehicles.length,
    created: 0,
    updated: 0,
    assigned: 0,
    needsCompletion: [],
    // The replacement lifecycle runs in BOTH modes. It stamps `samsara_missing_since` and reports the
    // unit — it never changes `status`, so it takes no capability away and is not the deactivation
    // pass D-MR5 switches off. Under TMS mastery it is worth MORE, not less: it is the only signal
    // that a truck McLeod says is in service has stopped reporting telematics.
    samsaraMissing: await applyReplacementLifecycle(
      admin,
      orgId,
      existing,
      new Set(vehicles.map((sv) => sv.samsaraId)),
    ),
    unlinked: linkOnly ? [] : undefined,
  };

  for (const sv of vehicles) {
    const synced = await upsertSamsaraVehicle(admin, orgId, sv, odometerMiles, fuelByVehicle, maps, linkOnly);
    if (synced.kind === "created") {
      result.created++;
      result.needsCompletion.push(synced.unit!);
    } else if (synced.kind === "unlinked") {
      result.unlinked!.push(synced.unit!);
    } else {
      result.updated++;
    }
  }

  // An unmatched truck under TMS mastery means a vehicle is reporting telematics that the carrier's
  // own fleet list does not contain. That is a finding, and until M7 gives it a surface an admin
  // actually looks at, the log is where this integration already reports — the same place the driver
  // sync's bad-fetch guard and the trailer sync's pairing pass report from.
  if (result.unlinked?.length) {
    console.warn(`[vehicle-sync] ${result.unlinked.length} Samsara vehicle(s) are not on the TMS fleet list: ${result.unlinked.join(", ")}`);
  }

  // ── Driver assignments: pull each truck's current driver and set assigned_driver_id ──────────
  // Best-effort: needs drivers synced first (so they carry samsara_driver_id) + the "Read Assignments"
  // token scope. Any failure here leaves identity/odometer sync intact.
  result.assigned = await syncDriverAssignments(admin, env, token, orgId, assignmentOverride);

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

  // DIFF-BEFORE-WRITE (perf finding, 2026-08): this ran every few minutes and blindly stamped EVERY
  // mapped truck — 862k+ vehicle updates in pg_stat_statements, most writing identical values (a parked
  // truck's odometer and fuel level don't move). Reading the current values costs one select; skipping
  // unchanged trucks eliminates the bulk of the write churn + WAL/autovacuum pressure. Same pattern as
  // hosSync's diff (which existed for exactly this reason).
  const { data: rows } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id, current_odometer, samsara_fuel_percent, samsara_fuel_at")
    .eq("org_id", orgId)
    .not("samsara_vehicle_id", "is", null);

  let updated = 0;
  for (const r of (rows ?? []) as {
    id: string;
    samsara_vehicle_id: string;
    current_odometer: number | string | null;
    samsara_fuel_percent: number | string | null;
    samsara_fuel_at: string | null;
  }[]) {
    const odo = odometerMiles.get(r.samsara_vehicle_id);
    const fuel = fuelByVehicle.get(r.samsara_vehicle_id);
    if (odo == null && !fuel) continue; // Samsara reported nothing for this truck → leave it be
    const patch: {
      current_odometer?: number;
      samsara_fuel_percent?: number;
      samsara_fuel_at?: string | null;
    } = {};
    if (odo != null && Number(r.current_odometer) !== odo) patch.current_odometer = odo;
    if (
      fuel &&
      (Number(r.samsara_fuel_percent) !== fuel.percent || r.samsara_fuel_at !== fuel.time)
    ) {
      patch.samsara_fuel_percent = fuel.percent;
      patch.samsara_fuel_at = fuel.time;
    }
    if (Object.keys(patch).length === 0) continue; // nothing moved → no write
    await admin.from("vehicles").update(patch).eq("id", r.id).eq("org_id", orgId);
    updated++;
  }
  return { updated };
}
