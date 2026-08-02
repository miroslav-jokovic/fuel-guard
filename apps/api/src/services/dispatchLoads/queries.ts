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

/**
 * The Assignments board (D49): every driver, whether they are on duty, in which truck and trailer,
 * since when, and what they are working. This is the surface that makes duty sessions useful to
 * dispatch rather than only to the attribution engine.
 */
export async function listAssignments(admin: SupabaseClient, orgId: string): Promise<AssignmentRow[]> {
  const [driversRes, sessionsRes, loadsRes] = await Promise.all([
    admin.from("drivers").select("id, full_name, status").eq("org_id", orgId).order("full_name"),
    admin
      .from("driver_duty_sessions")
      .select("id, driver_id, started_at, duty_equipment_segments!inner(vehicle_id, trailer_id, to_at, vehicles(unit_number), trailers(unit_number))")
      .eq("org_id", orgId)
      .is("ended_at", null),
    admin
      .from("loads")
      .select("id, ref, status, driver_id")
      .eq("org_id", orgId)
      .in("status", ["offered", "accepted", "in_transit"]),
  ]);

  type SegJoin = { vehicle_id: string | null; trailer_id: string | null; to_at: string | null; vehicles: Join; trailers: Join };
  type SessionRow = { id: string; driver_id: string; started_at: string; duty_equipment_segments: SegJoin[] };

  const byDriver = new Map<string, SessionRow>();
  for (const s of (sessionsRes.data ?? []) as unknown as SessionRow[]) byDriver.set(s.driver_id, s);

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

  return ((driversRes.data ?? []) as { id: string; full_name: string; status: string | null }[]).map((d) => {
    const session = byDriver.get(d.id);
    const seg = session?.duty_equipment_segments.find((s) => s.to_at === null) ?? null;
    const load = loadByDriver.get(d.id) ?? null;
    return {
      driver_id: d.id,
      driver_name: d.full_name,
      driver_status: d.status,
      session_id: session?.id ?? null,
      started_at: session?.started_at ?? null,
      vehicle_id: seg?.vehicle_id ?? null,
      vehicle_unit: one(seg?.vehicles ?? null)?.unit_number ?? null,
      trailer_id: seg?.trailer_id ?? null,
      trailer_unit: one(seg?.trailers ?? null)?.unit_number ?? null,
      load_id: load?.id ?? null,
      load_ref: load?.ref ?? null,
      load_status: load?.status ?? null,
    };
  });
}
