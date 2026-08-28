import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeCpm,
  DEFAULT_CPM_RULES,
  tmsStopFactSchema,
  type CpmReport,
  type CpmRules,
  type TmsMovementFact,
  type TmsFuelPurchaseFact,
  type TmsSettlementFact,
} from "@silvicom/shared";
import { readMovementsWindow, readSettlementsWindow, readApVouchersWindow, readBillingWindow } from "../mcleod/index.js";
import { readVehicleMonthlyMiles } from "../samsara/index.js";
import { readFixedCostsForMonths } from "./costSchedules.js";

/**
 * Cost per mile, per truck, from the STORE — the report this whole pipeline exists to produce
 * (FINANCIAL-STORE-PLAN §5.3). `computeCpm` stays pure and contract-tested in shared; this file
 * only assembles its inputs from what actually landed:
 *
 *  · miles + stops — `mcleod_movements` (0267), via the collector's reader
 *  · fuel — `financial_entries` under the CANONICAL predicate, which is EFS by D-FS2; summed per
 *    vehicle and joined to `vehicles.unit_number` because the harness buckets by tractor unit
 *  · driver pay — `mcleod_settlements`, `total_pay` (what the payee received, D-MC24)
 *  · overhead pool — `mcleod_ap_vouchers` (structurally truckless; spread only when a rule says so)
 *
 * `company_id` on the constructed facts is a type-level placeholder: the staging tables drop it on
 * purpose (org_id is the tenant key here), the contracts require it for the WIRE, and the harness
 * arithmetic never reads it. Filling it with "n/a" is honest as long as this comment survives.
 *
 * The `provenance` block is the maintenance-page doctrine applied to CPM: an empty report must say
 * WHICH source is empty (the sweep that has not run) rather than presenting $0.00/0 miles as a
 * measured fleet.
 */

export interface CpmWindowReport {
  report: CpmReport;
  provenance: {
    window: { from: string; to: string };
    movements: number;
    fuelVehicles: number;
    settlements: number;
    vouchers: number;
    /** Vehicles with Samsara measured miles in the window's months. */
    samsaraVehicles: number;
    /** Units the fixed-cost schedule charged in this window. */
    scheduledUnits: number;
    /** GL-booked invoices joined as revenue (the projection's posting predicate). */
    bookedInvoices: number;
    /** Named empty sources — what to run before believing an empty report. */
    pendingSources: string[];
    notes: string[];
  };
}

const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v));

