import { describe, expect, it } from "vitest";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { loadPlanningTruck } from "./fuelPlanning.js";

/**
 * Whose trailer decides "pulls a reefer" (TRAILER-LINK-PLAN D-TL2): a load's own McLeod trailer when
 * the caller plans a load, the truck's GPS pairing only when there is no load. The recorder does not
 * filter, so the `trailers` fixture is a GPS-paired reefer on every read that asks for one.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const veh = { id: "veh-1", samsara_vehicle_id: null, tank_capacity_gal: 200, observed_max_fill_gal: null, baseline_mpg: 6.5, height_in: null, length_in: null, width_in: null, axle_count: null };
const rec = () => createSupabaseRecorder({
  tables: { route_fuel_settings: { data: [] }, vehicles: { data: [veh] }, trailers: { data: [{ id: "tr-gps-reefer" }] } },
});

describe("loadPlanningTruck", () => {
  it("a load whose McLeod trailer is a dry van is not a reefer, whatever the GPS pairing says", async () => {
    const r = rec();
    const truck = await loadPlanningTruck(r.client, ORG, "veh-1", null, false);
    expect(truck?.isReefer).toBe(false);
    expect(r.queries.some((q) => q.table === "trailers")).toBe(false);
  });

  it("a load whose McLeod trailer is a reefer is a reefer", async () => {
    expect((await loadPlanningTruck(rec().client, ORG, "veh-1", null, true))?.isReefer).toBe(true);
  });

  it("with no load, the GPS pairing still decides", async () => {
    expect((await loadPlanningTruck(rec().client, ORG, "veh-1", null))?.isReefer).toBe(true);
  });
});
