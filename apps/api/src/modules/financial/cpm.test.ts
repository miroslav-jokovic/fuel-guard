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
    expect(truck.totalCpm).toBeCloseTo(((1600 + 2500) / truck.totalMiles) * 100, 1);
    expect(provenance.scheduledUnits).toBe(1);
    expect(report.caveats.some((c) => c.includes("contracts, not measurements"))).toBe(true);

    // The honesty ledger: overhead unallocated (no finance ruling), owner-operator pooled apart.
    expect(report.excluded.unallocatedOverhead).toBe(5000);
    expect(report.excluded.ownerOperatorSettlement).toBe(2900);
    expect(report.caveats.some((c) => c.includes("EXCLUDES $5000.00 of overhead"))).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("an empty window names the sweeps that have not run instead of reporting a $0.00 fleet", async () => {
    const rec = createSupabaseRecorder({
      tables: { mcleod_movements: [], mcleod_settlements: [], mcleod_ap_vouchers: [], financial_entries: [], vehicles: [], samsara_ifta_jurisdiction_miles: [], truck_cost_schedules: [] },
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
