import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { readIftaJurisdictionTrucks } from "./periodReads.js";

/**
 * The drill-down behind one IFTA ledger row: every truck in one jurisdiction for one quarter.
 *
 * The fixtures are FUNCTIONS of the query, not flat arrays — the recorder does not filter, so a flat
 * fixture would hand back the same rows whatever the reader asked for and prove nothing about the
 * jurisdiction, the months or the org it scoped to.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const MILES = [
  // Unit 732, August: its gateway was swapped mid-month, so two devices report one truck (0357/0358).
  { vehicle_id: "v732", samsara_vehicle_id: "old", period_year: 2026, period_month: 8, jurisdiction: "TX", taxable_meters: 30_000, total_meters: 31_000 },
  { vehicle_id: "v732", samsara_vehicle_id: "new", period_year: 2026, period_month: 8, jurisdiction: "TX", taxable_meters: 10_000, total_meters: 10_000 },
  { vehicle_id: "v732", samsara_vehicle_id: "new", period_year: 2026, period_month: 9, jurisdiction: "TX", taxable_meters: 5_000, total_meters: 5_000 },
  { vehicle_id: "v101", samsara_vehicle_id: "a", period_year: 2026, period_month: 7, jurisdiction: "TX", taxable_meters: 20_000, total_meters: 20_000 },
  // Noise the filters must exclude: another jurisdiction, another quarter.
  { vehicle_id: "v101", samsara_vehicle_id: "a", period_year: 2026, period_month: 7, jurisdiction: "OK", taxable_meters: 99_000, total_meters: 99_000 },
  { vehicle_id: "v101", samsara_vehicle_id: "a", period_year: 2026, period_month: 6, jurisdiction: "TX", taxable_meters: 99_000, total_meters: 99_000 },
];

const fillRow = (id: string, vehicle_id: string | null, state: string, business_date: string, gallons: number) => ({
  id, vehicle_id, state, business_date, fueled_at: `${business_date}T15:00:00Z`, gallons,
  price_per_gal: "3.800", total_cost: String(gallons * 3.8), location_text: "Pilot, Amarillo", tank_type: "tractor",
});
const FILLS = [
  fillRow("f1", "v101", "TX", "2026-07-10", 100),
  // Bought in Texas by a truck Samsara never saw drive there — its unit number must still resolve.
  fillRow("f2", "v555", "TX", "2026-09-30", 50),
  fillRow("f3", null, "TX", "2026-08-01", 20),
  // Noise: the next quarter's first day, and another state.
  fillRow("f4", "v101", "TX", "2026-10-01", 999),
  fillRow("f5", "v101", "OK", "2026-07-10", 999),
];

// McLeod's hand-keyed receipts (IP6). 101's duplicates card fill f1; 512 bought nothing on our cards.
const RECEIPTS = [
  { external_id: "rA", tractor_unit: "101", jurisdiction: "TX", receipt_date: "2026-07-10", gallons: "100.4", processed_at: null },
  { external_id: "rB", tractor_unit: "512", jurisdiction: "TX", receipt_date: "2026-08-15", gallons: "120", processed_at: null },
  { external_id: "rC", tractor_unit: "512", jurisdiction: "OK", receipt_date: "2026-08-16", gallons: "90", processed_at: null },
];
const VEHICLES = [
  { id: "v732", unit_number: " 732 ", mcleod_tractor_id: null },
  { id: "v101", unit_number: "101", mcleod_tractor_id: "101" },
  { id: "v555", unit_number: "555", mcleod_tractor_id: null },
  { id: "v512", unit_number: "512", mcleod_tractor_id: "512" },
];

const filtersOf =(q: RecordedQuery) => Object.fromEntries(q.filters().map((f) => [f.col, f.val]));

function recorder() {
  return createSupabaseRecorder({
    tables: {
      samsara_ifta_jurisdiction_miles: (q) => {
        const f = filtersOf(q);
        return MILES.filter(
          (r) =>
            r.period_year === f.period_year &&
            (f.period_month as number[]).includes(r.period_month) &&
            r.jurisdiction === f.jurisdiction,
        );
      },
      vehicles: (q) => {
        const f = filtersOf(q);
        const hit = (col: string, value: string | null) => Array.isArray(f[col]) && value != null && (f[col] as string[]).includes(value);
        return VEHICLES.filter((v) => hit("id", v.id) || hit("mcleod_tractor_id", v.mcleod_tractor_id) || hit("unit_number", v.unit_number));
      },
      mcleod_fuel_tax_receipts: (q) => {
        const f = filtersOf(q);
        const ops = q.ops.map((o) => [o.method, ...o.args] as unknown[]);
        const arg = (method: string, col: string) => ops.find((o) => o[0] === method && o[1] === col)?.[2];
        return RECEIPTS.filter((r) => r.jurisdiction === f.jurisdiction &&
          r.receipt_date >= String(arg("gte", "receipt_date")) && r.receipt_date < String(arg("lt", "receipt_date")));
      },
      fuel_transactions: (q) => {
        const ops = q.ops.map((o) => [o.method, ...o.args] as unknown[]);
        const arg = (method: string, col: string) => ops.find((o) => o[0] === method && o[1] === col)?.[2];
        return FILLS.filter(
          (f) =>
            String(f.state).toUpperCase() === String(arg("ilike", "state")).toUpperCase() &&
            f.business_date >= String(arg("gte", "business_date")) &&
            f.business_date < String(arg("lt", "business_date")),
        );
      },
    },
  });
}

describe("readIftaJurisdictionTrucks", () => {
  it("sums each truck across the quarter's months and across a swapped gateway's two devices", async () => {
    const rec = recorder();
    const r = await readIftaJurisdictionTrucks(rec.client as unknown as SupabaseClient, ORG, 2026, 3, "TX");
    const byUnit = Object.fromEntries(r.trucks.map((t) => [t.unitNumber, t]));
    expect(Object.keys(byUnit).sort()).toEqual(["101", "732"]);
    expect(byUnit["732"]).toMatchObject({ taxableMeters: 45_000, totalMeters: 46_000, months: 2 });
    expect(byUnit["101"]).toMatchObject({ taxableMeters: 20_000, totalMeters: 20_000, months: 1 });
    expect(r).toMatchObject({ jurisdiction: "TX", year: 2026, quarter: 3 });
  });

  it("asks for exactly the quarter's three months and the one jurisdiction", async () => {
    const rec = recorder();
    await readIftaJurisdictionTrucks(rec.client as unknown as SupabaseClient, ORG, 2026, 3, "TX");
    const miles = rec.queries.find((q) => q.table === "samsara_ifta_jurisdiction_miles")!;
    expect(filtersOf(miles)).toMatchObject({ period_year: 2026, period_month: [7, 8, 9], jurisdiction: "TX" });
  });

  it("scopes every read to the caller's org — the service role bypasses RLS", async () => {
    const rec = recorder();
    await readIftaJurisdictionTrucks(rec.client as unknown as SupabaseClient, ORG, 2026, 3, "TX");
    expectOrgScoped(rec, ORG);
  });

  it("returns the quarter's fills bought in the jurisdiction, including a fuel-only truck and an unattached fill", async () => {
    const rec = recorder();
    const r = await readIftaJurisdictionTrucks(rec.client as unknown as SupabaseClient, ORG, 2026, 3, "TX");
    expect(r.fills.map((f) => [f.id, f.vehicleId, f.gallons])).toEqual([
      ["f1", "v101", 100],
      ["f2", "v555", 50],
      ["f3", null, 20],
    ]);
    expect(r.fills[0]!.totalCost).toBe(380);
    expect(r.units.v555).toBe("555");
  });

  it("adds the jurisdiction's McLeod receipts, minus the one a card fill already carries, and names their trucks", async () => {
    const rec = recorder();
    const r = await readIftaJurisdictionTrucks(rec.client as unknown as SupabaseClient, ORG, 2026, 3, "TX");
    expect(r.receipts).toEqual([
      { externalId: "rB", vehicleId: "v512", mcleodUnit: "512", jurisdiction: "TX", receiptDate: "2026-08-15", gallons: 120 },
    ]);
    expect(r.receiptDuplicates).toBe(1);
    // 512 drove nowhere Samsara saw and bought nothing on our cards: its unit still resolves.
    expect(r.units.v512).toBe("512");
  });

  it("cuts a Q4 quarter at the next year's first day", async () => {
    const rec = recorder();
    await readIftaJurisdictionTrucks(rec.client as unknown as SupabaseClient, ORG, 2026, 4, "TX");
    const fuel = rec.queries.find((q) => q.table === "fuel_transactions")!;
    const lt = fuel.ops.find((o) => o.method === "lt" && o.args[0] === "business_date");
    expect(lt?.args[1]).toBe("2027-01-01");
  });

  it("reads no vehicles at all when the jurisdiction has no trucks", async () => {
    const rec = recorder();
    const r = await readIftaJurisdictionTrucks(rec.client as unknown as SupabaseClient, ORG, 2026, 3, "NV");
    expect(r.trucks).toEqual([]);
    expect(rec.queries.some((q) => q.table === "vehicles")).toBe(false);
  });
});
