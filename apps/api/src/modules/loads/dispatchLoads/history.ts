import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDeliveredAt, loadPickedUpAt, type AssignmentHistoryQuery, type AssignmentHistoryRow } from "@silvicom/shared";
import { fetchAllPaged } from "../../../lib/paging.js";
import { readDriverVehicleAssignments, resolveAssignmentParties, samsaraIdsOf, segmentStillHeld, type AssignmentSegment } from "../../roster/index.js";

/**
 * The attribution trail (loads plan L5, D-L6; rebuilt on DISPATCH-LOADS-COUNTS-PLAN D-DLC5, 2026-10-20).
 *
 * §14.9 designates this the audit record behind every evidence panel the detection engine renders —
 * "who was in this truck at 14:20 on the 3rd" is the question an anomaly investigation opens with.
 * Until 2026-10-20 it read `driver_equipment_timeline`, built from the driver app's in-app shift,
 * which has never been started: the tab was empty by construction. It now reads Samsara's
 * driver↔vehicle assignments through the roster's `readDriverVehicleAssignments` — the source the
 * roadside-inspection attribution cites (D-IC7), stored every five minutes since April 2026 — and
 * names, beside each segment, the McLeod loads the truck was on while it ran.
 *
 * Filtering by driver or truck resolves the roster id to its Samsara id first; a party with no
 * Samsara id has no segments, and the answer is none, not everything.
 */

interface LoadOnTruck {
  ref: string;
  vehicle_id: string;
  created_at: string;
  stops: { seq: number; kind: "pickup" | "dropoff"; actual_departure_at: string | null; completed_at: string | null }[];
}

/** How far before the range a load may have started and still be on the truck inside it. */
const LOAD_LOOKBACK_MS = 45 * 24 * 60 * 60 * 1000;

export async function listAssignmentHistory(
  admin: SupabaseClient,
  orgId: string,
  q: AssignmentHistoryQuery,
  now: Date = new Date(),
): Promise<{ rows: AssignmentHistoryRow[]; nextCursor: string | null }> {
  const who = await samsaraIdsOf(admin, orgId, { driverId: q.driverId, vehicleId: q.vehicleId });
  if (who.driverSamsaraId === null || who.vehicleSamsaraId === null) return { rows: [], nextCursor: null };

  const page = await readDriverVehicleAssignments(admin, orgId, {
    from: q.from,
    to: q.to,
    driverSamsaraId: who.driverSamsaraId ?? undefined,
    vehicleSamsaraId: who.vehicleSamsaraId ?? undefined,
    cursor: q.cursor,
    limit: q.limit,
  });
  const segments = page.rows;
  const nextCursor = page.hasMore && segments.length > 0 ? segments[segments.length - 1]!.startAt : null;

  const parties = await resolveAssignmentParties(admin, orgId, {
    driverSamsaraIds: [...new Set(segments.map((s) => s.driverSamsaraId))],
    vehicleSamsaraIds: [...new Set(segments.map((s) => s.vehicleSamsaraId))],
  });
  const vehicleIds = [...new Set([...parties.vehicles.values()].map((v) => v.id))];
  const loads = await readLoadsOnTrucks(admin, orgId, vehicleIds, q.from);
  const nowMs = now.getTime();

  return {
    rows: segments.map((s) => {
      const driver = parties.drivers.get(s.driverSamsaraId) ?? null;
      const vehicle = parties.vehicles.get(s.vehicleSamsaraId) ?? null;
      return {
        segment_id: `${s.vehicleSamsaraId}:${s.driverSamsaraId}:${s.startAt}`,
        driver_id: driver?.id ?? null,
        driver_name: driver?.name ?? null,
        driver_samsara_id: s.driverSamsaraId,
        vehicle_id: vehicle?.id ?? null,
        vehicle_unit: vehicle?.name ?? null,
        vehicle_samsara_id: s.vehicleSamsaraId,
        load_refs: vehicle ? loadsDuring(loads, vehicle.id, s, nowMs) : [],
        still_held: segmentStillHeld(s, nowMs),
        last_seen_at: s.lastSeenAt,
        from_at: s.startAt,
        to_at: s.endAt,
      };
    }),
    nextCursor,
  };
}

/**
 * The McLeod loads on these trucks that could have been under way inside the range: created inside
 * the range or within `LOAD_LOOKBACK_MS` before it. One read, paged, with the stops the span needs.
 */
async function readLoadsOnTrucks(admin: SupabaseClient, orgId: string, vehicleIds: readonly string[], fromIso: string): Promise<LoadOnTruck[]> {
  if (!vehicleIds.length) return [];
  const since = new Date(Date.parse(fromIso) - LOAD_LOOKBACK_MS).toISOString();
  return fetchAllPaged<LoadOnTruck>((from, to) =>
    admin
      .from("loads")
      .select("ref, vehicle_id, created_at, stops:load_stops(seq, kind, actual_departure_at, completed_at)")
      .eq("org_id", orgId)
      .in("vehicle_id", [...vehicleIds])
      .gte("created_at", since)
      .order("id")
      .range(from, to)
      .then(({ data, error }) => ({ data: data as unknown as LoadOnTruck[] | null, error })),
  );
}

/**
 * The loads a truck was on while a segment ran: the load's span is from when it left the pickup
 * (else when the mirror first saw it) to when it left the last drop (else now); the segment's span
 * ends at its end, else at its last sighting. Overlap, by load number, in McLeod's order.
 */
function loadsDuring(loads: readonly LoadOnTruck[], vehicleId: string, s: AssignmentSegment, nowMs: number): string[] {
  const segStart = Date.parse(s.startAt);
  const segEnd = s.endAt ? Date.parse(s.endAt) : Math.min(nowMs, Date.parse(s.lastSeenAt) + 1);
  return loads
    .filter((l) => l.vehicle_id === vehicleId)
    .filter((l) => {
      const start = Date.parse(loadPickedUpAt(l.stops) ?? l.created_at);
      const end = loadDeliveredAt(l.stops);
      const endMs = end ? Date.parse(end) : nowMs;
      return start < segEnd && endMs > segStart;
    })
    .map((l) => l.ref)
    .sort();
}
