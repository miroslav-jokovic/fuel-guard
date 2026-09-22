import type { SupabaseClient } from "@supabase/supabase-js";
import { metersToMiles } from "@silvicom/shared";
import { readVehicleMonthlyMiles } from "../samsara/index.js";
import { monthsBetween } from "./coverage.js";

/**
 * Per-unit maintenance cost (FLEETPAL-INTEGRATION-PLAN.md F9b, §2.1, §2.2, D-FP3, D-FP6).
 *
 * The first per-truck repair cost this product has ever been able to print. It exists because no
 * other source can produce it: `mcleod_gl_totals` is grained org × company × period × post_module
 * × glid with **no equipment dimension at all**, `mcleod_ap_vouchers` names the truck in free text
 * D-FS5 forbids parsing, and `truck_cost_schedules` was deleted by the 2026-09-03 fleet ruling.
 *
 * ── ⚠ AND IT IS AN OPERATIONAL NUMBER, NOT A FINANCIAL ONE (D-FP3) ────────────────────────────
 * Nothing here reaches `financial_entries` or the fleet report. What FleetPal knows is what the
 * shop spent THROUGH FLEETPAL; what the ledger knows is what the company spent on maintenance
 * through every channel, and a roadside call invoiced straight to AP never touches FleetPal. The
 * two disagree, the gap is not an error, and it is why `readUnitCost` refuses to answer at all
 * when the coverage bound cannot be computed for the same window (D-FP4, enforced at the route).
 *
 * ── ⚠ ONE VEHICLE CAN BE SEVERAL FLEETPAL UNITS, AND THE SUM MUST CROSS THEM ──────────────────
 * Measured at F4, 2026-09-21: **eight VINs appear twice** in FleetPal's unit list and eight numbers
 * do too — an old record and its replacement, both live. `fleetpal_units` is unique on
 * `(org_id, fleetpal_id)` and deliberately NOT on `vehicle_id`, so the mapping is one-to-many by
 * design. A read that took the first matching unit would report half the repair spend for eight
 * trucks and nothing anywhere would say so: the figure would simply be low, plausibly, forever.
 * `resolveUnitIds` is the whole defence and the test named for it is what keeps it.
 */

export interface UnitRepair {
  fleetpalId: string;
  workOrderReference: string | null;
  /** VMRS component CODE. The English is licensed TMC material and is never persisted (D-FP8). */
  component: string | null;
  description: string | null;
  source: string | null;
  started: string | null;
  completed: string | null;
  /** ⚠ Every one of these is nullable at the vendor. A dash is printed for a null, never a zero. */
  total: number | null;
  totalParts: number | null;
  totalLabor: number | null;
  totalFees: number | null;
  totalTax: number | null;
  totalServices: number | null;
  totalLaborHours: number | null;
  /** Miles, converted once from the vendor's canonical metres at this single read site (D-FP9). */
  odometerMiles: number | null;
  /** Whole days between `started` and `completed`. Null when either end is missing. */
  downtimeDays: number | null;
}

export interface UnitCostAnswer {
  repairs: UnitRepair[];
  /** The five-way split, summed. A component is null when NO repair in the window reported it. */
  totals: {
    total: number | null;
    parts: number | null;
    labor: number | null;
    fees: number | null;
    tax: number | null;
    services: number | null;
    laborHours: number | null;
  };
  repairCount: number;
  downtimeDays: number;
  /** Miles from the IFTA feed for the same months. Null for a trailer, or when the feed is silent. */
  miles: number | null;
  /** Cost per mile. Null whenever either half is — never a zero standing in for "unknown". */
  costPerMile: number | null;
  /** The FleetPal unit ids this vehicle resolved to. More than one is the duplicate case above. */
  fleetpalUnitIds: string[];
}

/**
 * Every FleetPal unit id mapped to one of our vehicles or trailers.
 *
 * ⚠ Returns an ARRAY, and the array is the point — see the header. Eight of this fleet's trucks
 * map to two FleetPal units each.
 */
export async function resolveUnitIds(
  admin: SupabaseClient,
  orgId: string,
  kind: "tractor" | "trailer",
  equipmentId: string,
): Promise<string[]> {
  const column = kind === "tractor" ? "vehicle_id" : "trailer_id";
  const { data, error } = await admin
    .from("fleetpal_units")
    .select("fleetpal_id")
    .eq("org_id", orgId)
    .eq(column, equipmentId);
  if (error) throw new Error(`fleetpal_units read failed: ${error.message}`);
  return ((data ?? []) as Array<{ fleetpal_id: string }>).map((r) => r.fleetpal_id);
}

/** PostgREST caps every response at 1,000 rows whatever `.limit()` says; the walk is the defence. */
const PAGE = 1000;

