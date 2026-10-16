/**
 * The FleetPal work orders opened on given trucks and trailers in a time window, with their jobs' names —
 * what a roadside inspection's repair record proposes (INSPECTION-CHALLENGE-PLAN IC11, D-IC14).
 *
 * ── WHY IT IS FLEETPAL'S READ ────────────────────────────────────────────────────────────────────
 * `fleetpal_units`, `fleetpal_work_orders` and `fleetpal_jobs` are this module's tables; the inspections
 * module asks through this module's index, as the dispatch board does for `readUnitMaintenance`.
 *
 * ── EVERY UNIT ROW, NOT THE FIRST ────────────────────────────────────────────────────────────────
 * Eight VINs appear twice in FleetPal (F4, 2026-09): one truck may be two `fleetpal_units` rows, each
 * with its own work orders. A unit is matched by every row naming our vehicle or trailer.
 *
 * Cancelled work orders are left out: a cancelled order repaired nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { FLEETPAL_CANCELED_STATUS, fetchAllPaged } from "@silvicom/shared";

/** Ids per `.in()`: a long list overflows Node 22's request-header limit ("fetch failed"). */
const IN_CHUNK = 150;

export interface UnitWorkOrder {
  vehicleId: string | null;
  trailerId: string | null;
  fleetpalId: string;
  reference: string | null;
  status: string | null;
  /** FleetPal's creation time — when the order was opened (ISO). */
  openedAt: string;
  completedAt: string | null;
  description: string | null;
  jobs: string[];
}

export interface UnitWorkOrderIndex {
  /** Our vehicles and trailers that FleetPal has a unit for, matched or not to any work order. */
  vehiclesInFleetpal: Set<string>;
  trailersInFleetpal: Set<string>;
  orders: UnitWorkOrder[];
}

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += IN_CHUNK) out.push(xs.slice(i, i + IN_CHUNK));
  return out;
}

export async function readWorkOrdersOnUnits(
  admin: SupabaseClient,
  orgId: string,
  units: { vehicleIds: readonly string[]; trailerIds: readonly string[] },
  openedFrom: string,
  openedTo: string,
): Promise<UnitWorkOrderIndex> {
  type UnitRow = { fleetpal_id: string; vehicle_id: string | null; trailer_id: string | null };
  const unitRows: UnitRow[] = [];
  for (const ids of chunks([...new Set(units.vehicleIds)])) {
    const r = await admin.from("fleetpal_units").select("fleetpal_id, vehicle_id, trailer_id").eq("org_id", orgId).in("vehicle_id", ids);
    if (r.error) throw new Error(`fleetpal_units: ${r.error.message}`);
    unitRows.push(...((r.data ?? []) as UnitRow[]));
  }
  for (const ids of chunks([...new Set(units.trailerIds)])) {
    const r = await admin.from("fleetpal_units").select("fleetpal_id, vehicle_id, trailer_id").eq("org_id", orgId).in("trailer_id", ids);
    if (r.error) throw new Error(`fleetpal_units: ${r.error.message}`);
    unitRows.push(...((r.data ?? []) as UnitRow[]));
  }
  const unitOf = new Map(unitRows.map((u) => [u.fleetpal_id, u]));
  const out: UnitWorkOrderIndex = {
    vehiclesInFleetpal: new Set(unitRows.flatMap((u) => (u.vehicle_id ? [u.vehicle_id] : []))),
    trailersInFleetpal: new Set(unitRows.flatMap((u) => (u.trailer_id ? [u.trailer_id] : []))),
    orders: [],
  };
  if (unitOf.size === 0) return out;

  type OrderRow = {
    fleetpal_id: string;
    reference_number: string | null;
    status: string | null;
    unit_fleetpal_id: string;
    vendor_created_at: string;
    completed: string | null;
    description: string | null;
  };
  const orders: OrderRow[] = [];
  for (const ids of chunks([...unitOf.keys()])) {
    orders.push(
      ...(await fetchAllPaged<OrderRow>((from, to) =>
        admin
          .from("fleetpal_work_orders")
          .select("fleetpal_id, reference_number, status, unit_fleetpal_id, vendor_created_at, completed, description")
          .eq("org_id", orgId)
          .in("unit_fleetpal_id", ids)
          .gte("vendor_created_at", openedFrom)
          .lt("vendor_created_at", openedTo)
          .neq("status", FLEETPAL_CANCELED_STATUS)
          .order("id")
          .range(from, to),
      )),
    );
  }

  const jobsOf = new Map<string, string[]>();
  for (const ids of chunks(orders.map((o) => o.fleetpal_id))) {
    const jobs = await fetchAllPaged<{ work_order_fleetpal_id: string; name: string | null }>((from, to) =>
      admin.from("fleetpal_jobs").select("work_order_fleetpal_id, name").eq("org_id", orgId).in("work_order_fleetpal_id", ids).order("id").range(from, to),
    );
    for (const j of jobs) if (j.name) jobsOf.set(j.work_order_fleetpal_id, [...(jobsOf.get(j.work_order_fleetpal_id) ?? []), j.name]);
  }

  for (const o of orders) {
    const u = unitOf.get(o.unit_fleetpal_id)!;
    out.orders.push({
      vehicleId: u.vehicle_id,
      trailerId: u.trailer_id,
      fleetpalId: o.fleetpal_id,
      reference: o.reference_number,
      status: o.status,
      openedAt: o.vendor_created_at,
      completedAt: o.completed,
      description: o.description,
      jobs: jobsOf.get(o.fleetpal_id) ?? [],
    });
  }
  return out;
}
