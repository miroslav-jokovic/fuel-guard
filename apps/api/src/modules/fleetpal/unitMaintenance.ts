/**
 * What is due on each truck and trailer, from FleetPal (DISPATCH-BOARD-V2-PLAN D-DBV5): the 6-month
 * inspection and the oil change from the PM schedules, and any open repair order. The annual is NOT
 * here — it is our own record's (Q-DBV2), read by the board from roster.
 *
 * ── WHY IT IS FLEETPAL'S READ ────────────────────────────────────────────────────────────────────
 * `fleetpal_pm_schedules`, `fleetpal_pm_intervals`, `fleetpal_units` and `fleetpal_work_orders` are
 * this module's tables. The board asks through this module's index; the verdicts are the shared
 * `pmWarning` rule, so FleetPal plan F11's `next_pm_due_*` writer — when it is built — reads the same
 * answer rather than a second computation of it.
 *
 * ── SIZE ─────────────────────────────────────────────────────────────────────────────────────────
 * ~1,150 schedules and as many intervals in production (2026-10-16), past PostgREST's 1,000-row cap, so
 * every read pages. Four org-scoped reads, no vendor call: the board reads it once a minute.
 *
 * A schedule may carry several intervals (time AND mileage — "every 6 months or 20,000 mi"); each is
 * judged and the worst counts, which is what "whichever comes first" means.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyPmName, fetchAllPaged, pmDueOn, pmWarning, type MaintenanceWarning, type PmInterval } from "@silvicom/shared";

const OPEN_WORK_ORDER_STATUS = "OPEN";

export type PmUnitRow = { fleetpal_id: string; vehicle_id: string | null; trailer_id: string | null };
export type PmScheduleRow = { fleetpal_id: string; unit_fleetpal_id: string | null; name: string | null; last_done: string | null };
export type PmIntervalRow = {
  pm_schedule_fleetpal_id: string;
  interval_type: string | null;
  value_int: number | string | null;
  value_time_type: string | null;
  threshold_int: number | string | null;
  threshold_time_type: string | null;
  last_done_meter_value: number | string | null;
};

/** `bigint` arrives as a string past 2^53 and as a number below it; either way, a number or null. */
const num = (v: number | string | null): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export interface UnitMaintenance {
  byVehicleId: Map<string, MaintenanceWarning[]>;
  byTrailerId: Map<string, MaintenanceWarning[]>;
}

/**
 * The units, their PM schedules and each schedule's intervals — read once, for both readers below and
 * for `pmDue.ts` (the truck's page and F11's projection), so every PM reader walks the same rows.
 */
export async function readPmSchedules(admin: SupabaseClient, orgId: string) {
  // Each table named as a literal: a dynamic `.from(table)` is invisible to the table-access gates.
  const units = await fetchAllPaged<PmUnitRow>((from, to) =>
    admin.from("fleetpal_units").select("fleetpal_id, vehicle_id, trailer_id").eq("org_id", orgId).order("id").range(from, to),
  );
  const schedules = await fetchAllPaged<PmScheduleRow>((from, to) =>
    admin.from("fleetpal_pm_schedules").select("fleetpal_id, unit_fleetpal_id, name, last_done").eq("org_id", orgId).order("id").range(from, to),
  );
  const intervals = await fetchAllPaged<PmIntervalRow>((from, to) =>
    admin
      .from("fleetpal_pm_intervals")
      .select("pm_schedule_fleetpal_id, interval_type, value_int, value_time_type, threshold_int, threshold_time_type, last_done_meter_value")
      .eq("org_id", orgId)
      .order("id")
      .range(from, to),
  );
  const unitOf = new Map(units.map((u) => [u.fleetpal_id, u]));
  const intervalsOf = new Map<string, PmIntervalRow[]>();
  for (const i of intervals) intervalsOf.set(i.pm_schedule_fleetpal_id, [...(intervalsOf.get(i.pm_schedule_fleetpal_id) ?? []), i]);
  return { unitOf, schedules, intervalsOf };
}

export const toInterval = (i: PmIntervalRow): PmInterval => ({
  intervalType: i.interval_type, value: num(i.value_int), valueUnit: i.value_time_type,
  threshold: num(i.threshold_int), thresholdUnit: i.threshold_time_type, lastDoneMeterMeters: num(i.last_done_meter_value),
});

