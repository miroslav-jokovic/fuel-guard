import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { readUnitShopRecord } from "./unitShopRecord.js";

/**
 * One unit's shop file (F10, M3).
 *
 * ⚠ THE ASSERTION THIS FILE EXISTS FOR: every read goes `.in()` over EVERY FleetPal unit the roster
 * row resolves to. Eight of this fleet's VINs are two FleetPal units each; a read over the first
 * would show half a truck's repairs and nothing would say so (`unitCost.ts`).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-28T15:00:00.000Z");
const MI = 1609.344;

function recorder(units: { fleetpal_id: string; number: string | null }[]) {
  return createSupabaseRecorder({
    tables: {
      fleetpal_units: { data: units.map((u) => ({ ...u, vehicle_id: "veh-1", trailer_id: null })) },
      fleetpal_work_orders: {
        data: [
          { id: "w-open", fleetpal_id: "fw1", reference_number: "WO-1", status: "OPEN", priority: "HIGH", description: "Brake job", started: null, completed: null, vendor_created_at: "2026-10-20T00:00:00Z" },
          { id: "w-done", fleetpal_id: "fw0", reference_number: "WO-0", status: "CLOSED", priority: null, description: null, started: "2026-06-01T08:00:00Z", completed: "2026-06-02T17:00:00Z", vendor_created_at: "2026-06-01T00:00:00Z" },
        ],
      },
      fleetpal_jobs: { data: [{ work_order_fleetpal_id: "fw0", name: "Steer tires" }] },
      fleetpal_defects: { data: [{ id: "d1", name: "Air leak", description: null, driver_comment: "Hissing", detected_on: "2026-10-10T00:00:00Z" }] },
      fleetpal_pm_schedules: { data: [{ fleetpal_id: "s1", unit_fleetpal_id: "fp-1", name: "Oil Change", last_done: null }, { fleetpal_id: "s2", unit_fleetpal_id: "fp-1", name: "Annual DOT Inspection", last_done: "2026-01-01T00:00:00Z" }] },
      fleetpal_pm_intervals: { data: [{ pm_schedule_fleetpal_id: "s1", interval_type: "ODOMETER", value_int: 20_000 * MI, value_time_type: null, threshold_int: 7_000 * MI, threshold_time_type: null, last_done_meter_value: 100_000 * MI }] },
      fleetpal_meters: { data: [{ value: 118_500 * MI, measured_at: "2026-10-27T12:00:00Z" }] },
    },
  });
}

describe("readUnitShopRecord", () => {
  it("⚠ reads every table .in() over EVERY FleetPal unit the truck resolves to", async () => {
    const rec = recorder([{ fleetpal_id: "fp-1", number: "654" }, { fleetpal_id: "fp-1b", number: "654" }]);
    await readUnitShopRecord(rec.client, ORG, "tractor", "veh-1", 118_000, NOW);
    expectOrgScoped(rec, ORG);
    for (const table of ["fleetpal_work_orders", "fleetpal_defects", "fleetpal_pm_schedules", "fleetpal_meters"]) {
      const f = rec.forTable(table).flatMap((q) => q.filters()).find((x) => x.col === "unit_fleetpal_id");
      expect(f?.val, table).toEqual(["fp-1", "fp-1b"]);
    }
  });

  it("splits the orders into open and history, judges the PM on the roster's meter, and keeps FleetPal's reading beside it", async () => {
    const rec = recorder([{ fleetpal_id: "fp-1", number: "654" }]);
    const out = await readUnitShopRecord(rec.client, ORG, "tractor", "veh-1", 118_000, NOW);
    expect(out.fleetpal).toEqual({ unitIds: ["fp-1"], number: "654", lastMeter: { miles: 118_500, measuredAt: "2026-10-27T12:00:00Z" } });
    expect(out.openWorkOrders.map((o) => o.id)).toEqual(["w-open"]);
    expect(out.openWorkOrders[0]).toMatchObject({ vehicleId: "veh-1", trailerId: null, unitNumber: "654" });
    // Same-day-plus-one is 2 days out: started the 1st, done the 2nd.
    expect(out.history).toEqual([{ id: "w-done", referenceNumber: "WO-0", status: "CLOSED", description: null, jobs: ["Steer tires"], openedAt: "2026-06-01T00:00:00Z", completedAt: "2026-06-02T17:00:00Z", downtimeDays: 2 }]);
    expect(out.openDefects).toHaveLength(1);
    // The annual is not FleetPal's to say (Q-DBV2); the oil change is 2,000 mi from due, inside the 7,000 window.
    expect(out.pm.schedules.map((s) => [s.name, s.verdict])).toEqual([["Oil Change", "due"]]);
    expect(out.pm).toMatchObject({ odometerMiles: 118_000, odometerSource: "roster" });
  });

  it("answers empty — not an error — for a unit the reconciliation has not matched", async () => {
    const rec = createSupabaseRecorder({ tables: { fleetpal_units: { data: [] } } });
    const out = await readUnitShopRecord(rec.client, ORG, "trailer", "tr-9", null, NOW);
    expect(out.fleetpal.unitIds).toEqual([]);
    expect(out.openWorkOrders).toEqual([]);
    expect(out.pm.schedules).toEqual([]);
    expect(rec.forTable("fleetpal_work_orders")).toHaveLength(0);
  });
});
