import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who was in which truck, when — read from `driver_vehicle_assignments` (0051), the Samsara
 * driver↔vehicle assignments the seat sync has been storing every five minutes since April 2026
 * (DISPATCH-LOADS-COUNTS-PLAN D-DLC5, 2026-10-20).
 *
 * ── WHY THIS TABLE, AND NOT A SAMSARA CALL OR THE DUTY TIMELINE ──────────────────────────────────
 * The History tab read `driver_equipment_timeline`, built from the driver app's in-app shift, which
 * nobody has ever started: 0 rows in production, ever. Meanwhile this table held 199,600 segments
 * for 407 trucks and 235 drivers back to 2026-04-14, written by `syncDriverAssignments` from
 * Samsara's `/fleet/driver-vehicle-assignments` — the same source the roadside-inspection
 * attribution cites (D-IC7). It is six months deep, org-scoped and indexed, so the trail reads from
 * here with no Samsara call per page.
 *
 * ── AN OPEN SEGMENT IS NOT ALWAYS STILL HELD ─────────────────────────────────────────────────────
 * The writer upserts whatever Samsara returns for its lookback window (24 h on the five-minute pass,
 * 30 days on the full one). A segment that was open when it last fell inside that window keeps
 * `end_at = null` for good: measured 2026-10-20, 44,799 open rows, of which 184 had been refreshed in
 * the last two hours and 43,978 not for two days or more. So "open" means two things, and
 * `updated_at` tells them apart: an open row the sync has refreshed inside `STILL_HELD_WITHIN_MS` is
 * still held; any other open row ENDED, at a time Samsara no longer reports, and was last seen at
 * `updated_at`. The window filter below treats an open row's last sighting as its end for the same
 * reason — otherwise every stale-open row since April would overlap every range asked for.
 */

/** An open row refreshed inside this is still held; older, its end is simply not recorded. */
export const STILL_HELD_WITHIN_MS = 2 * 60 * 60 * 1000;

const PAGE_MAX = 200;

export interface AssignmentSegment {
  vehicleSamsaraId: string;
  driverSamsaraId: string;
  startAt: string;
  endAt: string | null;
  /** When the sync last saw this row in Samsara's answer — an open row's last sighting. */
  lastSeenAt: string;
}

export interface AssignmentSegmentQuery {
  /** Half-open [from, to) over the segment's span. */
  from: string;
  to: string;
  vehicleSamsaraId?: string;
  driverSamsaraId?: string;
  /** Keyset: the `start_at` of the last row seen; the next page starts strictly before it. */
  cursor?: string;
  limit: number;
}

interface Row {
  vehicle_samsara_id: string;
  driver_samsara_id: string;
  start_at: string;
  end_at: string | null;
  updated_at: string;
}

/**
 * Segments overlapping the query's window, newest start first, one keyset page. Overlap, not
 * containment: a segment that began before the window and ended inside it is the long shift an
 * investigation is chasing. An open row overlaps by its last sighting (see above).
 */
export async function readDriverVehicleAssignments(
  admin: SupabaseClient,
  orgId: string,
  q: AssignmentSegmentQuery,
): Promise<{ rows: AssignmentSegment[]; hasMore: boolean }> {
  const limit = Math.min(q.limit, PAGE_MAX);
  let query = admin
    .from("driver_vehicle_assignments")
    .select("vehicle_samsara_id, driver_samsara_id, start_at, end_at, updated_at")
    .eq("org_id", orgId)
    .lt("start_at", q.to)
    .or(`end_at.gt.${q.from},and(end_at.is.null,updated_at.gt.${q.from})`);
  if (q.vehicleSamsaraId) query = query.eq("vehicle_samsara_id", q.vehicleSamsaraId);
  if (q.driverSamsaraId) query = query.eq("driver_samsara_id", q.driverSamsaraId);
  if (q.cursor) query = query.lt("start_at", q.cursor);
  const { data, error } = await query.order("start_at", { ascending: false }).limit(limit + 1);
  if (error) throw new Error(error.message);
  const all = (data ?? []) as unknown as Row[];
  const page = all.length > limit ? all.slice(0, limit) : all;
  return {
    rows: page.map((r) => ({
      vehicleSamsaraId: r.vehicle_samsara_id,
      driverSamsaraId: r.driver_samsara_id,
      startAt: r.start_at,
      endAt: r.end_at,
      lastSeenAt: r.updated_at,
    })),
    hasMore: all.length > limit,
  };
}

