import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { computeCpmForWindow } from "./cpm.js";

const ORG = "11111111-1111-1111-1111-111111111111";

const stop = (seq: number, kind: string, lat: number, lon: number, departed: string) => ({
  seq,
  kind,
  city: null,
  state: null,
  lat,
  lon,
  arrived_at: departed,
  departed_at: departed,
});

// Two settled trips for truck 754: Chicago→Atlanta, then Chattanooga→Nashville. The gap between
// Atlanta's dropoff and Chattanooga's pickup is the deadhead the harness must infer — McLeod
// records no empty miles anywhere (D-MC16).
const MOVEMENTS = [
  {
    external_id: "M-1",
    tractor_unit: "754",
    trailer_unit: null,
    driver_external_ids: ["D42"],
    order_ids: [],
    loaded_miles: 800,
    fuel_miles: 803,
    distance_unit: "MI",
    settled_at: "2026-06-16T00:00:00Z",
    stops: [stop(1, "pickup", 41.88, -87.63, "2026-06-14T09:00:00Z"), stop(2, "dropoff", 33.75, -84.39, "2026-06-15T18:00:00Z")],
  },
  {
    external_id: "M-2",
    tractor_unit: "754",
    trailer_unit: null,
    driver_external_ids: ["D42"],
    order_ids: [],
    loaded_miles: 500,
    fuel_miles: 501,
    distance_unit: "MI",
    settled_at: "2026-06-20T00:00:00Z",
    stops: [stop(1, "pickup", 35.05, -85.31, "2026-06-17T08:00:00Z"), stop(2, "dropoff", 36.16, -86.78, "2026-06-17T20:00:00Z")],
  },
];

