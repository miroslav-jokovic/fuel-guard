import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { readUnitsAttention } from "./unitAttention.js";

/**
 * Every unit on the worklist and why (M3, D-MX2) — one derivation for the list and the truck's page.
 *
 *   1. FleetPal's defects and orders land on OUR row through the F5 mapping, never the number string;
 *      an unmatched unit is nobody's attention here (it is still on the home's list under FleetPal's
 *      number — that list does not need a roster row).
 *   2. Reasons are counted per unit and sorted: overdue first, then the worklist's order.
 *   3. The annual due is our record's; a PM due is `pmStatus`'s; a short kit only once checked (R10).
 *   4. While "Should carry" is hidden (`KIT_RULES_SHOWN`, EA2) the kit is not read at all, so no unit is
 *      listed for "missing equipment" — a reason no screen would show and nobody could fix.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-28T15:00:00.000Z");
const MI = 1609.344;
const inService = (q: { filters(): { col: string; val: unknown }[] }) => (r: { status: string }) => {
  const f = q.filters().find((x) => x.col === "status");
  return !f || (Array.isArray(f.val) && f.val.includes(r.status));
};

function recorder() {
  return createSupabaseRecorder({
    tables: {
      vehicles: (q) => [
        { id: "v-654", unit_number: "654", status: "active", assigned_driver_id: null, samsara_fuel_percent: null, samsara_fuel_at: null, mcleod_fleet_code: null, winding_down: false, dot_annual_inspection_expires_at: "2026-11-10", current_odometer: 118_867 },
        { id: "v-700", unit_number: "700", status: "active", assigned_driver_id: null, samsara_fuel_percent: null, samsara_fuel_at: null, mcleod_fleet_code: null, winding_down: false, dot_annual_inspection_expires_at: "2027-06-01", current_odometer: 0 },
      ].filter(inService(q)),
      trailers: (q) => [{ id: "t-9001", unit_number: "9001", status: "active", dot_annual_inspection_expires_at: "2026-10-01" }].filter(inService(q)),
      drivers: { data: [] },
      fleetpal_units: { data: [{ fleetpal_id: "fp-654", number: "654", vehicle_id: "v-654", trailer_id: null }, { fleetpal_id: "fp-lost", number: "LOST", vehicle_id: null, trailer_id: null }] },
      fleetpal_work_orders: { data: [{ id: "w1", reference_number: "WO-1", unit_fleetpal_id: "fp-654", description: "Brakes", priority: null, vendor_created_at: "2026-10-20T00:00:00Z" }, { id: "w2", reference_number: "WO-2", unit_fleetpal_id: "fp-lost", description: "Lost", priority: null, vendor_created_at: "2026-10-21T00:00:00Z" }] },
      fleetpal_defects: { data: [{ id: "d1", unit_fleetpal_id: "fp-654", name: "Air leak", description: null, driver_comment: null, detected_on: "2026-10-10T00:00:00Z" }, { id: "d2", unit_fleetpal_id: "fp-654", name: "Light out", description: null, driver_comment: null, detected_on: "2026-10-01T00:00:00Z" }] },
      fleetpal_pm_schedules: { data: [{ fleetpal_id: "s1", unit_fleetpal_id: "fp-654", name: "Oil Change", last_done: null }] },
      fleetpal_pm_intervals: { data: [{ pm_schedule_fleetpal_id: "s1", interval_type: "ODOMETER", value_int: 20_000 * MI, value_time_type: null, threshold_int: 7_000 * MI, threshold_time_type: null, last_done_meter_value: 100_000 * MI }] },
      kit_expectations: { data: [] },
      asset_types: { data: [] },
      assets: { data: [] },
      stock_count_sessions: { data: [], count: 0 },
    },
  });
}

describe("readUnitsAttention", () => {
  it("names each unit's reasons once, by roster id, most urgent first — and nothing for an unmatched FleetPal unit", async () => {
    const rec = recorder();
    const out = await readUnitsAttention(rec.client, ORG, NOW);
    expectOrgScoped(rec, ORG);
    expect("error" in out).toBe(false);
    const rows = out as Exclude<typeof out, { error: unknown }>;
    expect(rows.map((r) => [r.kind, r.unitNumber])).toEqual([
      ["tractor", "654"],
      ["trailer", "9001"],
    ]);
    // 654: two defects counted as one row, the open order, the annual in 13 days, the oil change 1,133 mi out.
    expect(rows[0]!.reasons).toEqual([
      { kind: "defect", count: 2, oldestDetectedAt: "2026-10-01T00:00:00Z" },
      { kind: "work_order", count: 1, oldestOpenedAt: "2026-10-20T00:00:00Z" },
      { kind: "annual", expiresOn: "2026-11-10", daysRemaining: 13 },
      { kind: "pm", name: "Oil Change", pmKind: "oil", verdict: "due", dueOn: null, milesLeft: 1_133 },
    ]);
    // 9001: its annual expired 27 days ago — the overdue reason, and the only one.
    expect(rows[1]!.reasons).toEqual([{ kind: "annual", expiresOn: "2026-10-01", daysRemaining: -27 }]);
  });

  it("does not read the kit while Should carry is hidden", async () => {
    const rec = recorder();
    await readUnitsAttention(rec.client, ORG, NOW);
    expect(rec.queries.map((q) => q.table)).not.toContain("kit_expectations");
  });
});
