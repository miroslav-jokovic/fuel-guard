import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { ingestVehicles } from "./rosterIngest.js";

/**
 * McLeod winding a truck down, through the vehicle sweep (DISPATCH-BOARD-PLAN D-DB11, 0462). Like the
 * home fleet it is not identity, so it is recorded for an office-owned truck too; written only when
 * CHANGED; an ABSENT fact (an older agent) never clears it; and it never touches `status`.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-12T15:00:00Z");
const vehicle = (over: Record<string, unknown> = {}) => ({
  id: "v-506", org_id: ORG, status: "active", identity_source: "mcleod",
  vin: "3AKJHHDR0LSLL7398", unit_number: "506", mcleod_tractor_id: "506", winding_down: null, ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  external_id: "506", vin: "3AKJHHDR0LSLL7398", unit_number: "506", purchased_at: "2020-01-01", ...over,
});
const seed = (vehicles: unknown[]) =>
  createSupabaseRecorder({ tables: { vehicles, vehicle_fuel_tax_exclusions: [], tms_fleets: [] } });

/** The winding-down writes only — the identity patch writes `vehicles` too. */
const windingUpdates = (rec: ReturnType<typeof seed>) =>
  rec.forTable("vehicles").filter((q) => q.write?.method === "update" && "winding_down" in (q.write.payload as object));

describe("ingestVehicles and McLeod winding a truck down", () => {
  it("records a truck McLeod is winding down, and leaves it active", async () => {
    const rec = seed([vehicle()]);
    const r = await ingestVehicles(rec.client, ORG, [row({ winding_down: true })], "identity", NOW);
    expect(windingUpdates(rec).map((q) => q.write!.payload)).toEqual([{ winding_down: true }]);
    expect(r.windingDownChanges).toBe(1);
    // Membership is McLeod's service flag, not this (D-FC0): no write anywhere sets another status.
    const statuses = rec.writtenRows("vehicles").map((w) => w.status).filter((s) => s !== undefined);
    expect(statuses.every((s) => s === "active")).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("writes nothing when the fact has not changed — the steady state, every two minutes", async () => {
    const rec = seed([vehicle({ winding_down: true })]);
    const r = await ingestVehicles(rec.client, ORG, [row({ winding_down: true })], "identity", NOW);
    expect(windingUpdates(rec)).toEqual([]);
    expect(r.windingDownChanges).toBe(0);
  });

  it("records false over a never-reported null, so 'not winding down' becomes McLeod's answer", async () => {
    const rec = seed([vehicle({ winding_down: null })]);
    await ingestVehicles(rec.client, ORG, [row({ winding_down: false })], "identity", NOW);
    expect(windingUpdates(rec).map((q) => q.write!.payload)).toEqual([{ winding_down: false }]);
  });

  it("records it for a truck whose identity the office owns", async () => {
    const rec = seed([vehicle({ identity_source: "manual" })]);
    const r = await ingestVehicles(rec.client, ORG, [row({ winding_down: true })], "identity", NOW);
    expect(r.skippedOwned).toBe(1);
    expect(windingUpdates(rec).map((q) => q.write!.payload)).toEqual([{ winding_down: true }]);
  });

  it("never clears the fact on an absent value from an older agent", async () => {
    const rec = seed([vehicle({ winding_down: true })]);
    const r = await ingestVehicles(rec.client, ORG, [row()], "identity", NOW);
    expect(windingUpdates(rec)).toEqual([]);
    expect(r.windingDownChanges).toBeUndefined();
  });

  it("records nothing in link mode, which writes links only", async () => {
    const rec = seed([vehicle()]);
    await ingestVehicles(rec.client, ORG, [row({ winding_down: true })], "link", NOW);
    expect(windingUpdates(rec)).toEqual([]);
  });
});
