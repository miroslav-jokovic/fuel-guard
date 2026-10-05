import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { ingestVehicles } from "./rosterIngest.js";

/**
 * McLeod's fuel-tax switch, through the vehicle sweep (IFTA-PRECISION-PLAN IP4, 0433).
 *
 * The fact is NOT identity: it comes from McLeod's fuel-tax module and says whether the carrier reports
 * the truck in its IFTA return, so it is recorded even for a truck whose plate and VIN the office owns.
 * And an ABSENT fact — an older agent that did not read the column — must never close a period.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-05T15:00:00Z"); // 10:00 in Chicago — the carrier's 2026-10-05
const vehicle = (over: Record<string, unknown> = {}) => ({
  id: "v-1", org_id: ORG, status: "active", identity_source: "samsara",
  vin: "3AKJHHDR4LSLL4083", unit_number: "512", mcleod_tractor_id: "512", ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  external_id: "512", vin: "3AKJHHDR4LSLL4083", unit_number: "512", purchased_at: "2020-01-01", ...over,
});

function seed(vehicles: unknown[], openPeriod: Record<string, unknown> | null = null) {
  return createSupabaseRecorder({
    tables: {
      vehicles,
      vehicle_fuel_tax_exclusions: (q) => (q.write ? [] : openPeriod ? [openPeriod] : []),
    },
  });
}

describe("ingestVehicles and McLeod's fuel-tax switch", () => {
  it("opens a dated exclusion when McLeod excludes a truck, stamped with the carrier's day", async () => {
    const rec = seed([vehicle()]);
    const r = await ingestVehicles(rec.client, ORG, [row({ fuel_tax_excluded: true })], "identity", NOW);
    expect(rec.writtenRows("vehicle_fuel_tax_exclusions")).toEqual([
      { org_id: ORG, vehicle_id: "v-1", excluded_from: "2026-10-05", source: "mcleod" },
    ]);
    expect(r.fuelTaxExclusionChanges).toBe(1);
    expectOrgScoped(rec, ORG);
  });

  it("writes nothing for an included truck with nothing open — every truck, every sweep, today", async () => {
    const rec = seed([vehicle()]);
    const r = await ingestVehicles(rec.client, ORG, [row({ fuel_tax_excluded: false })], "identity", NOW);
    expect(rec.writtenRows("vehicle_fuel_tax_exclusions")).toEqual([]);
    expect(r.fuelTaxExclusionChanges ?? 0).toBe(0);
  });

  it("records it for a truck whose identity the office owns — the plate is theirs, the tax fact is McLeod's", async () => {
    const rec = seed([vehicle({ identity_source: "manual" })]);
    const r = await ingestVehicles(rec.client, ORG, [row({ fuel_tax_excluded: true })], "identity", NOW);
    expect(r.skippedOwned).toBe(1);
    expect(rec.writtenRows("vehicles")).toEqual([]);
    expect(rec.writtenRows("vehicle_fuel_tax_exclusions")).toHaveLength(1);
  });

  it("never closes an open period on an ABSENT fact — an agent that did not read the column", async () => {
    const rec = seed([vehicle()], { id: "p1", source: "mcleod", excluded_from: "2026-08-01" });
    await ingestVehicles(rec.client, ORG, [row()], "identity", NOW);
    expect(rec.forTable("vehicle_fuel_tax_exclusions")).toEqual([]);
  });

  it("does nothing in link mode, which writes links and nothing else", async () => {
    const rec = seed([vehicle({ mcleod_tractor_id: null })]);
    await ingestVehicles(rec.client, ORG, [row({ fuel_tax_excluded: true })], "link", NOW);
    expect(rec.forTable("vehicle_fuel_tax_exclusions")).toEqual([]);
  });

  it("does nothing for a McLeod tractor it could not place", async () => {
    const rec = seed([]);
    const r = await ingestVehicles(rec.client, ORG, [row({ external_id: "999", unit_number: "999", vin: "X1", fuel_tax_excluded: true })], "identity", NOW);
    expect(r.unmatched).toEqual(["999"]);
    expect(rec.forTable("vehicle_fuel_tax_exclusions")).toEqual([]);
  });
});