export async function computeCpmForWindow(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
  rules: Partial<CpmRules> = {},
): Promise<CpmWindowReport> {
  const [staged, settlements, vouchers, billing, fuelByUnit, samsaraMiles, fixedCosts] = await Promise.all([
    readMovementsWindow(admin, orgId, fromIso, toIso),
    readSettlementsWindow(admin, orgId, fromIso, toIso),
    readApVouchersWindow(admin, orgId, fromIso, toIso),
    readBillingWindow(admin, orgId, fromIso, toIso),
    canonicalFuelByUnit(admin, orgId, fromIso, toIso),
    // Samsara publishes vehicle miles per CALENDAR MONTH; the window is treated as the months it
    // covers. The page defaults to a full month, where this is exact; a partial-month window's
    // mismatch is called out in provenance rather than silently prorated.
    readVehicleMonthlyMiles(admin, orgId, monthsCovered(fromIso, toIso)),
    // The office schedule is month-grained too — same month set, whole months charged (T1).
    readFixedCostsForMonths(admin, orgId, monthsCovered(fromIso, toIso)),
  ]);

  const actualMilesByUnit = await milesByVehicleToUnit(admin, orgId, samsaraMiles);

  // Revenue per truck — the other half of the owner's question (what a truck is LEFT WITH per
  // mile). Only GL-BOOKED invoices count, the projection's own predicate; excise tax stays out
  // (collected for the government is not revenue). Unattributed invoices go to their own stated
  // pool, and owner-operator routing happens in the harness where payee types are known.
  const revenueByUnit: Record<string, number> = {};
  let revenueWithoutTruck = 0;
  let bookedInvoices = 0;
  for (const b of billing) {
    if (!b.post_key || b.post_module !== "BILL") continue;
    bookedInvoices++;
    const dollars = num(b.total_charges) + num(b.other_charge);
    const unit = b.tractor_unit?.trim();
    if (!unit) revenueWithoutTruck = Math.round((revenueWithoutTruck + dollars) * 100) / 100;
    else revenueByUnit[unit] = Math.round(((revenueByUnit[unit] ?? 0) + dollars) * 100) / 100;
  }

  const movements: TmsMovementFact[] = staged.map((m) => ({
    external_id: m.external_id,
    company_id: "n/a",
    tractor_unit: m.tractor_unit,
    trailer_unit: m.trailer_unit,
    driver_external_ids: m.driver_external_ids ?? [],
    order_ids: m.order_ids ?? [],
    loaded_miles: m.loaded_miles == null ? null : num(m.loaded_miles),
    fuel_miles: m.fuel_miles == null ? null : num(m.fuel_miles),
    distance_unit: m.distance_unit === "KM" ? "KM" : "MI",
    external_status: null,
    movement_type: null,
    settled_at: m.settled_at,
    // Re-validated on the way out — the exact round-trip the 0267 ingest test pins. A stop that
    // fails the schema here is corrupted staging worth throwing on, not worth skipping quietly.
    stops: tmsStopFactSchema.array().parse(m.stops ?? []),
  }));

  const fuel: TmsFuelPurchaseFact[] = [...fuelByUnit.entries()].map(([unit, dollars]) => ({
    external_id: `fe:${unit}`,
    company_id: "n/a",
    tractor_unit: unit === UNATTRIBUTED ? null : unit,
    driver_external_id: null,
    movement_external_id: null,
    order_external_id: null,
    purchased_at: null,
    state: null,
    truck_stop_name: null,
    truck_stop_city: null,
    card_id: null,
    gallons: { tractor: 0, reefer: 0, def: 0, other: 0 },
    costs: { tractor: 0, reefer: 0, def: 0, oil: 0, misc: 0, sales_tax: 0, transaction_fee: 0 },
    total_amount: dollars,
    fuel_discount: 0,
    settled_amount: dollars,
    post_key: null,
    post_module: null,
  }));

  const settlementFacts: TmsSettlementFact[] = settlements
    .filter((s) => !s.is_void)
    .map((s) => ({
      external_id: s.external_id,
      company_id: "n/a",
      tractor_unit: s.tractor_unit,
      trailer_unit: null,
      driver_external_id: s.driver_external_id,
      movement_external_id: null,
      order_external_id: null,
      payee_id: null,
      payee_type: (s.payee_type as TmsSettlementFact["payee_type"]) ?? "other",
      pay_method: null,
      accrued_at: s.accrued_at,
      paid_at: s.paid_at,
      transferred_at: null,
      total_pay: num(s.total_pay),
      posted_pay: num(s.posted_pay),
      pay_distance: null,
      accrual_key: s.accrual_key,
      post_key: null,
    }));

  const report = computeCpm(
    {
      movements,
      fuel,
      settlements: settlementFacts,
      vouchers: vouchers.map((v) => ({
        external_id: v.external_id,
        company_id: "n/a",
        voucher_no: null,
        voucher_type: null,
        vendor_id: v.vendor_id,
        invoice_number: null,
        purchase_order_no: null,
        description: null,
        invoice_date: v.invoice_date,
        due_date: null,
        distribution_date: v.distribution_date,
        amount: num(v.amount),
        discount_amount: 0,
        ap_glid: v.ap_glid,
        is_paid: v.is_paid,
        check_number: v.check_number,
        post_key: v.post_key,
        post_module: v.post_module,
      })),
      officeLines: [],
      actualMilesByUnit,
      fixedCosts,
      revenueByUnit,
      revenueWithoutTruck,
    },
    { ...DEFAULT_CPM_RULES, ...rules },
  );

  const pendingSources: string[] = [];
  if (!staged.length)
    pendingSources.push("mcleod_movements is empty for this window — the agent's --financial sweep supplies it");
  if (!fuelByUnit.size)
    pendingSources.push("no canonical fuel entries in this window — the financial projection over EFS supplies them");
  if (!settlements.length)
    pendingSources.push("mcleod_settlements is empty for this window — the agent's --financial sweep supplies it");
  if (!samsaraMiles.size)
    pendingSources.push(
      "no Samsara miles for this window's months — the IFTA mileage sync supplies them; until it runs, miles fall back to McLeod loaded + estimated deadhead and the report says so",
    );

  const notes: string[] = [];
  if (samsaraMiles.size && !isMonthAligned(fromIso, toIso)) {
    notes.push(
      "Samsara miles are month-grained and this window is not month-aligned — measured miles cover the window's calendar months, not the exact dates.",
    );
  }

  return {
    report,
    provenance: {
      window: { from: fromIso, to: toIso },
      movements: staged.length,
      fuelVehicles: fuelByUnit.size,
      settlements: settlements.length,
      vouchers: vouchers.length,
      samsaraVehicles: samsaraMiles.size,
      scheduledUnits: Object.keys(fixedCosts.byUnit).length,
      bookedInvoices,
      pendingSources,
      notes,
    },
  };
}

