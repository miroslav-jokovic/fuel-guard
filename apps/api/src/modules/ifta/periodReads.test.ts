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

const filtersOf = (q: RecordedQuery) => Object.fromEntries(q.filters().map((f) => [f.col, f.val]));

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
        const ids = filtersOf(q).id as string[];
        return [
          { id: "v732", unit_number: " 732 " },
          { id: "v101", unit_number: "101" },
        ].filter((v) => ids.includes(v.id));
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

  it("reads no vehicles at all when the jurisdiction has no trucks", async () => {
    const rec = recorder();
    const r = await readIftaJurisdictionTrucks(rec.client as unknown as SupabaseClient, ORG, 2026, 3, "NV");
    expect(r.trucks).toEqual([]);
    expect(rec.queries.some((q) => q.table === "vehicles")).toBe(false);
  });
});
