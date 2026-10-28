/**
 * What FleetPal holds on ONE truck or trailer — the shop's file for the truck's page
 * (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.3, D-MX3; FLEETPAL-INTEGRATION-PLAN.md F10).
 *
 * This is the repair RECORD (D-INV10): which orders are open, which defects nobody has fixed, what
 * was done before and how long the unit was out. It is deliberately NOT the bill — the cost split is
 * F9b's `/units/:kind/:id/maintenance`, which refuses to answer without the ledger's coverage bound
 * (D-FP4), and a history that vanished for want of a GL figure would say "never repaired".
 *
 * ⚠ Every read here goes `.in()` over EVERY FleetPal unit the roster row resolves to — eight of this
 * fleet's VINs are two FleetPal units each (`unitCost.ts`), and a read that took the first would show
 * half a truck's repairs and nothing would say so.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyPmName, fetchAllPaged, metersToMiles, type ShopDefectDto, type ShopWorkOrderDto, type UnitShopFileDto, type UnitWorkOrderHistoryDto } from "@silvicom/shared";
import { downtimeOf, resolveUnitIds } from "./unitCost.js";
import { OPEN_WORK_ORDER_STATUS } from "./shopBacklog.js";
import { judgeSchedule } from "./pmDue.js";
import type { PmIntervalRow, PmScheduleRow } from "./unitMaintenance.js";

/** FleetPal's own word for a cancelled order; it is neither open nor history. */
const CANCELED = "CANCELED";
/** How much history the page shows: a truck's last two years of orders fit comfortably; the rest is FleetPal's. */
const HISTORY_CAP = 40;

type OrderRow = {
  id: string;
  fleetpal_id: string;
  reference_number: string | null;
  status: string | null;
  priority: string | null;
  description: string | null;
  started: string | null;
  completed: string | null;
  vendor_created_at: string | null;
};
type DefectRow = { id: string; name: string | null; description: string | null; driver_comment: string | null; detected_on: string | null };

export type UnitShopRecord = Pick<UnitShopFileDto, "fleetpal" | "openWorkOrders" | "openDefects" | "history" | "pm">;

