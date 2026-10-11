/**
 * The loads module's read interface for "what is this truck hauling right now" (LM6, D-ARC3).
 *
 * Which loads count, and which stop is next, are not decided here: `isLoadOnTruck` and
 * `nextStopOnRoute` (shared `loadBoard.ts`) decide both, so the map and the Assignments board cannot
 * disagree. Since 2026-09-28 that means a McLeod load is drawn when McLeod has it `P` (D-MCC12), and
 * its next stop is the first one McLeod has not departed (and the driver app has not finished).
 *
 * An empty result is still a normal state, not an error: before the Board VM's first sync, production
 * `loads` holds only the old feed's rows, every one `pending_approval`, so no truck carries a load.
 * The board renders each with `load: null` and says nothing about it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ON_TRUCK_CANDIDATE_STATUSES, boardStops, compareLoadsOnTruck, isLoadOnTruck, nextStopOnRoute } from "@silvicom/shared";
import { chunks } from "../../lib/paging.js";

/** A stop still to be worked, in the shape the board hands to the map. */
export interface LiveLoadStop {
  seq: number | null;
  kind: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
  appointmentStart: string | null;
  appointmentEnd: string | null;
  status: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
}

export interface LiveLoadContext {
  loadId: string;
  ref: string | null;
  status: string;
  /** Where the load came from (`tms` = McLeod), so the map can word the status the way the board does. */
  source: string | null;
  /** McLeod's own movement code, for the same tooltip the Loads board shows. */
  externalStatus: string | null;
  nextStop: LiveLoadStop | null;
  /** First pickup and last delivery by `seq` (`boardStops`, TRUCK-CARD-ROUTE-PLAN D-TC2). */
  pickup: LiveLoadStop | null;
  delivery: LiveLoadStop | null;
  extraStops: number;
}

const PAGE_CAP = 1000;
/** Stops a stop-lookup will not go past. A load with more than this has a data problem, not a route. */
const STOP_CAP = 1000;

type LoadRow = {
  id: string;
  vehicle_id: string | null;
  ref: string | null;
  status: string;
  source: string | null;
  external_status: string | null;
};
type StopRow = {
  load_id: string;
  seq: number | null;
  kind: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
  appointment_start: string | null;
  appointment_end: string | null;
  status: string | null;
  external_status: string | null;
  location_name: string | null;
  address_line: string | null;
  postal_code: string | null;
};

/**
 * The live load for each vehicle that has one, keyed by vehicle id.
 *
 * Org-scoped on both reads — `admin` is the service role and bypasses RLS, so these filters are the
 * only tenant boundary the read has.
 *
 * A vehicle carrying two live loads at once gets ONE on the map, chosen by `compareLoadsOnTruck`
 * (the one under way, then the smaller reference), never by row order: this read has no ORDER BY and
 * PostgREST promises none. Until 2026-09-28 this said "the FIRST row wins deterministically", which
 * row order does not deliver; it is written down because "why is truck 412 showing the wrong load"
 * needs an answer that is not "it depends".
 */
export async function readLiveLoadContext(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ byVehicleId: Map<string, LiveLoadContext>; truncated: boolean }> {
  const { data: lData, error: lErr } = await admin
    .from("loads")
    .select("id, vehicle_id, ref, status, source, external_status")
    .eq("org_id", orgId)
    // The widest set any source can mean; `isLoadOnTruck` then applies each load's own rule.
    .in("status", [...ON_TRUCK_CANDIDATE_STATUSES])
    .not("vehicle_id", "is", null)
    .limit(PAGE_CAP);
  if (lErr) throw new Error(lErr.message);
  const fetched = (lData ?? []) as unknown as LoadRow[];
  const loads = fetched.filter(isLoadOnTruck).sort(compareLoadsOnTruck);
  if (loads.length === 0) return { byVehicleId: new Map(), truncated: fetched.length >= PAGE_CAP };

  // In id chunks (IN_LIST_CHUNK): one `.in()` over every load took the Loads board down at 454 ids
  // (#1392, Node 22's response-header limit). 114 loads are on trucks today; the fleet will grow.
  const stopRows: StopRow[] = [];
  for (const ids of chunks(loads.map((l) => l.id))) {
    const { data: sData, error: sErr } = await admin
      .from("load_stops")
      .select(
        "load_id, seq, kind, name, location_name, address_line, city, state, postal_code, appointment_start, appointment_end, status, external_status",
      )
      .eq("org_id", orgId)
      .in("load_id", ids)
      .order("seq", { ascending: true })
      .limit(STOP_CAP);
    if (sErr) throw new Error(sErr.message);
    stopRows.push(...((sData ?? []) as unknown as StopRow[]));
  }

  const stopsByLoad = new Map<string, StopRow[]>();
  for (const s of stopRows) {
    const list = stopsByLoad.get(s.load_id);
    if (list) list.push(s);
    else stopsByLoad.set(s.load_id, [s]);
  }
  const nextByLoad = new Map<string, LiveLoadStop>();
  const endsByLoad = new Map<string, { pickup: LiveLoadStop | null; delivery: LiveLoadStop | null; extraStops: number }>();
  for (const [loadId, stops] of stopsByLoad) {
    const s = nextStopOnRoute(stops);
    if (s) nextByLoad.set(loadId, toLiveStop(s));
    // `boardStops` wants a sequenced pickup or drop-off; a stop without either cannot be an end.
    const ends = boardStops(stops.filter(isBoardStop));
    endsByLoad.set(loadId, {
      pickup: ends.pickup ? toLiveStop(ends.pickup) : null,
      delivery: ends.delivery ? toLiveStop(ends.delivery) : null,
      extraStops: stops.length - (ends.pickup ? 1 : 0) - (ends.delivery ? 1 : 0),
    });
  }

  const byVehicleId = new Map<string, LiveLoadContext>();
  for (const l of loads) {
    if (!l.vehicle_id || byVehicleId.has(l.vehicle_id)) continue;
    byVehicleId.set(l.vehicle_id, {
      loadId: l.id,
      ref: l.ref,
      status: l.status,
      source: l.source,
      externalStatus: l.external_status,
      nextStop: nextByLoad.get(l.id) ?? null,
      pickup: endsByLoad.get(l.id)?.pickup ?? null,
      delivery: endsByLoad.get(l.id)?.delivery ?? null,
      extraStops: endsByLoad.get(l.id)?.extraStops ?? 0,
    });
  }
  return { byVehicleId, truncated: fetched.length >= PAGE_CAP };
}

