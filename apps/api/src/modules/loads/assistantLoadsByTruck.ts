import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assistantUnitKey,
  dayRangeInstants,
  loadBoardState,
  organizationTimezone,
  resolveAssistantRange,
  todayInZone,
  type AssistantRangeInput,
  type LoadStatus,
} from "@silvicom/shared";
import { listLoads } from "./dispatchLoads/queries.js";
import { loadsHistoryFrom } from "./dispatchLoads/deliveredWindow.js";

/**
 * The assistant's `loads_by_truck` tool (F21 R6b, 2026-11-10): the Loads page's Delivered tab, asked
 * per truck in words ("how many loads did 748 deliver last month", "loads per truck this quarter").
 *
 * ── WHY IT CALLS `listLoads` AND NOTHING ELSE ───────────────────────────────────────────────────
 * `GET /api/dispatch/loads` is `listLoads` with a window of DELIVERY time (D-LA6): the carrier's
 * midnights of the first and the day after the last day (`dayRangeInstants`, the Loads page's
 * `useDeliveredWindow`), a load kept only when its LAST delivery left inside it. The Delivered tab is
 * the rows `loadBoardState` puts in the `delivered` queue, and the Truck filter's count is how many of
 * those rows carry that truck (`truckOptions`). This file asks the same read with the same instants,
 * keeps the same queue and counts rows per truck, so "748 delivered 14" is what the page shows with
 * Delivered, those days and truck 748 picked. It never reads `loads` itself.
 *
 * ── WHICH MILES (handoff R6b, memory `samsara-distance-is-an-odometer-difference`) ────────────────
 * The miles here are McLeod's: each load's `total_miles` (the projection's `move_distance`), the figure
 * the load's own page prints beside its stops, added up over the truck's delivered loads. They are
 * DISPATCHED miles for the moves, not what the truck drove: measured miles (Samsara's odometer
 * difference) are the Fuel Costs report's (`fuel_report`), and billed miles the Fleet report's
 * (`finance_report`). The answer says so, and counts the loads that carry no miles rather than
 * reading them as zero.
 *
 * An empty move (`loaded = false`, D-LA5) stays a row on the Delivered tab, so it stays in the count
 * and is ALSO counted on its own; nothing is subtracted.
 *
 * Gated as its page is: `dispatch` bought, then `dispatch: view` (`assistantContract.ts`).
 *
 * ORG-SCOPED: `listLoads`, `loadsHistoryFrom` and the two lookups here all filter `org_id`.
 */

export const LOADS_SOURCE = "Loads page (/dispatch/loads), Delivered tab, filtered by truck";
/** Trucks listed per answer without named units. A fleet is ~200; totals are always whole. */
export const MAX_LOADS_TRUCKS = 25;
/** Named units per answer, as the Fuel Costs tool. */
export const MAX_LOADS_UNITS = 25;

export interface AssistantLoadsInput extends AssistantRangeInput {
  units?: unknown;
  limit?: unknown;
}

/** The fields of a `listLoads` row this tool reads. */
interface LoadRow {
  status: LoadStatus;
  source: string;
  external_status?: string | null;
  driver_id?: string | null;
  vehicle_id?: string | null;
  vehicle_unit?: string | null;
  total_miles?: number | string | null;
  loaded?: boolean | null;
  external_synced_at?: string | null;
}

interface TruckTally {
  unit: string;
  delivered_loads: number;
  empty_moves: number;
  mcleod_miles: number;
  loads_without_miles: number;
}

const milesOf = (l: LoadRow): number | null => {
  if (l.total_miles == null || l.total_miles === "") return null;
  const n = Number(l.total_miles);
  return Number.isFinite(n) ? n : null;
};