describe("computeCpmForWindow", () => {
  it("divides staged cost by Samsara measured miles per truck and carries the harness caveats", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        mcleod_movements: MOVEMENTS,
        mcleod_settlements: [
          { external_id: "S-1", tractor_unit: "754", driver_external_id: "D42", payee_type: "company_driver", accrued_at: "2026-06-16T00:00:00Z", paid_at: null, total_pay: 600, posted_pay: 600, is_void: false, accrual_key: "AK-1" },
          // Owner-operator: excluded from the average by default, pooled separately (D-MC20).
          { external_id: "S-2", tractor_unit: "801", driver_external_id: "D9", payee_type: "owner_operator", accrued_at: "2026-06-18T00:00:00Z", paid_at: null, total_pay: 2900, posted_pay: 2900, is_void: false, accrual_key: "AK-2" },
        ],
        mcleod_ap_vouchers: [
          { external_id: "V-1", vendor_id: "INSCO", invoice_date: "2026-06-10T00:00:00Z", distribution_date: "2026-06-10T00:00:00Z", amount: 5000, ap_glid: "70300000", is_paid: true, check_number: null, post_key: "PK", post_module: "AP" },
          // The fuel vendor's invoice is the SAME money EFS already put on the truck (D-FS2) —
          // it must never inflate the overhead pool (it did, by ~$1M/month, until 2026-08-28).
          { external_id: "V-2", vendor_id: "PILOKNTN", invoice_date: "2026-06-15T00:00:00Z", distribution_date: "2026-06-15T00:00:00Z", amount: 999999, ap_glid: "20550000", is_paid: true, check_number: null, post_key: "PK2", post_module: "AP" },
        ],
        mcleod_gl_accounts: [
          { glid: "30000001", descr: "Gross Trucking Income", type_id: "Revenue" },
          { glid: "40050000", descr: "Fuel for Hired Vehicles", type_id: "Operating Expenses" },
          { glid: "11000000", descr: "BMO Harris Bank", type_id: "Current Assets" },
        ],
        mcleod_gl_totals: [
          { post_module: "BILL", glid: "30000001", line_count: 10, net_amount: -10000, abs_amount: 10000 },
          { post_module: "AP", glid: "40050000", line_count: 5, net_amount: 4000, abs_amount: 4000 },
          // Balance-sheet motion — a loan draw is not income and must not leak into the check.
          { post_module: "CHK", glid: "11000000", line_count: 2, net_amount: 700, abs_amount: 700 },
        ],
        financial_entries: [
          { vehicle_id: "v1", amount: 600 },
          { vehicle_id: "v1", amount: 400 },
        ],
        vehicles: [{ id: "v1", unit_number: "754 " }],
        // Samsara's measured June: 1,400 mi for the truck (meters at source; owner ruling makes
        // this THE denominator — loaded 1,300 stays as reference, deadhead is not inferred).
        samsara_ifta_jurisdiction_miles: [
          { vehicle_id: "v1", total_meters: 1400 * 1609.344 },
        ],
        // Booked revenue: two GL-posted invoices for 754 and one unposted (never joined).
        mcleod_billing: [
          { id: "b1", external_id: "INV-1", order_external_id: null, tractor_unit: "754", driver_external_id: "D42", bill_date: "2026-06-10T00:00:00Z", transfer_date: null, total_charges: 2500, other_charge: 100, excise_tax: 0, post_key: "PK1", post_module: "BILL" },
          { id: "b2", external_id: "INV-2", order_external_id: null, tractor_unit: "754", driver_external_id: "D42", bill_date: "2026-06-20T00:00:00Z", transfer_date: null, total_charges: 1400, other_charge: 0, excise_tax: 0, post_key: "PK2", post_module: "BILL" },
          { id: "b3", external_id: "INV-3", order_external_id: null, tractor_unit: "754", driver_external_id: "D42", bill_date: "2026-06-22T00:00:00Z", transfer_date: null, total_charges: 999, other_charge: 0, excise_tax: 0, post_key: null, post_module: null },
        ],
        // The office schedule (T1): a lease row covering June. Charged whole-month, own column.
        truck_cost_schedules: [
          { id: "cs1", unit_number: "754", category: "lease", label: "VIP Lease 754", monthly_amount: 2500, effective_from: "2026-01-01", effective_to: null, notes: null },
        ],
      },
    });

    const { report, provenance } = await computeCpmForWindow(rec.client, ORG, "2026-06-01", "2026-07-01");

    expect(provenance.pendingSources).toEqual([]);
    expect(provenance.movements).toBe(2);
    expect(provenance.samsaraVehicles).toBe(1);
    expect(report.milesBasis).toBe("samsara_actual");

    const truck = report.trucks.find((t) => t.tractor_unit === "754")!;
    expect(truck.loadedMiles).toBe(1300);
    expect(truck.actualMiles).toBe(1400);
    expect(truck.deadheadMilesEstimated).toBe(0);
    expect(truck.totalMiles).toBe(1400);
    // Fuel joined by unit (trimmed "754 " → "754"): $1000. Settlement: $600.
    expect(truck.directFuel).toBe(1000);
    expect(truck.directSettlement).toBe(600);
    expect(truck.directTotal).toBe(1600);
    expect(truck.directCpm).toBeCloseTo((1600 / truck.totalMiles) * 100, 1);
    // The schedule's lease charges its own column; direct stays measured-only.
    expect(truck.fixedCost).toBe(2500);
    // Overhead is ALLOCATED since the 2026-08-28 ruling. 754 is the only company truck here — 801
    // settles to an owner-operator and leaves the table — so it carries the whole $5,000 INSCO
    // voucher. The fuel vendor's $999,999 stays out, which is the D-FS2 exclusion still holding.
    expect(truck.allocatedOverhead).toBe(5000);
    expect(truck.totalCpm).toBeCloseTo(((1600 + 2500 + 5000) / truck.totalMiles) * 100, 1);
    expect(provenance.scheduledUnits).toBe(1);
    expect(report.caveats.some((c) => c.includes("contracts, not measurements"))).toBe(true);
    // Revenue: only the two GL-booked invoices join — $4,000 over 1,400 measured miles — and net
    // subtracts every cost IN the report (direct 1600 + fixed 2500).
    expect(provenance.bookedInvoices).toBe(2);
    expect(truck.revenue).toBe(4000);
    expect(truck.revenueCpm).toBeCloseTo((4000 / 1400) * 100, 1);
    expect(truck.netTotal).toBeCloseTo(4000 - 1600 - 2500 - 5000, 2);
    // Nothing is withheld any more, so net subtracts every cost in the report and there is no
    // "subtracts ONLY" caveat to emit.
    expect(report.excluded.unallocatedOverhead).toBe(0);
    // The fuel-vendor voucher stayed OUT of the pool: only the $5,000 insurance invoice was spread,
    // which is the D-FS2 exclusion still holding.
    //
    // And the pool came from the VOUCHERS here, not the ledger — this fixture's GL books $4,000 of
    // expense against $1,600 attributed plus a $2,900 owner-operator settlement, so the remainder
    // would be −$500. The harness refuses a negative remainder rather than spreading a credit
    // across trucks, and falls back with `overheadSource` saying so.
    expect(report.excluded.overheadSource).toBe("ap_vouchers");
    // The fleet-truth check: GL income statement through McLeod's own classes; assets ignored.
    expect(provenance.glCheck.revenue).toBe(10000);
    expect(provenance.glCheck.expenses).toBe(4000);
    expect(provenance.glCheck.net).toBe(6000);
    expect(provenance.glCheck.monthsCovered).toEqual(["2026-06"]);
    expect(provenance.glCheck.unclassifiedNet).toBe(0);

    // The honesty ledger. Overhead is now ON the trucks, so nothing sits unallocated; the
    // owner-operator settlement is still pooled apart, because its arithmetic is a different
    // question and averaging it with company trucks describes neither.
    expect(report.excluded.unallocatedOverhead).toBe(0);
    expect(report.excluded.ownerOperatorSettlement).toBe(2900);
    // 801 ran only for the contractor, so it leaves the company table entirely rather than drawing
    // a share of company overhead it never caused.
    expect(report.trucks.some((t) => t.tractor_unit === "801")).toBe(false);
    expectOrgScoped(rec, ORG);
  });

  /**
   * The contractor pool, per payee — the shape the Contractors tab renders.
   *
   * This is a regression test for a defect that reached production: `cpm.ts` built its settlement
   * facts with `payee_id: null` and `order_external_id: null` hard-coded, though `mcleod_settlements`
   * carries both (measured 2026-08-29: 20,693 of 20,693 staged rows, all 574 owner-operator rows
   * included). Two things followed. `accumulateOwnerOperatorPay` groups by payee with a
   * "(unnamed)" fallback, so all eight of this carrier's contractors collapsed into ONE row; and
   * `ownerOpOrders` was empty, so no bill was ever routed to the pool — every contractor's margin
   * read as its pay negated, and the revenue stayed on the company trucks, inflating their $/mile.
   */
  it("keeps each contractor its own row and credits the revenue its own orders earned", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        mcleod_movements: MOVEMENTS,
        mcleod_settlements: [
          { external_id: "S-1", tractor_unit: "754", driver_external_id: "D42", payee_id: "D42", order_external_id: "O-0", payee_type: "company_driver", accrued_at: "2026-06-16T00:00:00Z", paid_at: null, total_pay: 600, posted_pay: 600, is_void: false, accrual_key: "AK-1" },
          { external_id: "S-2", tractor_unit: "801", driver_external_id: "D9", payee_id: "SCORELIL", order_external_id: "O-1", payee_type: "owner_operator", accrued_at: "2026-06-18T00:00:00Z", paid_at: null, total_pay: 900, posted_pay: 900, is_void: false, accrual_key: "AK-2" },
          { external_id: "S-3", tractor_unit: "802", driver_external_id: "D8", payee_id: "IVETJOIL", order_external_id: "O-2", payee_type: "owner_operator", accrued_at: "2026-06-19T00:00:00Z", paid_at: null, total_pay: 450, posted_pay: 450, is_void: false, accrual_key: "AK-3" },
        ],
        mcleod_ap_vouchers: [],
        mcleod_gl_accounts: [],
        mcleod_gl_totals: [],
        financial_entries: [],
        vehicles: [{ id: "v1", unit_number: "754" }],
        samsara_ifta_jurisdiction_miles: [{ vehicle_id: "v1", total_meters: 1400 * 1609.344 }],
        mcleod_billing: [
          { id: "b0", external_id: "INV-0", order_external_id: "O-0", tractor_unit: "754", driver_external_id: "D42", bill_date: "2026-06-10T00:00:00Z", transfer_date: null, total_charges: 2000, other_charge: 0, excise_tax: 0, post_key: "PK0", post_module: "BILL" },
          { id: "b1", external_id: "INV-1", order_external_id: "O-1", tractor_unit: "801", driver_external_id: "D9", bill_date: "2026-06-18T00:00:00Z", transfer_date: null, total_charges: 1000, other_charge: 0, excise_tax: 0, post_key: "PK1", post_module: "BILL" },
          { id: "b2", external_id: "INV-2", order_external_id: "O-2", tractor_unit: "802", driver_external_id: "D8", bill_date: "2026-06-19T00:00:00Z", transfer_date: null, total_charges: 500, other_charge: 0, excise_tax: 0, post_key: "PK2", post_module: "BILL" },
        ],
        truck_cost_schedules: [],
      },
    });

    const { report } = await computeCpmForWindow(rec.client, ORG, "2026-06-01", "2026-07-01");

    const byPayee = Object.fromEntries(report.ownerOperators.map((o) => [o.payeeId, o]));
    expect(Object.keys(byPayee).sort()).toEqual(["IVETJOIL", "SCORELIL"]);
    expect(byPayee.SCORELIL!.pay).toBe(900);
    expect(byPayee.SCORELIL!.revenue).toBe(1000);
    expect(byPayee.SCORELIL!.grossMargin).toBe(100);
    expect(byPayee.SCORELIL!.dealPct).toBe(90);
    expect(byPayee.SCORELIL!.units).toEqual(["801"]);
    expect(byPayee.IVETJOIL!.pay).toBe(450);
    expect(byPayee.IVETJOIL!.revenue).toBe(500);
    // The contractors' revenue leaves the company table with their pay, instead of inflating 754.
    expect(report.trucks.find((t) => t.tractor_unit === "754")!.revenue).toBe(2000);
    expect(report.trucks.some((t) => t.tractor_unit === "801" || t.tractor_unit === "802")).toBe(false);
    expectOrgScoped(rec, ORG);
  });

  it("an empty window names the sweeps that have not run instead of reporting a $0.00 fleet", async () => {
    const rec = createSupabaseRecorder({
      tables: { mcleod_movements: [], mcleod_settlements: [], mcleod_ap_vouchers: [], mcleod_billing: [], mcleod_gl_accounts: [], mcleod_gl_totals: [], financial_entries: [], vehicles: [], samsara_ifta_jurisdiction_miles: [], truck_cost_schedules: [] },
    });
    const { report, provenance } = await computeCpmForWindow(rec.client, ORG, "2026-07-01", "2026-08-01");
    expect(report.trucks).toEqual([]);
    expect(provenance.pendingSources).toHaveLength(4);
    expect(provenance.pendingSources.join(" ")).toContain("--financial");
    expectOrgScoped(rec, ORG);
  });

  it("falls back to the estimate basis when Samsara has no miles, infers deadhead, and names the gap", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        mcleod_movements: MOVEMENTS,
        mcleod_settlements: [],
        mcleod_ap_vouchers: [],
        financial_entries: [],
        vehicles: [],
        samsara_ifta_jurisdiction_miles: [],
        truck_cost_schedules: [],
        mcleod_billing: [],
        mcleod_gl_accounts: [],
        mcleod_gl_totals: [],
      },
    });
    const { report, provenance } = await computeCpmForWindow(rec.client, ORG, "2026-06-01", "2026-07-01");
    expect(report.milesBasis).toBe("mcleod_loaded_plus_deadhead_estimate");
    const truck = report.trucks.find((t) => t.tractor_unit === "754")!;
    // Atlanta dropoff → Chattanooga pickup: inferred, nonzero, and a floor (great-circle).
    expect(truck.deadheadMilesEstimated).toBeGreaterThan(80);
    expect(truck.totalMiles).toBe(truck.loadedMiles + truck.deadheadMilesEstimated);
    expect(provenance.pendingSources.join(" ")).toContain("Samsara");
    expectOrgScoped(rec, ORG);
  });
});
