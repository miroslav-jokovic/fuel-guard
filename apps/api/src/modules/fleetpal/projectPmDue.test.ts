import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { projectPmDue } from "./projectPmDue.js";

/**
 * F11: `vehicles.next_pm_due_*` fed from FleetPal's schedules through roster's writer. Done-when: a
 * truck 500 mi from due gets that due point; a truck with no schedule gets nothing, not zero.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-28T15:00:00.000Z");
const MI = 1609.344;

describe("projectPmDue", () => {
  it("writes the soonest date and the lowest mileage per truck, leaves the annual out, and clears a truck with no schedule", async () => {
    const vehicle = (id: string, odo: number) => ({ id, unit_number: id, status: "active", assigned_driver_id: null, samsara_fuel_percent: null, samsara_fuel_at: null, mcleod_fleet_code: null, winding_down: false, dot_annual_inspection_expires_at: null, current_odometer: odo, next_pm_due_odometer: null, next_pm_due_at: "2020-01-01" });
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: { data: [vehicle("v-1", 119_500), vehicle("v-2", 50_000)] },
        drivers: { data: [] },
        fleetpal_units: { data: [{ fleetpal_id: "fp-1", vehicle_id: "v-1", trailer_id: null }, { fleetpal_id: "fp-1b", vehicle_id: "v-1", trailer_id: null }, { fleetpal_id: "fp-2", vehicle_id: "v-2", trailer_id: null }] },
        fleetpal_pm_schedules: {
          data: [
            { fleetpal_id: "oil", unit_fleetpal_id: "fp-1", name: "Oil Change", last_done: null },
            { fleetpal_id: "six", unit_fleetpal_id: "fp-1b", name: "6-Month Inspection", last_done: "2026-06-01T00:00:00Z" },
            { fleetpal_id: "annual", unit_fleetpal_id: "fp-1", name: "Annual DOT Inspection", last_done: "2026-01-01T00:00:00Z" },
          ],
        },
        fleetpal_pm_intervals: {
          data: [
            { pm_schedule_fleetpal_id: "oil", interval_type: "ODOMETER", value_int: 20_000 * MI, value_time_type: null, threshold_int: 7_000 * MI, threshold_time_type: null, last_done_meter_value: 100_000 * MI },
            { pm_schedule_fleetpal_id: "six", interval_type: "TIME", value_int: 6, value_time_type: "MONTH", threshold_int: 30, threshold_time_type: "DAY", last_done_meter_value: null },
            { pm_schedule_fleetpal_id: "annual", interval_type: "TIME", value_int: 12, value_time_type: "MONTH", threshold_int: 30, threshold_time_type: "DAY", last_done_meter_value: null },
          ],
        },
      },
    });
    const out = await projectPmDue(rec.client, ORG, NOW);
    expectOrgScoped(rec, ORG);
    expect(out).toEqual({ trucks: 2, changed: 2 });
    const writes = rec.writes().map((w) => [w.filters().find((f) => f.col === "id")?.val, w.write?.payload]);
    expect(writes).toEqual([
      // 500 mi from due, across BOTH FleetPal units; the 6-month on 12/01, not the annual's 01/01.
      ["v-1", { next_pm_due_odometer: 120_000, next_pm_due_at: "2026-12-01" }],
      ["v-2", { next_pm_due_odometer: null, next_pm_due_at: null }],
    ]);
  });
});