const isBoardStop = (s: StopRow): s is StopRow & { seq: number; kind: "pickup" | "dropoff" } =>
  s.seq != null && (s.kind === "pickup" || s.kind === "dropoff");

/**
 * One stop as the map sees it. The NAME is McLeod's place name first, then ours — the Loads board's
 * `placeOf` order — so the card and the board name a stop the same way.
 */
function toLiveStop(s: StopRow): LiveLoadStop {
  return {
    seq: s.seq,
    kind: s.kind,
    name: s.location_name ?? s.name,
    city: s.city,
    state: s.state,
    appointmentStart: s.appointment_start,
    appointmentEnd: s.appointment_end,
    status: s.status,
    addressLine: s.address_line,
    postalCode: s.postal_code,
  };
}

/** A stop a route can be drawn through: sequenced and located (TRUCK-CARD-ROUTE-PLAN TC3). */
export interface LoadRouteStop {
  seq: number;
  kind: string | null;
  /** McLeod's place name first, then ours — the board's order (`toLiveStop`). */
  name: string | null;
  lat: number;
  lng: number;
}

export interface LoadForRoute {
  id: string;
  ref: string | null;
  vehicleId: string | null;
  hazmat: boolean;
  /** In McLeod's sequence. A stop without coordinates is dropped and counted in `unlocatedStops`. */
  stops: LoadRouteStop[];
  unlocatedStops: number;
}

/**
 * One load and its stops, for drawing its route (D-TC3). Org-scoped twice like every read here: the
 * load by `org_id`, and its stops by `org_id` as well as the load's id. Null when the load is not this
 * org's. Measured 2026-10-09: 249 of 249 on-truck stops carry coordinates.
 */
export async function readLoadForRoute(admin: SupabaseClient, orgId: string, loadId: string): Promise<LoadForRoute | null> {
  const { data: load, error } = await admin
    .from("loads")
    .select("id, ref, vehicle_id, hazmat")
    .eq("org_id", orgId)
    .eq("id", loadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!load) return null;
  const { data: stops, error: sErr } = await admin
    .from("load_stops")
    .select("seq, kind, name, location_name, lat, lon")
    .eq("org_id", orgId)
    .eq("load_id", loadId)
    .order("seq", { ascending: true });
  if (sErr) throw new Error(sErr.message);
  const rows = (stops ?? []) as { seq: number | null; kind: string | null; name: string | null; location_name: string | null; lat: number | string | null; lon: number | string | null }[];
  const located = rows
    .filter((s) => s.seq != null && s.lat != null && s.lon != null)
    .map((s) => ({ seq: s.seq!, kind: s.kind, name: s.location_name ?? s.name, lat: Number(s.lat), lng: Number(s.lon) }))
    .sort((a, b) => a.seq - b.seq);
  const l = load as { id: string; ref: string | null; vehicle_id: string | null; hazmat: boolean | null };
  return { id: l.id, ref: l.ref, vehicleId: l.vehicle_id, hazmat: Boolean(l.hazmat), stops: located, unlocatedStops: rows.length - located.length };
}
