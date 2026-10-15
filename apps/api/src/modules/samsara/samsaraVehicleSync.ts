import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseDriverCurrentTrucks,
  planDriverSeats,
  parseAssignmentIntervals,
  type SamsaraVehicle,
  type VehicleFuelLevel,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { loadSamsaraToken } from "./lib/samsaraToken.js";
import { isTmsRosterMaster } from "../mcleod/index.js";
import {
  makeSamsaraAssignmentFetcher,
  type SamsaraVehicleLister,
  type SamsaraOdometerFetcher,
  type SamsaraAssignmentFetcher,
} from "./lib/samsara.js";
import { recordMove } from "./vehicleRecordMoved.js";
import { fetchSamsaraVehicles, buildVehicleMaps, type ExistingRow } from "./lib/samsaraVehicleFetch.js";

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
  /**
   * Samsara vehicles whose VIN or name matched a row that already carries a DIFFERENT device Samsara
   * still lists — reported, never re-linked (FL1b, Q-FL6). Unit or Samsara name, one per vehicle.
   */
  heldByOtherDevice: string[];
  /** Samsara records that moved to another of our trucks and were re-linked to it, as
   *  "<old unit> → <new unit>" (`vehicleRecordMoved.ts`: 603 → 819 on 2026-10-12). */
  movedRecords: string[];
  /** Gateway swaps followed: a row moved off a record Samsara lists without a gateway, onto the record
   *  that has one, as "<unit>: <old id> → <new id>" (705, 767, 787, 800 on 2026-10-15). */
  followedSwaps: string[];
}

