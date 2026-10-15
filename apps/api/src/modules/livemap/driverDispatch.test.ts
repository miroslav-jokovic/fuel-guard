import { describe, it, expect } from "vitest";
import { readDriverDispatch } from "./driverDispatch.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * Who dispatches each driver (MEDSTOP-PLAN §7A.19), read off the dispatch board's own rows: the truck's
 * fleet dispatcher and the load's, kept apart, named from McLeod's roster.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-15T20:00:00.000Z");

const vehicle = (o: Record<string, unknown> = {}) => ({
  id: "veh-773", unit_number: "773", status: "active", assigned_driver_id: "drv-1", mcleod_fleet_code: "VINNIEV", ...o,
});
const load = (o: Record<string, unknown> = {}) => ({
  id: "load-1", vehicle_id: "veh-773", driver_id: "drv-1", ref: "291013", status: "in_transit", source: "tms",
  external_status: "P", dispatcher_external_id: "asen", drivers: { full_name: "Ana Ruiz" }, trailers: null, ...o,
});

function recorder(o: { vehicles?: unknown[]; loads?: unknown[]; fleets?: unknown[] } = {}) {
  return createSupabaseRecorder({
    tables: {
      vehicles: { data: o.vehicles ?? [vehicle()] },
      drivers: { data: [{ id: "drv-1", first_name: "Ana", last_name: "Ruiz" }, { id: "drv-2", first_name: "Bo", last_name: "Lee" }] },
      loads: { data: o.loads ?? [load()] },
      tms_dispatchers: {
        data: [
          { external_id: "vinniev", display_name: "Vinnie V", is_system: false, is_active: true, user_id: null },
          { external_id: "asen", display_name: null, is_system: false, is_active: true, user_id: null },
        ],
      },
      tms_fleets: { data: o.fleets ?? [{ code: "VINNIEV", dispatcher_external_id: "vinniev" }, { code: "KANE", dispatcher_external_id: null }] },
    },
  });
}

describe("readDriverDispatch", () => {
  it("names the fleet's dispatcher and, apart from it, the colleague dispatching the load — falling back to the login", async () => {
    const rec = recorder();
    const out = await readDriverDispatch(rec.client, ORG, NOW);
    expect(out.get("drv-1")).toEqual({ unitNumber: "773", fleetCode: "VINNIEV", fleetDispatcher: "Vinnie V", loadDispatcher: "asen" });
    expectOrgScoped(rec, ORG);
  });

  it("leaves the fleet's dispatcher empty until an office links the fleet, and the load's empty with no load", async () => {
    const out = await readDriverDispatch(recorder({ vehicles: [vehicle({ mcleod_fleet_code: "KANE" })], loads: [] }).client, ORG, NOW);
    expect(out.get("drv-1")).toEqual({ unitNumber: "773", fleetCode: "KANE", fleetDispatcher: null, loadDispatcher: null });
  });

  it("has no answer for a driver without a truck on the board — retired trucks included", async () => {
    const out = await readDriverDispatch(recorder({ vehicles: [vehicle({ status: "retired" })], loads: [] }).client, ORG, NOW);
    expect(out.has("drv-1")).toBe(false);
    expect(out.has("drv-2")).toBe(false);
  });
});