/** Every calendar month the half-open [from, to) window touches. */
function monthsCovered(fromIso: string, toIso: string): Array<{ year: number; month: number }> {
  const months: Array<{ year: number; month: number }> = [];
  let [y, m] = fromIso.slice(0, 10).split("-").map(Number) as [number, number, number];
  for (;;) {
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    if (first >= toIso) break;
    months.push({ year: y!, month: m! });
    if (m === 12) {
      y! += 1;
      m = 1;
    } else {
      m! += 1;
    }
  }
  return months;
}

function isMonthAligned(fromIso: string, toIso: string): boolean {
  return fromIso.slice(8, 10) === "01" && toIso.slice(8, 10) === "01";
}

/** Re-key Samsara's per-vehicle miles by tractor unit — the harness's bucket key. */
async function milesByVehicleToUnit(
  admin: SupabaseClient,
  orgId: string,
  byVehicle: Map<string, number>,
): Promise<Record<string, number>> {
  if (!byVehicle.size) return {};
  const { data, error } = await admin
    .from("vehicles")
    .select("id, unit_number")
    .eq("org_id", orgId)
    .in("id", [...byVehicle.keys()]);
  if (error) throw new Error(`vehicles read failed: ${error.message}`);
  const out: Record<string, number> = {};
  for (const v of (data ?? []) as Array<{ id: string; unit_number: string | null }>) {
    const unit = v.unit_number?.trim();
    if (!unit) continue;
    out[unit] = Math.round(((out[unit] ?? 0) + (byVehicle.get(v.id) ?? 0)) * 10) / 10;
  }
  return out;
}

const UNATTRIBUTED = "∅";
const PAGE = 1000;

/**
 * Canonical fuel dollars per tractor UNIT. Reads this module's own `financial_entries` under the
 * canonical predicate (D-FS1/D-FS2 — EFS wins, the McLeod copy is non-canonical), then joins
 * `vehicles.unit_number` because staging attributes by unit while the store attributes by vehicle
 * id. Entries with no vehicle stay in the report's excluded bucket, never spread (D-FS5).
 */
async function canonicalFuelByUnit(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<Map<string, number>> {
  const byVehicle = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("financial_entries")
      .select("vehicle_id, amount")
      .eq("org_id", orgId)
      .eq("direction", "expense")
      .eq("category", "fuel")
      .eq("is_canonical", true)
      .eq("is_void", false)
      .gte("occurred_at", fromIso)
      .lt("occurred_at", toIso)
      // UNORDERED paging is not paging at all — Postgres owes no stable row order across two
      // queries, so pages can overlap or skip. Order by the primary key (the financialReads lesson).
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`financial_entries fuel read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ vehicle_id: string | null; amount: number | string }>;
    for (const r of rows) {
      const key = r.vehicle_id ?? UNATTRIBUTED;
      byVehicle.set(key, (byVehicle.get(key) ?? 0) + num(r.amount));
    }
    if (rows.length < PAGE) break;
  }
  if (!byVehicle.size) return new Map();

  const vehicleIds = [...byVehicle.keys()].filter((k) => k !== UNATTRIBUTED);
  const unitById = new Map<string, string>();
  if (vehicleIds.length) {
    const { data, error } = await admin
      .from("vehicles")
      .select("id, unit_number")
      .eq("org_id", orgId)
      .in("id", vehicleIds);
    if (error) throw new Error(`vehicles read failed: ${error.message}`);
    for (const v of (data ?? []) as Array<{ id: string; unit_number: string | null }>) {
      if (v.unit_number) unitById.set(v.id, v.unit_number.trim());
    }
  }

  const byUnit = new Map<string, number>();
  for (const [vehicleId, dollars] of byVehicle) {
    const unit = vehicleId === UNATTRIBUTED ? UNATTRIBUTED : (unitById.get(vehicleId) ?? UNATTRIBUTED);
    byUnit.set(unit, Math.round(((byUnit.get(unit) ?? 0) + dollars) * 100) / 100);
  }
  return byUnit;
}