/** Is an open segment still held as of `nowMs`, by the rule above? */
export function segmentStillHeld(s: Pick<AssignmentSegment, "endAt" | "lastSeenAt">, nowMs: number): boolean {
  return s.endAt == null && nowMs - Date.parse(s.lastSeenAt) <= STILL_HELD_WITHIN_MS;
}

export interface AssignmentParty {
  id: string;
  name: string;
}

/**
 * The roster's own ids and names for Samsara's: drivers by `samsara_driver_id`, trucks by
 * `samsara_vehicle_id`. A Samsara id the roster does not carry (a driver removed, a truck not yet
 * linked) is simply absent from the map; the caller says so rather than inventing a name.
 */
export async function resolveAssignmentParties(
  admin: SupabaseClient,
  orgId: string,
  ids: { driverSamsaraIds: readonly string[]; vehicleSamsaraIds: readonly string[] },
): Promise<{ drivers: Map<string, AssignmentParty>; vehicles: Map<string, AssignmentParty> }> {
  const drivers = new Map<string, AssignmentParty>();
  const vehicles = new Map<string, AssignmentParty>();
  if (ids.driverSamsaraIds.length) {
    const { data, error } = await admin
      .from("drivers")
      .select("id, full_name, samsara_driver_id")
      .eq("org_id", orgId)
      .in("samsara_driver_id", [...ids.driverSamsaraIds]);
    if (error) throw new Error(error.message);
    for (const d of (data ?? []) as { id: string; full_name: string | null; samsara_driver_id: string | null }[]) {
      if (d.samsara_driver_id) drivers.set(d.samsara_driver_id, { id: d.id, name: d.full_name ?? "Unnamed driver" });
    }
  }
  if (ids.vehicleSamsaraIds.length) {
    const { data, error } = await admin
      .from("vehicles")
      .select("id, unit_number, samsara_vehicle_id")
      .eq("org_id", orgId)
      .in("samsara_vehicle_id", [...ids.vehicleSamsaraIds]);
    if (error) throw new Error(error.message);
    for (const v of (data ?? []) as { id: string; unit_number: string | null; samsara_vehicle_id: string | null }[]) {
      if (v.samsara_vehicle_id) vehicles.set(v.samsara_vehicle_id, { id: v.id, name: v.unit_number ?? "Unknown unit" });
    }
  }
  return { drivers, vehicles };
}

/**
 * The Samsara ids behind a roster driver or truck chosen as a filter. A party with no Samsara id
 * can have no segments, and the caller returns none rather than every segment.
 */
export async function samsaraIdsOf(
  admin: SupabaseClient,
  orgId: string,
  who: { driverId?: string; vehicleId?: string },
): Promise<{ driverSamsaraId: string | null | undefined; vehicleSamsaraId: string | null | undefined }> {
  let driverSamsaraId: string | null | undefined;
  let vehicleSamsaraId: string | null | undefined;
  if (who.driverId) {
    const { data, error } = await admin.from("drivers").select("samsara_driver_id").eq("org_id", orgId).eq("id", who.driverId).maybeSingle();
    if (error) throw new Error(error.message);
    driverSamsaraId = (data as { samsara_driver_id: string | null } | null)?.samsara_driver_id ?? null;
  }
  if (who.vehicleId) {
    const { data, error } = await admin.from("vehicles").select("samsara_vehicle_id").eq("org_id", orgId).eq("id", who.vehicleId).maybeSingle();
    if (error) throw new Error(error.message);
    vehicleSamsaraId = (data as { samsara_vehicle_id: string | null } | null)?.samsara_vehicle_id ?? null;
  }
  return { driverSamsaraId, vehicleSamsaraId };
}
