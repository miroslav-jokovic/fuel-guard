import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACTIVITY_LOOKBACK_DAYS,
  IN_SERVICE_VEHICLE_STATUSES,
  loadDeliveredAt,
  summarizeActivity,
  type ActivityLoad,
  type ActivityStop,
  type LoadActivityResponse,
} from "@silvicom/shared";
import { chunks, fetchAllPaged } from "../../../lib/paging.js";
import { deliveredCandidateIds, inWindow } from "./deliveredWindow.js";

/**
 * Who has gone how long without a load (LOADS-ACTIVITY-PLAN D-LA7). Per active driver and per truck,
 * over the open loads and the last `ACTIVITY_LOOKBACK_DAYS` of deliveries. Every verdict is
 * `summarizeActivity`'s, against one clock, so the page decides nothing. The page lists the trucks the
 * Dispatch board lists (its census, not a second one), and these rows give each of them its figures.
 *
 * The window's END runs past now on purpose. A delivery keyed ahead in McLeod (D-LA4) is dated in the
 * future, and a window ending at now would drop exactly the load that shows the driver is busy.
 */

const LOAD_COLUMNS = "id, ref, status, source, loaded, driver_id, co_driver_id, vehicle_id, dispatcher_external_id";
const KEYED_AHEAD_MARGIN_DAYS = 30;
const DAY_MS = 86_400_000;

type LoadRow = Omit<ActivityLoad, "stops">;

export async function listLoadActivity(admin: SupabaseClient, orgId: string, now: Date): Promise<LoadActivityResponse> {
  const windowFrom = new Date(now.getTime() - ACTIVITY_LOOKBACK_DAYS * DAY_MS).toISOString();
  const windowBefore = new Date(now.getTime() + KEYED_AHEAD_MARGIN_DAYS * DAY_MS).toISOString();
  const base = () => admin.from("loads").select(LOAD_COLUMNS).eq("org_id", orgId);

  const [open, candidates, drivers, vehicles] = await Promise.all([
    fetchAllPaged<LoadRow>((from, to) =>
      base().not("status", "in", "(delivered,canceled)").order("id").range(from, to)
        .then(({ data, error }) => ({ data: data as unknown as LoadRow[] | null, error })),
    ),
    deliveredCandidateIds(admin, orgId, windowFrom, windowBefore),
    fetchAllPaged<{ id: string; full_name: string | null; current_hos_status: string | null }>((from, to) =>
      admin.from("drivers").select("id, full_name, current_hos_status").eq("org_id", orgId).eq("status", "active").order("id").range(from, to)
        .then(({ data, error }) => ({ data: data as { id: string; full_name: string | null; current_hos_status: string | null }[] | null, error })),
    ),
    fetchAllPaged<{ id: string; unit_number: string | null }>((from, to) =>
      admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).in("status", [...IN_SERVICE_VEHICLE_STATUSES]).order("id").range(from, to)
        .then(({ data, error }) => ({ data: data as { id: string; unit_number: string | null }[] | null, error })),
    ),
  ]);

  const delivered: LoadRow[] = [];
  for (const ids of chunks(candidates)) {
    const { data, error } = await base().eq("status", "delivered").in("id", ids);
    if (error) throw new Error(error.message);
    delivered.push(...((data ?? []) as unknown as LoadRow[]));
  }

  const rows = [...open, ...delivered];
  const stopsBy = new Map<string, ActivityStop[]>();
  for (const ids of chunks(rows.map((r) => r.id))) {
    const { data, error } = await admin
      .from("load_stops")
      .select("load_id, seq, kind, actual_departure_at, completed_at")
      .eq("org_id", orgId)
      .in("load_id", ids);
    if (error) throw new Error(error.message);
    for (const s of (data ?? []) as (ActivityStop & { load_id: string })[]) {
      const list = stopsBy.get(s.load_id) ?? [];
      list.push(s);
      stopsBy.set(s.load_id, list);
    }
  }
  // Exactly the deliveries inside the window: a candidate whose LAST drop left outside it goes (D-LA1).
  const loads: ActivityLoad[] = rows
    .map((r) => ({ ...r, stops: stopsBy.get(r.id) ?? [] }))
    .filter((l) => l.status !== "delivered" || inWindow(loadDeliveredAt(l.stops), windowFrom, windowBefore));

  const nowMs = now.getTime();
  const byDriver = summarizeActivity(loads, drivers.map((d) => d.id), (l) => [l.driver_id, l.co_driver_id], nowMs);
  const byTruck = summarizeActivity(loads, vehicles.map((v) => v.id), (l) => [l.vehicle_id], nowMs);
  // The earliest delivery the read holds: the honest start of "none since …" while the mirror is
  // younger than the window (it began 09/17/2026).
  let historyFrom: string | null = null;
  for (const l of loads) {
    const at = l.status === "delivered" ? loadDeliveredAt(l.stops) : null;
    if (at && (!historyFrom || at < historyFrom)) historyFrom = at;
  }

  return {
    asOf: now.toISOString(),
    windowFrom,
    historyFrom,
    drivers: drivers.map((d) => ({ ...byDriver.get(d.id)!, name: d.full_name, hosStatus: d.current_hos_status })),
    trucks: vehicles.map((v) => ({ ...byTruck.get(v.id)!, unit: v.unit_number })),
  };
}