export async function assistantLoadsByTruck(
  admin: SupabaseClient,
  orgId: string,
  input: AssistantLoadsInput,
  now: Date = new Date(),
): Promise<unknown> {
  const asked = [...new Set((Array.isArray(input.units) ? input.units : []).map((u) => String(u)).filter((u) => assistantUnitKey(u) !== ""))];
  if (asked.length > MAX_LOADS_UNITS) return { error: `At most ${MAX_LOADS_UNITS} units per answer; ${asked.length} were named. Split the list.` };

  const { data: org } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  const timezone = organizationTimezone((org as { operating_hours?: object | null } | null)?.operating_hours);
  const range = resolveAssistantRange(input, todayInZone(now, timezone));
  if (!range.ok) return { error: range.error };

  // The page's own instants: the carrier's midnight of `from`, and of the day after `to` (exclusive).
  const instants = dayRangeInstants(range.from, range.to, timezone);
  const [rows, historyFrom] = await Promise.all([
    listLoads(admin, orgId, { from: instants.start, before: instants.endExclusive }) as Promise<LoadRow[]>,
    loadsHistoryFrom(admin, orgId),
  ]);
  const delivered = rows.filter((l) => loadBoardState(l).queue === "delivered");

  const byTruck = new Map<string, TruckTally>();
  let noTruck = 0;
  for (const l of delivered) {
    if (!l.vehicle_id) {
      noTruck += 1;
      continue;
    }
    const t = byTruck.get(l.vehicle_id) ?? { unit: l.vehicle_unit ?? "Unknown unit", delivered_loads: 0, empty_moves: 0, mcleod_miles: 0, loads_without_miles: 0 };
    t.delivered_loads += 1;
    if (l.loaded === false) t.empty_moves += 1;
    const miles = milesOf(l);
    if (miles == null) t.loads_without_miles += 1;
    else t.mcleod_miles += miles;
    byTruck.set(l.vehicle_id, t);
  }
  const round = (t: TruckTally): TruckTally => ({ ...t, mcleod_miles: Math.round(t.mcleod_miles) });

  // McLeod's freshness, as the page words it: the newest sync stamp on the rows it read.
  let syncedAt: string | null = null;
  for (const l of rows) if (l.external_synced_at && (!syncedAt || l.external_synced_at > syncedAt)) syncedAt = l.external_synced_at;

  const result: Record<string, unknown> = {
    source: LOADS_SOURCE,
    timezone,
    period: range.label,
    from: range.from,
    to: range.to,
    counted_by: "delivery time: when the truck left the load's last delivery stop",
    delivered_loads: delivered.length,
    delivered_loads_without_a_truck: noTruck,
    trucks_with_deliveries: byTruck.size,
    miles_are:
      "McLeod's dispatched miles for each delivered load (the miles on the load's page), added up per truck. " +
      "Not measured miles: those are the Fuel Costs report's (fuel_report). Billed miles are the Fleet report's (finance_report).",
    mcleod_synced_at: syncedAt,
    delivery_history_begins: historyFrom,
  };
  // A window that starts before the mirror holds anything is not an empty fleet: say where it begins.
  if (historyFrom && range.from < historyFrom.slice(0, 10)) {
    result.history_note = `The days before ${historyFrom.slice(0, 10)} hold no loads in Silvicom; counts cover only the days after it.`;
  }

  if (asked.length > 0) {
    // Named units: a truck of this fleet with no delivery in the window is a real 0; a unit that is not
    // this fleet's is named back, never answered as 0.
    const { data: vehicles, error } = await admin.from("vehicles").select("id, unit_number").eq("org_id", orgId);
    if (error) throw new Error(error.message);
    const idOf = new Map<string, { id: string; unit: string }>();
    for (const v of (vehicles ?? []) as { id: string; unit_number: string | null }[]) {
      if (v.unit_number) idOf.set(assistantUnitKey(v.unit_number), { id: v.id, unit: v.unit_number });
    }
    const found = asked.map((u) => idOf.get(assistantUnitKey(u))).filter((v): v is { id: string; unit: string } => v != null);
    const notFound = asked.filter((u) => !idOf.has(assistantUnitKey(u)));
    if (found.length === 0) return { error: "None of the named units are in this fleet.", not_found: notFound };
    result.trucks = found.map((v) =>
      round(byTruck.get(v.id) ?? { unit: v.unit, delivered_loads: 0, empty_moves: 0, mcleod_miles: 0, loads_without_miles: 0 }),
    );
    if (notFound.length > 0) result.not_found = notFound;
    return result;
  }

  const limit = Math.min(Math.max(Math.trunc(Number(input.limit)) || MAX_LOADS_TRUCKS, 1), MAX_LOADS_TRUCKS);
  const ranked = [...byTruck.values()].sort(
    (a, b) => b.delivered_loads - a.delivered_loads || a.unit.localeCompare(b.unit, undefined, { numeric: true }),
  );
  result.trucks = ranked.slice(0, limit).map(round);
  if (ranked.length > limit) result.trucks_note = `${limit} of ${ranked.length} trucks listed, the most delivered loads first.`;
  return result;
}
