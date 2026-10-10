import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { ingestVehicles } from "./rosterIngest.js";

/**
 * A truck's McLeod home fleet, through the vehicle sweep (DISPATCH-BOARD-PLAN DB1/DB2, 0450).
 *
 * The fleet is who OWNS the truck — 'VINNIEV' on exactly the owner's eight on 2026-10-09 — and like the
 * fuel-tax fact it is not identity, so it is recorded for an office-owned truck too. It is written only
 * when it CHANGED (the sweep runs every two minutes), an ABSENT fact never clears it, and every code
 * seen is offered to the office's link list without ever naming whose fleet it is.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-09T15:00:00Z");
const vehicle = (over: Record<string, unknown> = {}) => ({
  id: "v-773", org_id: ORG, status: "active", identity_source: "samsara",
  vin: "3AKJHHDR4LSLL7730", unit_number: "773", mcleod_tractor_id: "773", mcleod_fleet_code: null, ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  external_id: "773", vin: "3AKJHHDR4LSLL7730", unit_number: "773", purchased_at: "2021-01-01", ...over,
});
const seed = (vehicles: unknown[]) =>
  createSupabaseRecorder({ tables: { vehicles, vehicle_fuel_tax_exclusions: [], tms_fleets: [] } });

/** The fleet writes only — the identity patch writes `vehicles` too, and is not what these tests are about. */
const fleetUpdates = (rec: ReturnType<typeof seed>) =>
  rec.forTable("vehicles").filter((q) => q.write?.method === "update" && "mcleod_fleet_code" in (q.write.payload as object));

describe("ingestVehicles and the truck's McLeod home fleet", () => {
  it("records a new fleet code and offers the code to the office's link list, unlinked", async () => {
    const rec = seed([vehicle()]);
    const r = await ingestVehicles(rec.client, ORG, [row({ fleet_code: "VINNIEV" })], "identity", NOW);
    expect(fleetUpdates(rec).map((q) => q.write!.payload)).toEqual([{ mcleod_fleet_code: "VINNIEV" }]);
    expect(r.fleetCodeChanges).toBe(1);
    // Seeded with its identity only: whose fleet it is, is the office's confirmation (D-LM4's rule).
    expect(rec.writtenRows("tms_fleets")).toEqual([{ org_id: ORG, provider: "mcleod", code: "VINNIEV" }]);
    expectOrgScoped(rec, ORG);
  });

  it("writes nothing when the code has not changed — the steady state, every two minutes", async () => {
    const rec = seed([vehicle({ mcleod_fleet_code: "VINNIEV" })]);
    const r = await ingestVehicles(rec.client, ORG, [row({ fleet_code: "VINNIEV" })], "identity", NOW);
    expect(fleetUpdates(rec)).toEqual([]);
    expect(r.fleetCodeChanges).toBe(0);
  });

  it("records it for a truck whose identity the office owns — the plate is theirs, the fleet is McLeod's", async () => {
    const rec = seed([vehicle({ identity_source: "manual" })]);
    const r = await ingestVehicles(rec.client, ORG, [row({ fleet_code: "KANE" })], "identity", NOW);
    expect(r.skippedOwned).toBe(1);
    expect(fleetUpdates(rec).map((q) => q.write!.payload)).toEqual([{ mcleod_fleet_code: "KANE" }]);
  });

  it("clears the code when McLeod says NO fleet, and seeds nothing for it", async () => {
    const rec = seed([vehicle({ mcleod_fleet_code: "VLADI" })]);
    await ingestVehicles(rec.client, ORG, [row({ fleet_code: null })], "identity", NOW);
    expect(fleetUpdates(rec).map((q) => q.write!.payload)).toEqual([{ mcleod_fleet_code: null }]);
    expect(rec.writtenRows("tms_fleets")).toEqual([]);
  });

  it("never clears a code on an ABSENT fact — an older agent that did not read the column", async () => {
    const rec = seed([vehicle({ mcleod_fleet_code: "VINNIEV" })]);
    await ingestVehicles(rec.client, ORG, [row()], "identity", NOW);
    expect(fleetUpdates(rec)).toEqual([]);
    expect(rec.forTable("tms_fleets")).toEqual([]);
  });

  it("writes no fleet in link mode, which writes links only", async () => {
    const rec = seed([vehicle({ mcleod_tractor_id: null })]);
    await ingestVehicles(rec.client, ORG, [row({ fleet_code: "VINNIEV" })], "link", NOW);
    expect(fleetUpdates(rec)).toEqual([]);
    expect(rec.forTable("tms_fleets")).toEqual([]);
  });
});
