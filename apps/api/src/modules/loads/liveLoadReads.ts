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
import { ON_TRUCK_CANDIDATE_STATUSES, compareLoadsOnTruck, isLoadOnTruck, nextStopOnRoute } from "@silvicom/shared";

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

  const { data: sData, error: sErr } = await admin
    .from("load_stops")
    .select("load_id, seq, kind, name, city, state, appointment_start, appointment_end, status, external_status")
    .eq("org_id", orgId)
    .in(
      "load_id",
      loads.map((l) => l.id),
    )
    .order("seq", { ascending: true })
    .limit(STOP_CAP);
  if (sErr) throw new Error(sErr.message);

  const stopsByLoad = new Map<string, StopRow[]>();
  for (const s of (sData ?? []) as unknown as StopRow[]) {
    const list = stopsByLoad.get(s.load_id);
    if (list) list.push(s);
    else stopsByLoad.set(s.load_id, [s]);
  }
  const nextByLoad = new Map<string, LiveLoadStop>();
  for (const [loadId, stops] of stopsByLoad) {
    const s = nextStopOnRoute(stops);
    if (!s) continue;
    nextByLoad.set(loadId, {
      seq: s.seq,
      kind: s.kind,
      name: s.name,
      city: s.city,
      state: s.state,
      appointmentStart: s.appointment_start,
      appointmentEnd: s.appointment_end,
      status: s.status,
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
    });
  }
  return { byVehicleId, truncated: fetched.length >= PAGE_CAP };
}
