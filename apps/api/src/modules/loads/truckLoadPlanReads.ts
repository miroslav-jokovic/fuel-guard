/**
 * The loads module's read for the dispatch board: each truck's CURRENT load and its NEXT one, with the
 * stops the board judges them by (DISPATCH-BOARD-PLAN DB4, D-ARC3).
 *
 * Which load is on a truck is not decided here: `isLoadOnTruck` and `compareLoadsOnTruck` (shared
 * `loadBoard.ts`) decide it, exactly as they do for the live map and Assignments, so the three cannot
 * disagree. What this adds is the NEXT load — an open load McLeod has already planned onto the same
 * truck but not dispatched (`A` with a truck, "Planned" on the Loads page). Eight trucks carried one on
 * 2026-10-09; a truck carrying none is the board's "No next load" queue.
 *
 * Loads with no truck have no row on a truck board. They are COUNTED (`uncoveredCount`, by
 * `loadBoardState`'s own "uncovered" queue) so the board can link to them on the Loads page rather than
 * keep a second list of them (D-DB5).
 *
 * Org-scoped on both reads — the service role bypasses RLS, so these filters are the tenant boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  boardStops,
  chunks,
  compareLoadsOnTruck,
  isLoadOnTruck,
  isStopBehindTruck,
  loadBoardState,
  nextStopOnRoute,
  type DispatchBoardLoad,
  type DispatchBoardStop,
  type LoadStatus,
} from "@silvicom/shared";

const PAGE_CAP = 1000;
const STOP_CAP = 1000;
/** A load in either of these is finished; everything else is open work. */
const CLOSED: readonly LoadStatus[] = ["delivered", "canceled"];

type LoadRow = {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  ref: string | null;
  status: string;
  source: string | null;
  external_status: string | null;
  customer_name: string | null;
  dispatcher_external_id: string | null;
  drivers: { full_name: string | null } | null;
  trailers: { unit_number: string | null } | null;
};
type StopRow = {
  load_id: string;
  seq: number | null;
  kind: string | null;
  name: string | null;
  location_name: string | null;
  city: string | null;
  state: string | null;
  appointment_start: string | null;
  appointment_end: string | null;
  status: string | null;
  external_status: string | null;
  actual_arrival_at: string | null;
  lat: number | null;
  lon: number | null;
};

export interface TruckLoadPlan {
  current: DispatchBoardLoad | null;
  next: DispatchBoardLoad | null;
}

export async function readTruckLoadPlans(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ byVehicleId: Map<string, TruckLoadPlan>; uncoveredCount: number; truncated: boolean }> {
  const { data, error } = await admin
    .from("loads")
    .select(
      "id, vehicle_id, driver_id, ref, status, source, external_status, customer_name, dispatcher_external_id, " +
        "drivers(full_name), trailers(unit_number)",
    )
    .eq("org_id", orgId)
    .not("status", "in", `(${CLOSED.join(",")})`)
    .is("external_closed_at", null)
    .limit(PAGE_CAP);
  if (error) throw new Error(error.message);
  const loads = (data ?? []) as unknown as LoadRow[];

  const uncoveredCount = loads.filter((l) => loadBoardState({ ...l, status: l.status as LoadStatus, source: l.source ?? "" }).queue === "uncovered").length;
  const onTrucks = loads.filter((l) => l.vehicle_id);

  const stops = new Map<string, StopRow[]>();
  for (const ids of chunks(onTrucks.map((l) => l.id))) {
    const { data: sData, error: sErr } = await admin
      .from("load_stops")
      .select(
        "load_id, seq, kind, name, location_name, city, state, appointment_start, appointment_end, status, " +
          "external_status, actual_arrival_at, lat, lon",
      )
      .eq("org_id", orgId)
      .in("load_id", ids)
      .order("seq", { ascending: true })
      .limit(STOP_CAP);
    if (sErr) throw new Error(sErr.message);
    for (const s of (sData ?? []) as unknown as StopRow[]) {
      const list = stops.get(s.load_id);
      if (list) list.push(s);
      else stops.set(s.load_id, [s]);
    }
  }

  const byTruck = new Map<string, LoadRow[]>();
  for (const l of onTrucks) byTruck.set(l.vehicle_id!, [...(byTruck.get(l.vehicle_id!) ?? []), l]);

  const byVehicleId = new Map<string, TruckLoadPlan>();
  for (const [vehicleId, list] of byTruck) {
    const current = list.filter(isLoadOnTruck).sort(compareLoadsOnTruck)[0] ?? null;
    // The next load: open, on this truck, not the one being driven — the earliest by first appointment,
    // then the smaller reference, so it is the same answer on every read.
    const firstAt = (l: LoadRow) => (stops.get(l.id) ?? []).map((s) => s.appointment_start).find((t) => !!t) ?? "9999";
    const next =
      list
        .filter((l) => l !== current && !isLoadOnTruck(l))
        .sort((a, b) => firstAt(a).localeCompare(firstAt(b)) || (a.ref ?? "").localeCompare(b.ref ?? ""))[0] ?? null;
    byVehicleId.set(vehicleId, {
      current: current ? toBoardLoad(current, stops.get(current.id) ?? []) : null,
      next: next ? toBoardLoad(next, stops.get(next.id) ?? []) : null,
    });
  }
  return { byVehicleId, uncoveredCount, truncated: loads.length >= PAGE_CAP };
}

function toBoardStop(s: StopRow): DispatchBoardStop {
  return {
    seq: s.seq,
    kind: s.kind,
    name: s.location_name ?? s.name,
    city: s.city,
    state: s.state,
    appointmentStart: s.appointment_start,
    appointmentEnd: s.appointment_end,
    arrivedAt: s.actual_arrival_at,
    lat: s.lat,
    // load_stops stores `lon`; the board, like the map, says `lng`.
    lng: s.lon,
  };
}

function toBoardLoad(l: LoadRow, stops: StopRow[]): DispatchBoardLoad {
  const next = nextStopOnRoute(stops);
  const ends = boardStops(stops.filter((s): s is StopRow & { seq: number; kind: "pickup" | "dropoff" } =>
    s.seq != null && (s.kind === "pickup" || s.kind === "dropoff")));
  return {
    loadId: l.id,
    ref: l.ref,
    status: l.status,
    source: l.source,
    externalStatus: l.external_status,
    customerName: l.customer_name,
    dispatcherId: l.dispatcher_external_id,
    driverName: l.drivers?.full_name ?? null,
    trailerUnit: l.trailers?.unit_number ?? null,
    nextStop: next ? toBoardStop(next) : null,
    lastStop: ends.delivery ? toBoardStop(ends.delivery) : null,
    stopsLeft: stops.filter((s) => !isStopBehindTruck(s)).length,
  };
}