export async function readUnitMaintenance(
  admin: SupabaseClient,
  orgId: string,
  odometerMilesByVehicleId: ReadonlyMap<string, number | null>,
  now: Date,
): Promise<UnitMaintenance> {
  const { unitOf, schedules, intervalsOf } = await readPmSchedules(admin, orgId);
  const openOrders = await fetchAllPaged<{ unit_fleetpal_id: string | null }>((from, to) =>
    admin
      .from("fleetpal_work_orders")
      .select("unit_fleetpal_id")
      .eq("org_id", orgId)
      .eq("status", OPEN_WORK_ORDER_STATUS)
      .order("id")
      .range(from, to),
  );

  const out: UnitMaintenance = { byVehicleId: new Map(), byTrailerId: new Map() };
  const add = (u: PmUnitRow, w: MaintenanceWarning) => {
    const [map, id] = u.vehicle_id ? [out.byVehicleId, u.vehicle_id] : [out.byTrailerId, u.trailer_id!];
    const list = map.get(id) ?? [];
    // One chip per kind: a unit with two oil schedules (a typo'd duplicate) shows the worse of them once.
    const same = list.findIndex((x) => x.kind === w.kind);
    if (same < 0) list.push(w);
    else if (worse(w, list[same]!)) list[same] = w;
    map.set(id, list);
  };

  for (const s of schedules) {
    const u = s.unit_fleetpal_id ? unitOf.get(s.unit_fleetpal_id) : undefined;
    if (!u || (!u.vehicle_id && !u.trailer_id)) continue;
    const kind = classifyPmName(s.name);
    if (kind !== "six_month" && kind !== "oil") continue;
    const unit = u.vehicle_id ? "truck" : "trailer";
    const odometer = u.vehicle_id ? (odometerMilesByVehicleId.get(u.vehicle_id) ?? null) : null;
    for (const i of intervalsOf.get(s.fleetpal_id) ?? []) {
      const w = pmWarning(kind, unit, toInterval(i), s.last_done, odometer, now);
      if (w) add(u, w);
    }
  }
  for (const o of openOrders) {
    const u = o.unit_fleetpal_id ? unitOf.get(o.unit_fleetpal_id) : undefined;
    if (u && (u.vehicle_id || u.trailer_id)) {
      add(u, { unit: u.vehicle_id ? "truck" : "trailer", kind: "repair_order", verdict: "due", dueOn: null, milesLeft: null });
    }
  }
  return out;
}

/**
 * When FleetPal says each truck's and trailer's annual inspection next falls due (Q-DBV2, second half),
 * `YYYY-MM-DD` by our roster id. Used for one thing only: showing the shop manager where it disagrees
 * with our record (`annualDisagreement`), which is the annual the board reads.
 *
 * Every annual schedule in production is a TIME interval with a last-done date (2026-10-16: 336 of
 * "12 MONTH", 96 of "365 DAY", 4 of "1 YEAR"). A schedule with time AND mileage falls due at the first.
 * A unit with two annual schedules (a typo'd duplicate) takes the LATER: the most recent inspection
 * FleetPal holds; the other is a schedule nobody moved on.
 */
export async function readFleetPalAnnualDue(admin: SupabaseClient, orgId: string): Promise<{ byVehicleId: Map<string, string>; byTrailerId: Map<string, string> }> {
  const { unitOf, schedules, intervalsOf } = await readPmSchedules(admin, orgId);
  const out = { byVehicleId: new Map<string, string>(), byTrailerId: new Map<string, string>() };
  for (const s of schedules) {
    const u = s.unit_fleetpal_id ? unitOf.get(s.unit_fleetpal_id) : undefined;
    if (!u || (!u.vehicle_id && !u.trailer_id) || classifyPmName(s.name) !== "annual") continue;
    const dues = (intervalsOf.get(s.fleetpal_id) ?? []).map((i) => pmDueOn(toInterval(i), s.last_done)).filter((d): d is string => d != null);
    if (!dues.length) continue;
    const first = dues.sort()[0]!;
    const [map, id] = u.vehicle_id ? [out.byVehicleId, u.vehicle_id] : [out.byTrailerId, u.trailer_id!];
    if (!map.has(id) || first > map.get(id)!) map.set(id, first);
  }
  return out;
}

/** Overdue beats due; between two of a verdict, the one due sooner. */
function worse(a: MaintenanceWarning, b: MaintenanceWarning): boolean {
  if (a.verdict !== b.verdict) return a.verdict === "overdue";
  if (a.milesLeft != null && b.milesLeft != null) return a.milesLeft < b.milesLeft;
  return (a.dueOn ?? "9999") < (b.dueOn ?? "9999");
}
