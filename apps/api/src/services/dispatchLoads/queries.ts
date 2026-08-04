import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignmentRow } from "@fuelguard/shared";
import { LOAD_COLUMNS, STOP_COLUMNS, one, type Join } from "./shared.js";

/**
 * Dispatch-side reads (P2 split). Wide by design — dispatch sees every status. The counterpart writes
 * live in `./mutations.ts`; the shared column lists + join helper in `./shared.ts`.
 */

/** Every load in the org with stops nested — dispatch's queue, all statuses. */
export async function listLoads(admin: SupabaseClient, orgId: string): Promise<unknown[]> {
  const { data: loads, error } = await admin
    .from("loads")
    .select(LOAD_COLUMNS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (loads ?? []) as unknown as (Record<string, unknown> & { id: string })[];
  if (rows.length === 0) return [];

  const { data: stops } = await admin
    .from("load_stops")
    .select(STOP_COLUMNS)
    .in("load_id", rows.map((r) => r.id))
    .order("seq", { ascending: true });

  const byLoad = new Map<string, unknown[]>();
  for (const s of (stops ?? []) as unknown as { load_id: string }[]) {
    const list = byLoad.get(s.load_id) ?? [];
    list.push(s);
    byLoad.set(s.load_id, list);
  }

  return rows.map((r) => {
    const { drivers, vehicles, trailers, ...rest } = r as unknown as Record<string, unknown> & {
      drivers: Join;
      vehicles: Join;
      trailers: Join;
    };
    return {
      ...rest,
      driver_name: one(drivers)?.full_name ?? null,
      vehicle_unit: one(vehicles)?.unit_number ?? null,
      trailer_unit: one(trailers)?.unit_number ?? null,
      stops: byLoad.get(r.id) ?? [],
    };
  });
}

/** The append-only timeline for one load, newest first, with the actor's name resolved. */
export async function listEvents(admin: SupabaseClient, orgId: string, loadId: string): Promise<unknown[]> {
  const { data } = await admin
    .from("load_events")
    .select("id, kind, from_status, to_status, actor_role, payload, occurred_at, recorded_at, drivers(full_name)")
    .eq("org_id", orgId)
    .eq("load_id", loadId)
    .order("occurred_at", { ascending: false });

  return ((data ?? []) as unknown as (Record<string, unknown> & { drivers: Join })[]).map((e) => {
    const { drivers, ...rest } = e;
    return { ...rest, actor_name: one(drivers)?.full_name ?? null };
  });
}

/** Latest ELD duty segments (newest first, bounded) → each driver's "in current status since". */
async function dutySinceByDriver(admin: SupabaseClient, orgId: string): Promise<Map<string, { status: string; started_at: string }>> {
  // One bounded query, newest first: ~6 recent segments per driver at fleet size; the FIRST row seen per
  // driver is their latest segment. Bounded so the board read stays O(fleet), not O(history).
  const { data } = await admin
    .from("hos_duty_segments")
    .select("driver_id, status, started_at")
    .eq("org_id", orgId)
    .not("driver_id", "is", null)
    .order("started_at", { ascending: false })
    .limit(2000);
  const out = new Map<string, { status: string; started_at: string }>();
  for (const s of (data ?? []) as { driver_id: string; status: string; started_at: string }[]) {
    if (!out.has(s.driver_id)) out.set(s.driver_id, { status: s.status, started_at: s.started_at });
  }
  return out;
}

/**
 * The Assignments board (D49), TELEMATICS-SOURCED: every driver's live HOS duty status, current truck
 * (from /fleet/hos/clocks via drivers.current_hos_*), city location, paired trailer, and the load they
 * are working. The in-app driver-shift feature is not used by this fleet, so duty sessions only GATE
 * the legacy "End shift" action (shown when a real session is open) — they no longer source the board.
 */
export async function listAssignments(admin: SupabaseClient, orgId: string): Promise<AssignmentRow[]> {
  const [driversRes, sessionsRes, loadsRes, vehiclesRes, trailersRes, dutySince] = await Promise.all([
    admin
      .from("drivers")
      .select("id, full_name, status, current_hos_status, current_hos_vehicle, current_location")
      .eq("org_id", orgId)
      .order("full_name"),
    admin
      .from("driver_duty_sessions")
      .select("id, driver_id, started_at")
      .eq("org_id", orgId)
      .is("ended_at", null),
    admin
      .from("loads")
      .select("id, ref, status, driver_id")
      .eq("org_id", orgId)
      .in("status", ["offered", "accepted", "in_transit"]),
    admin.from("vehicles").select("id, unit_number").eq("org_id", orgId),
    admin
      .from("trailers")
      .select("unit_number, assigned_vehicle_id")
      .eq("org_id", orgId)
      .not("assigned_vehicle_id", "is", null),
    dutySinceByDriver(admin, orgId),
  ]);

  const sessionByDriver = new Map<string, { id: string; started_at: string }>();
  for (const s of (sessionsRes.data ?? []) as { id: string; driver_id: string; started_at: string }[]) {
    sessionByDriver.set(s.driver_id, { id: s.id, started_at: s.started_at });
  }

  const loadByDriver = new Map<string, { id: string; ref: string; status: string }>();
  for (const l of (loadsRes.data ?? []) as unknown as { id: string; ref: string; status: string; driver_id: string | null }[]) {
    if (!l.driver_id) continue;
    // in_transit outranks accepted outranks offered — show what they are actually doing.
    const held = loadByDriver.get(l.driver_id);
    const rank = (s: string) => (s === "in_transit" ? 3 : s === "accepted" ? 2 : 1);
    if (!held || rank(l.status) > rank(held.status)) {
      loadByDriver.set(l.driver_id, { id: l.id, ref: l.ref, status: l.status });
    }
  }

  // drivers.current_hos_vehicle stores the truck's UNIT NAME (Samsara display name) → resolve to our
  // vehicle row, then to its currently-paired trailer.
  const vehicleByUnit = new Map(
    ((vehiclesRes.data ?? []) as { id: string; unit_number: string }[]).map((v) => [v.unit_number, v.id]),
  );
  const trailerByVehicle = new Map(
    ((trailersRes.data ?? []) as { unit_number: string; assigned_vehicle_id: string }[]).map((t) => [
      t.assigned_vehicle_id,
      t.unit_number,
    ]),
  );

  type DriverRow = {
    id: string; full_name: string; status: string | null;
    current_hos_status: string | null; current_hos_vehicle: string | null; current_location: string | null;
  };
  return ((driversRes.data ?? []) as DriverRow[]).map((d) => {
    const session = sessionByDriver.get(d.id) ?? null;
    const load = loadByDriver.get(d.id) ?? null;
    const vehicleId = d.current_hos_vehicle ? (vehicleByUnit.get(d.current_hos_vehicle) ?? null) : null;
    const latest = dutySince.get(d.id) ?? null;
    return {
      driver_id: d.id,
      driver_name: d.full_name,
      driver_status: d.status,
      session_id: session?.id ?? null,
      started_at: session?.started_at ?? null,
      duty_status: d.current_hos_status,
      // "In status since" only when the latest ELD segment agrees with the live clock status —
      // a mid-transition mismatch shows "—" rather than a wrong duration.
      duty_since: latest && latest.status === d.current_hos_status ? latest.started_at : null,
      location: d.current_location,
      vehicle_id: vehicleId,
      vehicle_unit: d.current_hos_vehicle,
      trailer_id: null, // trailer identity is by unit below; the id column is legacy-shape
      trailer_unit: vehicleId ? (trailerByVehicle.get(vehicleId) ?? null) : null,
      load_id: load?.id ?? null,
      load_ref: load?.ref ?? null,
      load_status: load?.status ?? null,
    };
  });
}
