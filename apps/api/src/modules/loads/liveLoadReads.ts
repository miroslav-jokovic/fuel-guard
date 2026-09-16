/**
 * The loads module's read interface for "what is this truck hauling right now" (LM6, D-ARC3).
 *
 * ⚠ THIS RETURNS NOTHING IN PRODUCTION TODAY, AND THAT IS THE DOCUMENTED NORMAL STATE. `loads` has
 * **0 rows** (measured 2026-09-15); the TMS feed that fills it is LM12. The live map ships before it,
 * showing where the fleet is before it can show what each truck is carrying, because the first is
 * useful on its own. A reader that returns an empty map is therefore CORRECT here, not broken — the
 * board renders every truck with `load: null` and says nothing about it.
 *
 * The same shape is what lights up the moment LM12 lands, with no change on the map's side.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Statuses that mean "this load is on a truck now".
 *
 * `draft`, `pending_approval`, `approved` and `offered` are all pre-dispatch — a load a driver has
 * not taken is not what their truck is doing. `delivered` and `canceled` are finished. That leaves
 * the two states in which a load is genuinely riding: accepted (assigned, not yet rolling) and
 * in_transit. Read off `LOAD_STATUSES` in `loadsContract.ts` rather than invented.
 */
export const LIVE_LOAD_STATUSES = ["accepted", "in_transit"] as const;

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
  nextStop: LiveLoadStop | null;
}

const PAGE_CAP = 1000;
/** Stops a stop-lookup will not go past. A load with more than this has a data problem, not a route. */
const STOP_CAP = 1000;

type LoadRow = { id: string; vehicle_id: string | null; ref: string | null; status: string };
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
};

/** Stops already behind the truck. The next stop is the first one that is neither of these. */
const DONE_STOP_STATUSES = new Set(["completed", "skipped"]);

/**
 * The live load for each vehicle that has one, keyed by vehicle id.
 *
 * Org-scoped on both reads — `admin` is the service role and bypasses RLS, so these filters are the
 * only tenant boundary the read has.
 *
 * A vehicle carrying two live loads at once is a dispatch data problem rather than something to
 * represent: the map draws ONE marker per truck and can show one load on it. The newest by `seq`
 * ordering would be arbitrary, so the FIRST row wins deterministically and the rest are ignored —
 * documented here because "why is truck 412 showing the wrong load" needs an answer that is not "it
 * depends".
 */
export async function readLiveLoadContext(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ byVehicleId: Map<string, LiveLoadContext>; truncated: boolean }> {
  const { data: lData, error: lErr } = await admin
    .from("loads")
    .select("id, vehicle_id, ref, status")
    .eq("org_id", orgId)
    .in("status", [...LIVE_LOAD_STATUSES])
    .not("vehicle_id", "is", null)
    .limit(PAGE_CAP);
  if (lErr) throw new Error(lErr.message);
  const loads = (lData ?? []) as unknown as LoadRow[];
  if (loads.length === 0) return { byVehicleId: new Map(), truncated: false };

  const { data: sData, error: sErr } = await admin
    .from("load_stops")
    .select("load_id, seq, kind, name, city, state, appointment_start, appointment_end, status")
    .eq("org_id", orgId)
    .in(
      "load_id",
      loads.map((l) => l.id),
    )
    .order("seq", { ascending: true })
    .limit(STOP_CAP);
  if (sErr) throw new Error(sErr.message);

  const nextByLoad = new Map<string, LiveLoadStop>();
  for (const s of (sData ?? []) as unknown as StopRow[]) {
    if (DONE_STOP_STATUSES.has(s.status ?? "")) continue;
    if (nextByLoad.has(s.load_id)) continue; // ordered by seq, so the first survivor is the next stop
    nextByLoad.set(s.load_id, {
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
      nextStop: nextByLoad.get(l.id) ?? null,
    });
  }
  return { byVehicleId, truncated: loads.length >= PAGE_CAP };
}
