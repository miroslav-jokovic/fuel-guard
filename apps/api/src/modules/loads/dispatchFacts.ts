import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dispatchReachable,
  dispatchSeats,
  dispatchSeatNote,
  type DispatchAcknowledgement,
  type DispatchReach,
  type DispatchSeatNote,
} from "@silvicom/shared";
import { fetchAllPagedIn } from "../../lib/paging.js";
import { lastAppCheckIns } from "../messaging/index.js";

/**
 * What the office knows about each dispatch beyond the row itself (T1 N-9, M-A): who said "Got it",
 * whether anybody's app can show the load now, whether McLeod seats somebody else, and when the
 * dispatched driver's phone last reached us (D-MK22). Split from `dispatchToDriver.ts`, which keeps the
 * Send, so that file stays a writer.
 *
 * Every fact is DERIVED at read time from the tables that hold it — `reachable` and `seatNote` from
 * the load and the driver as they are now (`dispatchReachable`, `dispatchSeatNote` in the shared
 * contract, the same functions the Send preview uses), the acknowledgements from 0661's `acknowledged`
 * events. Nothing here is stored, so nothing here can go stale.
 */

export interface DispatchRowForFacts {
  id: string;
  load_id: string;
  driver_id: string;
}

export interface DispatchFacts {
  acknowledgements: DispatchAcknowledgement[];
  seats: { driverId: string; driverName: string | null }[];
  reachable: DispatchReach;
  seatNote: DispatchSeatNote;
  lastContactAt: string | null;
}

type LoadSeat = { id: string; status: string; external_closed_at: string | null; driver_id: string | null; co_driver_id: string | null };
type DriverLogin = { id: string; full_name: string | null; user_id: string | null; app_access_enabled: boolean | null };
type DriverEvent = { load_id: string; kind: string; occurred_at: string; recorded_at: string; payload: Record<string, unknown> | null };

/**
 * The facts for every dispatch row given, keyed by dispatch id. Four reads for any number of loads —
 * the loads, the drivers named by a dispatch or an acknowledgement, the drivers' events on those
 * loads, and the logins' app check-ins — each in id chunks and pages, org-scoped. A failed read throws:
 * an empty answer would tell the office "nobody has seen it", which is a claim, not a default.
 */
export async function readDispatchFacts(
  admin: SupabaseClient,
  orgId: string,
  rows: readonly DispatchRowForFacts[],
): Promise<Map<string, DispatchFacts>> {
  const out = new Map<string, DispatchFacts>();
  if (rows.length === 0) return out;
  const loadIds = [...new Set(rows.map((r) => r.load_id))];

  const [loads, events] = await Promise.all([
    fetchAllPagedIn<LoadSeat>(loadIds, (chunk) => (from, to) =>
      admin
        .from("loads")
        .select("id, status, external_closed_at, driver_id, co_driver_id")
        .eq("org_id", orgId)
        .in("id", chunk)
        .order("id")
        .range(from, to),
    ),
    // Driver-written events only (0661 stamps `driver_id` on every one): the acknowledgements, and the
    // newest contact per driver per load.
    fetchAllPagedIn<DriverEvent>(loadIds, (chunk) => (from, to) =>
      admin
        .from("load_events")
        .select("load_id, kind, occurred_at, recorded_at, payload")
        .eq("org_id", orgId)
        .eq("actor_role", "driver")
        .in("load_id", chunk)
        .order("id")
        .range(from, to),
    ),
  ]);

  const ackDrivers = events.filter((e) => e.kind === "acknowledged").map((e) => String(e.payload?.driver_id ?? ""));
  const coDrivers = loads.map((l) => l.co_driver_id).filter((c): c is string => typeof c === "string");
  const driverIds = [...new Set([...rows.map((r) => r.driver_id), ...ackDrivers, ...coDrivers].filter(Boolean))];
  const drivers = await fetchAllPagedIn<DriverLogin>(driverIds, (chunk) => (from, to) =>
    admin
      .from("drivers")
      .select("id, full_name, user_id, app_access_enabled")
      .eq("org_id", orgId)
      .in("id", chunk)
      .order("id")
      .range(from, to),
  );
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const loadById = new Map(loads.map((l) => [l.id, l]));
  const checkIns = await lastAppCheckIns(
    admin,
    orgId,
    rows.map((r) => driverById.get(r.driver_id)?.user_id).filter((u): u is string => typeof u === "string"),
  );

  const acksByDispatch = new Map<string, DispatchAcknowledgement[]>();
  const lastEvent = new Map<string, string>(); // `${load}:${driver}` → newest recorded_at
  for (const e of events) {
    const driverId = typeof e.payload?.driver_id === "string" ? e.payload.driver_id : null;
    if (!driverId) continue;
    const key = `${e.load_id}:${driverId}`;
    const prev = lastEvent.get(key);
    if (!prev || Date.parse(e.recorded_at) > Date.parse(prev)) lastEvent.set(key, e.recorded_at);
    const dispatchId = typeof e.payload?.dispatch_id === "string" ? e.payload.dispatch_id : null;
    if (e.kind !== "acknowledged" || !dispatchId) continue;
    const list = acksByDispatch.get(dispatchId) ?? [];
    list.push({ driverId, driverName: driverById.get(driverId)?.full_name ?? null, at: e.occurred_at });
    acksByDispatch.set(dispatchId, list);
  }

  for (const r of rows) {
    const load = loadById.get(r.load_id);
    const driver = driverById.get(r.driver_id) ?? null;
    const contact = [lastEvent.get(`${r.load_id}:${r.driver_id}`), driver?.user_id ? checkIns.get(driver.user_id) : undefined]
      .filter((t): t is string => typeof t === "string")
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    out.set(r.id, {
      acknowledgements: (acksByDispatch.get(r.id) ?? []).sort((a, b) => a.at.localeCompare(b.at)),
      seats: (load ? dispatchSeats(load, r.driver_id) : [r.driver_id]).map((id) => ({
        driverId: id,
        driverName: driverById.get(id)?.full_name ?? null,
      })),
      // A dispatch whose load row is gone reads as closed: nobody can be shown a load that is not there.
      reachable: load ? dispatchReachable(load, driver) : { ok: false, reason: "closed" },
      seatNote: load ? dispatchSeatNote(load, r.driver_id) : null,
      lastContactAt: contact ?? null,
    });
  }
  return out;
}