export async function readUnitCost(
  admin: SupabaseClient,
  orgId: string,
  kind: "tractor" | "trailer",
  equipmentId: string,
  from: string,
  to: string,
): Promise<UnitCostAnswer> {
  const fleetpalUnitIds = await resolveUnitIds(admin, orgId, kind, equipmentId);
  if (fleetpalUnitIds.length === 0) return empty(fleetpalUnitIds);

  const repairs = await readServiceHistory(admin, orgId, fleetpalUnitIds, from, to);
  const totals = sumSplit(repairs);
  const downtimeDays = repairs.reduce((n, r) => n + (r.downtimeDays ?? 0), 0);

  // Trailers have no IFTA mileage — the feed is per vehicle — so cost per mile is a tractor
  // question and a trailer's answer is null rather than a zero that would read as "free per mile".
  const miles =
    kind === "tractor"
      ? (await readVehicleMonthlyMiles(admin, orgId, monthsBetween(from, to).map(toYearMonth))).get(equipmentId) ?? null
      : null;

  return {
    repairs,
    totals,
    repairCount: repairs.length,
    downtimeDays,
    miles,
    costPerMile: totals.total !== null && miles !== null && miles > 0 ? round4(totals.total / miles) : null,
    fleetpalUnitIds,
  };
}

async function readServiceHistory(
  admin: SupabaseClient,
  orgId: string,
  unitIds: string[],
  from: string,
  to: string,
): Promise<UnitRepair[]> {
  const out: UnitRepair[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await admin
      .from("fleetpal_service_history")
      .select(
        "id, fleetpal_id, work_order_reference, component, description, source, started, completed, " +
          "total, total_parts, total_labor, total_fees, total_tax, total_services, total_labor_hours, odometer",
      )
      .eq("org_id", orgId)
      // ⚠ `.in()` over EVERY mapped unit, never `.eq()` on the first — the duplicate-unit case.
      .in("unit_fleetpal_id", unitIds)
      .gte("completed", from)
      .lt("completed", to)
      .order("completed", { ascending: false })
      .order("id", { ascending: true })
      .range(start, start + PAGE - 1);
    if (error) throw new Error(`fleetpal_service_history read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    for (const r of rows) out.push(toRepair(r));
    if (rows.length < PAGE) break;
  }
  return out;
}

/** `null` stays `null` all the way to the screen (D-FIN10) — `Number(null)` is 0 and is the bug. */
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toRepair(r: Record<string, unknown>): UnitRepair {
  const odometer = num(r.odometer);
  return {
    fleetpalId: String(r.fleetpal_id),
    workOrderReference: (r.work_order_reference as string | null) ?? null,
    component: (r.component as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    started: (r.started as string | null) ?? null,
    completed: (r.completed as string | null) ?? null,
    total: num(r.total),
    totalParts: num(r.total_parts),
    totalLabor: num(r.total_labor),
    totalFees: num(r.total_fees),
    totalTax: num(r.total_tax),
    totalServices: num(r.total_services),
    totalLaborHours: num(r.total_labor_hours),
    // The ONE conversion site (D-FP9): metres are stored as the vendor sends them and a miles
    // column in the database would be a second unit nobody could reconcile.
    odometerMiles: odometer === null ? null : Math.round(metersToMiles(odometer)),
    downtimeDays: downtimeOf(r.started as string | null, r.completed as string | null),
  };
}

/**
 * Whole days a unit was out of service.
 *
 * ⚠ A repair that started and finished the same day is **1**, not 0. The truck was in the shop;
 * zero days out of service is what a repair that never happened costs, and the two must not print
 * the same. Null when either end is missing, because "we do not know" is a third answer.
 */
function downtimeOf(started: string | null, completed: string | null): number | null {
  if (!started || !completed) return null;
  const a = Date.parse(started);
  const b = Date.parse(completed);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.max(1, Math.ceil((b - a) / 86_400_000));
}

/**
 * The five-way split, summed.
 *
 * ⚠ A component stays `null` when NO repair in the window reported it, and becomes a number as
 * soon as one does. The vendor leaves these null routinely — a job with no fees sends
 * `total_fees: null` rather than 0 — so a sum that seeded at 0 would print "$0.00 of fees" for a
 * window in which fees were never recorded at all, which is a claim the data does not make.
 */
function sumSplit(repairs: UnitRepair[]): UnitCostAnswer["totals"] {
  const add = (pick: (r: UnitRepair) => number | null): number | null => {
    let sum: number | null = null;
    for (const r of repairs) {
      const v = pick(r);
      if (v === null) continue;
      sum = (sum ?? 0) + v;
    }
    return sum === null ? null : round2(sum);
  };
  return {
    total: add((r) => r.total),
    parts: add((r) => r.totalParts),
    labor: add((r) => r.totalLabor),
    fees: add((r) => r.totalFees),
    tax: add((r) => r.totalTax),
    services: add((r) => r.totalServices),
    laborHours: add((r) => r.totalLaborHours),
  };
}

const toYearMonth = (m: string) => {
  const [year, month] = m.split("-").map(Number);
  return { year: year!, month: month! };
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

function empty(fleetpalUnitIds: string[]): UnitCostAnswer {
  return {
    repairs: [],
    totals: { total: null, parts: null, labor: null, fees: null, tax: null, services: null, laborHours: null },
    repairCount: 0,
    downtimeDays: 0,
    miles: null,
    costPerMile: null,
    fleetpalUnitIds,
  };
}