export class NoSamsaraTokenError extends Error {
  constructor() {
    super("No Samsara API token configured for this organization");
    this.name = "NoSamsaraTokenError";
  }
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
  liveIds: Set<string>,
  reportingIds: Set<string>,
): Promise<{ kind: "created" | "updated" | "unlinked" | "held"; unit?: string; moved?: string; swapped?: string }> {
  const identity = {
    make: sv.make,
    model: sv.model,
    year: sv.year,
    plate: sv.licensePlate,
    vin: sv.vin,
  };
  const odo = odometerMiles.get(sv.samsaraId);
  const fuel = fuelByVehicle.get(sv.samsaraId);
  // ── THE RECORD'S NAME TRAVELS WITH THE STATS, IN BOTH MODES (FL2, Q-FL8, migration 0401) ─────────
  //
  // The carrier renames a Samsara record to say what happened to the truck — `NNN - SOLD` once it is
  // sold and awaiting pickup, while McLeod still lists it Active — and FL2's parity check reads that
  // as a known state rather than a disagreement. Like the odometer it is what Samsara REPORTS, not
  // identity McLeod owns, so link-only mode writes it too. `parseSamsaraVehicles` falls back to the
  // id when a record has no name; that fallback is ours, not Samsara's, so it is stored as null.
  const samsaraName = sv.name === sv.samsaraId ? null : sv.name;
  const withStats = <T extends object>(o: T) => {
    let out: T & {
      samsara_name: string | null;
      current_odometer?: number;
      samsara_fuel_percent?: number;
      samsara_fuel_at?: string | null;
    } = { ...o, samsara_name: samsaraName };
    if (odo != null) out = { ...out, current_odometer: odo };
    if (fuel) out = { ...out, samsara_fuel_percent: fuel.percent, samsara_fuel_at: fuel.time };
    return out;
  };
  // The id match is checked against the VIN before it is believed — see `vehicleRecordMoved.ts`.
  const idMatch = maps.bySamsara.get(sv.samsaraId);
  const move = recordMove(sv.samsaraId, sv.vin, idMatch, maps.byVin, liveIds);
  if (move.kind === "contested") return { kind: "held", unit: sv.name };
  if (move.kind === "moved") {
    // Released first: `uq_vehicles_org_samsara` allows one row per record. The write repeats the id it
    // expects, so a row re-linked since the read is left alone.
    await admin
      .from("vehicles")
      .update({ samsara_vehicle_id: null })
      .eq("id", move.from.id)
      .eq("org_id", orgId)
      .eq("samsara_vehicle_id", sv.samsaraId);
    move.from.samsara_vehicle_id = null;
    maps.bySamsara.set(sv.samsaraId, move.to);
  }
  const match =
    (move.kind === "moved" ? move.to : idMatch) ??
    (sv.vin ? maps.byVin.get(sv.vin.toUpperCase()) : undefined) ??
    maps.byUnit.get(sv.name);
  const moved = move.kind === "moved" ? `${move.from.unit_number} → ${move.to.unit_number}` : undefined;
  // ── A VIN OR NAME MATCH NEVER TAKES A ROW FROM ANOTHER DEVICE SAMSARA STILL LISTS (FL1b, Q-FL6) ──
  //
  // When a gateway is swapped, Samsara keeps the retired gateway's vehicle record (`568 - OLD`) and
  // the record can keep the truck's VIN. Measured 2026-10-01: both of unit 568's records carry VIN
  // `…9642`. Matching the second record by VIN onto the row the first record is linked to would move
  // `samsara_vehicle_id` to it, and the first record would move it back by id on the same pass —
  // every identity cycle, forever — while every telemetry reader keyed on the id followed it. A row
  // that already carries a device Samsara still reports belongs to that device; the fallback match
  // is reported instead. A row whose device Samsara no longer lists is fair game: that IS the swap
  // this fallback exists to follow.
  // (An id match always carries its own id, so only the two fallbacks can reach this.)
  //
  // ── ...UNLESS THE DEVICE STILL LISTED HAS NO GATEWAY AND THIS ONE HAS (2026-10-15) ──────────────
  // "Still lists" turned out not to mean "still reports". Samsara never deletes a swapped-out record:
  // it renames it `NNN - OLD` and removes its gateway. Measured 2026-10-15, units 705, 767, 787 and 800
  // got new gateways on 10/14 and every one was held here against its own dead record, so the map
  // showed them a day stale while Samsara had them moving. A record with a gateway may therefore take
  // a row from a record without one. Never the reverse, and never between two gateway-less records:
  // 568's `- SOLD` and `- OLD` both lack one, and letting either take the row from the other is the
  // flip-flop this guard exists to stop.
  const holder = match?.samsara_vehicle_id;
  if (holder != null && holder !== sv.samsaraId && liveIds.has(holder)) {
    const swap = sv.gatewaySerial != null && !reportingIds.has(holder);
    if (!swap) return { kind: "held", unit: sv.name };
  }
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
    // A followed swap re-points the maps too, so the dead record — later in this same pass — finds the
    // row held by a gateway and is reported, rather than matching by its stale id and taking it back.
    if (holder != null && holder !== sv.samsaraId) {
      maps.bySamsara.delete(holder);
      maps.bySamsara.set(sv.samsaraId, match);
      match.samsara_vehicle_id = sv.samsaraId;
      return { kind: "updated", moved, swapped: `${match.unit_number}: ${holder} → ${sv.samsaraId}` };
    }
    return { kind: "updated", moved };
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

/**
 * The seat pass, in two depths. `full` — the identity tier's 30-day read — also keeps the assignment
 * history (`driver_vehicle_assignments`) and a team truck's second driver. `seats` — every five
 * minutes from the clocks tier — writes only who is in which truck.
 *
 * ── WHY THE FAST PASS LEAVES THE TEAMMATE AND THE HISTORY ALONE (2026-10-15) ────────────────────
 * Replayed against production that day with the same roster: a 24-hour window planned exactly the
 * seats and clears the 30-day window did (0 differences), in 7 s against 270 s. Seats depend only on
 * each driver's LATEST start, and an assignment still open overlaps any window. A teammate does not:
 * `parseDriverCurrentTrucks` asks whether they drove the truck since the holder FIRST did, which needs
 * history — the 24-hour plan would have emptied 2 co-driver slots and even a 7-day one 1, and the
 * 12-hour pass would put them back, forever. So the fast pass leaves `co_driver_id` to the pass that can
 * see far enough back, and rewriting ~1,700 history rows every five minutes would buy nothing either.
 */
async function syncDriverAssignments(
  admin: SupabaseClient,
  env: Env,
  token: string,
  orgId: string,
  assignmentOverride?: SamsaraAssignmentFetcher,
  depth: "full" | "seats" = "full",
): Promise<number> {
  try {
    const fetcher = assignmentOverride ?? makeSamsaraAssignmentFetcher(env, token, depth === "seats" ? 24 : undefined);
    const rawAssign = (await fetcher()) as Parameters<typeof parseDriverCurrentTrucks>[0];
    const intervals = parseAssignmentIntervals(rawAssign);
    if (intervals.length && depth === "full") {
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
    if (!intervals.length) return 0;
    const [{ data: vRows }, { data: dRows }] = await Promise.all([
      admin
        .from("vehicles")
        .select("id, samsara_vehicle_id, assigned_driver_id, co_driver_id")
        .eq("org_id", orgId),
      // Every roster row, not only those with a Samsara id or still employed: the plan must also see
      // a former driver a truck still names, to take them off it (`planDriverSeats`).
      admin
        .from("drivers")
        .select("id, samsara_driver_id, status, archived_at")
        .eq("org_id", orgId),
    ]);
    type V = { id: string; samsara_vehicle_id: string | null; assigned_driver_id: string | null; co_driver_id: string | null };
    type D = { id: string; samsara_driver_id: string | null; status: string | null; archived_at: string | null };
    // One truck per driver, one driver per truck, former drivers on none — the whole rule, and the
    // production cases behind it (506/807, the team on 799, the trailer tie, 563), live in
    // `driverTrucks.ts`. This function only reads and writes.
    const plan = planDriverSeats(
      rawAssign,
      ((vRows ?? []) as V[]).map((v) => ({ id: v.id, samsaraVehicleId: v.samsara_vehicle_id, assignedDriverId: v.assigned_driver_id, coDriverId: v.co_driver_id })),
      ((dRows ?? []) as D[]).map((d) => ({ id: d.id, samsaraDriverId: d.samsara_driver_id, status: d.status, archived: d.archived_at !== null })),
    );
    for (const s of plan.set) {
      await admin.from("vehicles").update({ assigned_driver_id: s.driverId }).eq("id", s.vehicleId).eq("org_id", orgId);
    }
    // Each clear repeats the driver it expects, so an office edit made since the read is not undone.
    for (const c of plan.clear) {
      await admin
        .from("vehicles")
        .update({ assigned_driver_id: null })
        .eq("id", c.vehicleId)
        .eq("org_id", orgId)
        .eq("assigned_driver_id", c.driverId);
    }
    // A team truck's second driver (0475), written the same way: each change names what it expects.
    for (const m of depth === "full" ? plan.teammates : []) {
      const q = admin.from("vehicles").update({ co_driver_id: m.driverId }).eq("id", m.vehicleId).eq("org_id", orgId);
      await (m.expected === null ? q.is("co_driver_id", null) : q.eq("co_driver_id", m.expected));
    }
    return plan.seated;
  } catch {
    /* assignments are best-effort */
    return 0;
  }
}

/** Who is in which truck now, from a 24-hour window — the clocks tier's five-minute seat pass. */
export async function syncDriverSeatsFromSamsara(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  assignmentOverride?: SamsaraAssignmentFetcher,
): Promise<number> {
  const token = assignmentOverride ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();
  return syncDriverAssignments(admin, env, token, orgId, assignmentOverride, "seats");
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
  const liveIds = new Set(vehicles.map((sv) => sv.samsaraId));
  const reportingIds = new Set(vehicles.filter((sv) => sv.gatewaySerial != null).map((sv) => sv.samsaraId));

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
    samsaraMissing: await applyReplacementLifecycle(admin, orgId, existing, liveIds),
    unlinked: linkOnly ? [] : undefined,
    heldByOtherDevice: [],
    movedRecords: [],
    followedSwaps: [],
  };

  for (const sv of vehicles) {
    const synced = await upsertSamsaraVehicle(admin, orgId, sv, odometerMiles, fuelByVehicle, maps, linkOnly, liveIds, reportingIds);
    if (synced.kind === "held") {
      result.heldByOtherDevice.push(synced.unit!);
    } else if (synced.kind === "created") {
      result.created++;
      result.needsCompletion.push(synced.unit!);
    } else if (synced.kind === "unlinked") {
      result.unlinked!.push(synced.unit!);
    } else {
      result.updated++;
      if (synced.moved) result.movedRecords.push(synced.moved);
      if (synced.swapped) result.followedSwaps.push(synced.swapped);
    }
  }

  // An unmatched truck under TMS mastery means a vehicle is reporting telematics that the carrier's
  // own fleet list does not contain. That is a finding, and until M7 gives it a surface an admin
  // actually looks at, the log is where this integration already reports — the same place the driver
  // sync's bad-fetch guard and the trailer sync's pairing pass report from.
  if (result.unlinked?.length) {
    console.warn(`[vehicle-sync] ${result.unlinked.length} Samsara vehicle(s) are not on the TMS fleet list: ${result.unlinked.join(", ")}`);
  }
  if (result.followedSwaps.length) {
    console.warn(`[vehicle-sync] ${result.followedSwaps.length} gateway swap(s) followed: ${result.followedSwaps.join(", ")}`);
  }
  if (result.movedRecords.length) {
    console.warn(`[vehicle-sync] ${result.movedRecords.length} Samsara vehicle(s) moved to another truck and were re-linked: ${result.movedRecords.join(", ")}`);
  }
  if (result.heldByOtherDevice.length) {
    console.warn(`[vehicle-sync] ${result.heldByOtherDevice.length} Samsara vehicle(s) match a truck another listed device holds: ${result.heldByOtherDevice.join(", ")}`);
  }

  // ── Driver assignments: put each driver on their one current truck, and off every other ──────
  // Best-effort: needs drivers synced first (so they carry samsara_driver_id) + the "Read Assignments"
  // token scope. Any failure here leaves identity/odometer sync intact.
  result.assigned = await syncDriverAssignments(admin, env, token, orgId, assignmentOverride);

  return result;
}

function pickUnitNumber(sv: SamsaraVehicle): string {
  return sv.name?.trim() || sv.vin || `SAMSARA-${sv.samsaraId}`;
}

/**
 * The ONE place this module writes a truck's live telematics columns.
 *
 * WHY IT IS A FUNCTION AND NOT AN INLINE `.update()` WHERE IT IS USED. `vehicles` is owned by
 * `roster`, not by this module (scripts/table-modules.json), and `lint:table-modules` grandfathers
 * exactly one out-of-owner write site for it here — a list that is allowed to SHRINK and not to grow.
 * When SAM-S2 moved the live-stats tier into `samsaraStatsFeed.ts`, writing `vehicles` from that new
 * file would have been a second pinned site for the same violation: the same debt, relocated, counted
 * twice, and a ratchet quietly stepped backwards. So the collector reads and diffs where its logic
 * lives, and the write stays where it was already accounted for.
 *
 * The real fix is a roster-owned interface for "a collector observed this truck", and it is not this
 * step's to build. Until it exists this function is the seam it will replace.
 */
export async function writeVehicleTelematics(
  admin: SupabaseClient,
  orgId: string,
  vehicleId: string,
  patch: { current_odometer?: number; samsara_fuel_percent?: number; samsara_fuel_at?: string | null },
): Promise<void> {
  await admin.from("vehicles").update(patch).eq("id", vehicleId).eq("org_id", orgId);
}