export async function readUnitShopRecord(
  admin: SupabaseClient,
  orgId: string,
  kind: "tractor" | "trailer",
  equipmentId: string,
  odometerMiles: number | null,
  now: Date,
): Promise<UnitShopRecord> {
  const unitIds = await resolveUnitIds(admin, orgId, kind, equipmentId);
  const pm = { odometerMiles, odometerSource: odometerMiles === null ? null : ("roster" as const), schedules: [] };
  if (unitIds.length === 0) {
    return { fleetpal: { unitIds, number: null, lastMeter: null }, openWorkOrders: [], openDefects: [], history: [], pm };
  }

  const [units, orders, defects, schedules, meter] = await Promise.all([
    admin.from("fleetpal_units").select("fleetpal_id, number").eq("org_id", orgId).in("fleetpal_id", unitIds),
    admin
      .from("fleetpal_work_orders")
      .select("id, fleetpal_id, reference_number, status, priority, description, started, completed, vendor_created_at")
      .eq("org_id", orgId)
      .in("unit_fleetpal_id", unitIds)
      .neq("status", CANCELED)
      .order("vendor_created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(HISTORY_CAP),
    admin
      .from("fleetpal_defects")
      .select("id, name, description, driver_comment, detected_on")
      .eq("org_id", orgId)
      .in("unit_fleetpal_id", unitIds)
      .eq("is_resolved", false)
      .order("detected_on", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
    fetchAllPaged<PmScheduleRow>((from, to) =>
      admin.from("fleetpal_pm_schedules").select("fleetpal_id, unit_fleetpal_id, name, last_done").eq("org_id", orgId).in("unit_fleetpal_id", unitIds).order("id").range(from, to),
    ),
    admin
      .from("fleetpal_meters")
      .select("value, measured_at")
      .eq("org_id", orgId)
      .in("unit_fleetpal_id", unitIds)
      .eq("meter_type", "ODOMETER")
      .not("measured_at", "is", null)
      .order("measured_at", { ascending: false })
      .limit(1),
  ]);
  for (const r of [units, orders, defects, meter]) if (r.error) throw new Error(`fleetpal read failed: ${r.error.message}`);

  const intervals = schedules.length
    ? await fetchAllPaged<PmIntervalRow>((from, to) =>
        admin
          .from("fleetpal_pm_intervals")
          .select("pm_schedule_fleetpal_id, interval_type, value_int, value_time_type, threshold_int, threshold_time_type, last_done_meter_value")
          .eq("org_id", orgId)
          .in("pm_schedule_fleetpal_id", schedules.map((s) => s.fleetpal_id))
          .order("id")
          .range(from, to),
      )
    : [];
  const intervalsOf = new Map<string, PmIntervalRow[]>();
  for (const i of intervals) intervalsOf.set(i.pm_schedule_fleetpal_id, [...(intervalsOf.get(i.pm_schedule_fleetpal_id) ?? []), i]);

  const number = ((units.data ?? []) as { fleetpal_id: string; number: string | null }[]).find((u) => u.number)?.number ?? null;
  const allOrders = (orders.data ?? []) as OrderRow[];
  // Jobs by name, for the history rows — the same read `unitWorkOrders.ts` makes for a roadside repair.
  const jobsOf = new Map<string, string[]>();
  if (allOrders.length) {
    const jobs = await fetchAllPaged<{ work_order_fleetpal_id: string; name: string | null }>((from, to) =>
      admin.from("fleetpal_jobs").select("work_order_fleetpal_id, name").eq("org_id", orgId).in("work_order_fleetpal_id", allOrders.map((o) => o.fleetpal_id)).order("id").range(from, to),
    );
    for (const j of jobs) if (j.name) jobsOf.set(j.work_order_fleetpal_id, [...(jobsOf.get(j.work_order_fleetpal_id) ?? []), j.name]);
  }
  const ours = kind === "tractor" ? { vehicleId: equipmentId, trailerId: null } : { vehicleId: null, trailerId: equipmentId };
  const openWorkOrders: ShopWorkOrderDto[] = allOrders
    .filter((o) => o.status === OPEN_WORK_ORDER_STATUS)
    .map((o) => ({ id: o.id, referenceNumber: o.reference_number, unitNumber: number, ...ours, description: o.description, priority: o.priority, openedAt: o.vendor_created_at }));
  const history: UnitWorkOrderHistoryDto[] = allOrders
    .filter((o) => o.status !== OPEN_WORK_ORDER_STATUS)
    .map((o) => ({
      id: o.id,
      referenceNumber: o.reference_number,
      status: o.status,
      description: o.description,
      jobs: jobsOf.get(o.fleetpal_id) ?? [],
      openedAt: o.vendor_created_at,
      completedAt: o.completed,
      downtimeDays: downtimeOf(o.started, o.completed),
    }));
  const openDefects: ShopDefectDto[] = ((defects.data ?? []) as DefectRow[]).map((d) => ({
    id: d.id, unitNumber: number, ...ours, name: d.name, description: d.description, driverComment: d.driver_comment, detectedAt: d.detected_on,
  }));
  const m = ((meter.data ?? []) as { value: number | string | null; measured_at: string }[])[0];
  const lastMeter = m && m.value != null && Number.isFinite(Number(m.value)) ? { miles: Math.round(metersToMiles(Number(m.value))), measuredAt: m.measured_at } : null;

  return {
    fleetpal: { unitIds, number, lastMeter },
    openWorkOrders,
    openDefects,
    history,
    // The annual is our record's, not FleetPal's (Q-DBV2): the page's Annual section reads it from the roster.
    pm: { ...pm, schedules: schedules.filter((s) => classifyPmName(s.name) !== "annual").map((s) => judgeSchedule(s, intervalsOf.get(s.fleetpal_id) ?? [], odometerMiles, now)) },
  };
}
