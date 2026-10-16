import { describe, it, expect } from "vitest";
import { readDispatchBoard } from "./dispatchBoard.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * The dispatch board's composition (DISPATCH-BOARD-PLAN DB4): one row per non-retired truck, built
 * from five owners' reads, every verdict taken from the shared rules against one clock.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "7e3c1a2b-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-09T20:00:00.000Z");
const H = 3_600_000;
const ago = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();

const vehicle = (o: Record<string, unknown> = {}) => ({
  id: "veh-773", unit_number: "773", status: "active", assigned_driver_id: "drv-1",
  samsara_fuel_percent: "62.0", samsara_fuel_at: ago(300), mcleod_fleet_code: "VINNIEV", ...o,
});
// Joliet, IL — about 180 road miles short of Indianapolis.
const position = (o: Record<string, unknown> = {}) => ({
  vehicle_id: "veh-773", lat: 41.525, lng: -88.0817, heading_degrees: 120, speed_mph: 61, is_ecu_speed: true,
  formatted_location: "Joliet, IL", sampled_at: ago(20), received_at: ago(19), engine_state: "on", ...o,
});
const load = (o: Record<string, unknown> = {}) => ({
  id: "load-1", vehicle_id: "veh-773", driver_id: "drv-1", ref: "291013", status: "in_transit", source: "tms",
  external_status: "P", customer_name: "Viking Packing", dispatcher_external_id: "vinniev",
  drivers: { full_name: "Ana Ruiz" }, trailers: { unit_number: "3152" }, ...o,
});
const stop = (o: Record<string, unknown> = {}) => ({
  load_id: "load-1", seq: 2, kind: "dropoff", name: null, location_name: "Kroger DC", city: "Indianapolis", state: "IN",
  postal_code: "46241", appointment_start: "2026-10-10T02:00:00Z", appointment_end: "2026-10-10T04:00:00Z", status: "pending",
  external_status: null, actual_arrival_at: null, lat: 39.7684, lon: -86.1581, ...o,
});
const pickup = stop({ seq: 1, kind: "pickup", location_name: "Viking Packing", city: "Joliet", state: "IL",
  appointment_start: "2026-10-09T14:00:00Z", appointment_end: null, external_status: "D",
  actual_arrival_at: "2026-10-09T14:10:00Z", lat: 41.52, lon: -88.08 });

function recorder(o: {
  vehicles?: unknown[]; positions?: unknown[]; loads?: unknown[]; stops?: unknown[]; clocks?: unknown[];
  dispatchers?: unknown[]; fleets?: unknown[]; shop?: Record<string, unknown[]>; trailers?: unknown[];
} = {}) {
  return createSupabaseRecorder({
    tables: {
      vehicles: { data: o.vehicles ?? [vehicle()] },
      // Both owners read `drivers` — roster for the name, samsara to resolve its clocks' driver id.
      drivers: { data: [{ id: "drv-1", first_name: "Ana", last_name: "Ruiz", samsara_driver_id: "5551" }] },
      vehicle_positions: { data: o.positions ?? [position()] },
      driver_hos_clocks: {
        data: o.clocks ?? [{
          samsara_driver_id: "5551", duty_status: "driving", drive_remaining_ms: 6 * H, shift_remaining_ms: 8 * H,
          cycle_remaining_ms: 40 * H, break_remaining_ms: 3 * H, fetched_at: ago(120),
        }],
      },
      loads: { data: o.loads ?? [load()] },
      trailers: { data: o.trailers ?? [] },
      fleetpal_units: { data: o.shop?.units ?? [] },
      fleetpal_pm_schedules: { data: o.shop?.schedules ?? [] },
      fleetpal_pm_intervals: { data: o.shop?.intervals ?? [] },
      fleetpal_work_orders: { data: o.shop?.orders ?? [] },
      load_stops: { data: o.stops ?? [pickup, stop()] },
      tms_dispatchers: {
        data: o.dispatchers ?? [
          { external_id: "vinniev", display_name: "vinniev", is_system: false, is_active: true, user_id: USER },
          { external_id: "asen", display_name: "asen", is_system: false, is_active: true, user_id: null },
        ],
      },
      tms_fleets: { data: o.fleets ?? [{ code: "VINNIEV", dispatcher_external_id: "vinniev" }, { code: "VLADI", dispatcher_external_id: null }] },
    },
  });
}

describe("the dispatch board", () => {
  it("composes a truck's driver, clocks, place, load, next stop, ETA and when it empties into one row", async () => {
    const b = await readDispatchBoard(recorder().client, ORG, USER, NOW);
    expect(b.rows).toHaveLength(1);
    const r = b.rows[0]!;
    expect(r).toMatchObject({
      unitNumber: "773", fleetCode: "VINNIEV", inShop: false, fuelPercent: 62,
      driver: { id: "drv-1", name: "Ana Ruiz" },
      hos: { status: "driving", driveRemainingMs: 6 * H },
      position: { place: "Joliet, IL", ageSeconds: 20 },
      current: { ref: "291013", customerName: "Viking Packing", dispatcherId: "vinniev", trailerUnit: "3152", stopsLeft: 1 },
      next: null,
      onTime: "on_time",
      available: { place: "Indianapolis, IN", state: "IN", postalCode: "46241", basis: "appointment" },
      flags: { lateRisk: false, noNextLoad: true, emptyNow: false, hosLow: false, noGps: false, maintenanceOverdue: false },
    });
    // The pickup McLeod has departed is behind the truck; the delivery is next.
    expect(r.current!.nextStop!.name).toBe("Kroger DC");
    expect(r.eta!.miles).toBeGreaterThan(170);
    // One drop: miles left to the delivery are the miles to the next stop.
    expect(r.milesLeft).toBe(r.eta!.miles);
    expect(b.hosAsOf).toBe(ago(120));
  });

  it("chains miles left through a drop on the way, and stops counting at the last delivery", async () => {
    // Joliet → Kokomo, IN (a drop, east of the straight line) → Indianapolis, then a trailer drop back in Joliet.
    const kokomo = stop({ seq: 2, location_name: "Kokomo DC", city: "Kokomo", lat: 40.4864, lon: -86.1336 });
    const indy = stop({ seq: 3 });
    const trailerDrop = stop({ seq: 4, kind: "other", city: "Joliet", state: "IL", lat: 41.52, lon: -88.08 });
    const one = (await readDispatchBoard(recorder().client, ORG, USER, NOW)).rows[0]!;
    const via = (await readDispatchBoard(recorder({ stops: [pickup, kokomo, indy, trailerDrop] }).client, ORG, USER, NOW)).rows[0]!;
    expect(via.current!.nextStop!.name).toBe("Kokomo DC");
    expect(via.milesLeft!).toBeGreaterThan(one.milesLeft!);
    // The trailer drop would add ~150 miles back to Joliet; it is past where the truck is free.
    expect(via.milesLeft!).toBeLessThan(one.milesLeft! + 60);
    expect(via.available).toMatchObject({ city: "Indianapolis", basis: "appointment" });
  });

  it("warns of what is due on the truck and on the current load's trailer, worst first, and calls overdue attention", async () => {
    const MI = 1609.344;
    const rec = recorder({
      // 773's annual expired on our record; FleetPal: its oil is due in ~1,100 mi and a repair order is open,
      // and trailer 3152's 6-month lapsed. A Replace Suction Manifold schedule says nothing.
      vehicles: [vehicle({ dot_annual_inspection_expires_at: "2026-09-30", current_odometer: "118867.0" })],
      loads: [load({ trailer_id: "trl-3152" })],
      trailers: [{ id: "trl-3152", dot_annual_inspection_expires_at: "2027-05-01" }],
      shop: {
        units: [{ fleetpal_id: "fp-773", vehicle_id: "veh-773", trailer_id: null }, { fleetpal_id: "fp-3152", vehicle_id: null, trailer_id: "trl-3152" }],
        schedules: [
          { fleetpal_id: "s1", unit_fleetpal_id: "fp-773", name: "Oil Chnage", last_done: "2026-08-01T00:00:00Z" },
          { fleetpal_id: "s2", unit_fleetpal_id: "fp-3152", name: "6-Month Inspection", last_done: "2026-03-01T00:00:00Z" },
          { fleetpal_id: "s3", unit_fleetpal_id: "fp-773", name: "Replace Suction Manifold", last_done: "2026-01-01T00:00:00Z" },
        ],
        intervals: [
          { pm_schedule_fleetpal_id: "s1", interval_type: "ODOMETER", value_int: 20_000 * MI, value_time_type: null, threshold_int: 7_000 * MI, threshold_time_type: null, last_done_meter_value: 100_000 * MI },
          { pm_schedule_fleetpal_id: "s2", interval_type: "TIME", value_int: 6, value_time_type: "MONTH", threshold_int: 30, threshold_time_type: "DAY", last_done_meter_value: null },
          { pm_schedule_fleetpal_id: "s3", interval_type: "ODOMETER", value_int: 1, value_time_type: null, threshold_int: 1, threshold_time_type: null, last_done_meter_value: 0 },
        ],
        orders: [{ unit_fleetpal_id: "fp-773" }],
      },
    });
    const r = (await readDispatchBoard(rec.client, ORG, USER, NOW)).rows[0]!;
    expect(r.warnings).toEqual([
      { unit: "truck", kind: "annual", verdict: "overdue", dueOn: "2026-09-30", milesLeft: null },
      { unit: "trailer", kind: "six_month", verdict: "overdue", dueOn: "2026-09-01", milesLeft: null },
      { unit: "truck", kind: "oil", verdict: "due", dueOn: null, milesLeft: 1_133 },
      { unit: "truck", kind: "repair_order", verdict: "due", dueOn: null, milesLeft: null },
    ]);
    expect(r.flags.maintenanceOverdue).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("says nothing is due when nothing is — no chips, and no attention for it", async () => {
    const r = (await readDispatchBoard(recorder().client, ORG, USER, NOW)).rows[0]!;
    expect(r.warnings).toEqual([]);
    expect(r.flags.maintenanceOverdue).toBe(false);
  });

  it("returns the caller's scope from the two office links, and every fleet beside it", async () => {
    const b = await readDispatchBoard(recorder().client, ORG, USER, NOW);
    expect(b.scope).toEqual({ linked: true, fleetCodes: ["VINNIEV"], dispatcherIds: ["vinniev"] });
    expect(b.fleets).toEqual([{ code: "VINNIEV", dispatcherId: "vinniev" }, { code: "VLADI", dispatcherId: null }]);
  });

  it("finds a truck's NEXT load — open, planned onto it, not the one being driven", async () => {
    const rec = recorder({
      loads: [load(), load({ id: "load-2", ref: "291386", status: "pending_approval", external_status: "A", dispatcher_external_id: null })],
      stops: [pickup, stop(), stop({ load_id: "load-2", seq: 1, kind: "pickup", appointment_start: "2026-10-10T12:00:00Z" })],
    });
    const r = (await readDispatchBoard(rec.client, ORG, USER, NOW)).rows[0]!;
    expect(r.current!.ref).toBe("291013");
    expect(r.next!.ref).toBe("291386");
    expect(r.flags.noNextLoad).toBe(false);
  });

  it("never offers a second load already ON the truck as its next one — only planned, undispatched work", async () => {
    const rec = recorder({
      loads: [load(), load({ id: "load-3", ref: "291999", status: "approved", external_status: "P" })],
      stops: [pickup, stop(), stop({ load_id: "load-3", seq: 1, kind: "pickup", appointment_start: "2026-10-09T10:00:00Z" })],
    });
    const r = (await readDispatchBoard(rec.client, ORG, USER, NOW)).rows[0]!;
    expect(r.current!.ref).toBe("291013");
    expect(r.next).toBeNull();
  });

  it("counts loads no truck carries, and gives them no row", async () => {
    const rec = recorder({ loads: [load(), load({ id: "load-9", vehicle_id: null, driver_id: null, status: "pending_approval", dispatcher_external_id: null })] });
    const b = await readDispatchBoard(rec.client, ORG, USER, NOW);
    expect(b.uncoveredCount).toBe(1);
    expect(b.rows).toHaveLength(1);
  });

  it("drops a retired truck, keeps a truck in the shop without calling it empty, and hides stale clocks", async () => {
    const rec = recorder({
      vehicles: [vehicle(), vehicle({ id: "veh-660", unit_number: "660", status: "maintenance", assigned_driver_id: null }), vehicle({ id: "veh-550", unit_number: "550", status: "retired" })],
      loads: [],
      clocks: [{ samsara_driver_id: "5551", duty_status: "off_duty", drive_remaining_ms: 11 * H, shift_remaining_ms: 14 * H, cycle_remaining_ms: 60 * H, break_remaining_ms: 8 * H, fetched_at: ago(3600) }],
    });
    const b = await readDispatchBoard(rec.client, ORG, USER, NOW);
    expect(b.rows.map((r) => r.unitNumber)).toEqual(["660", "773"]);
    const shop = b.rows[0]!;
    expect(shop).toMatchObject({ inShop: true, current: null, flags: { emptyNow: false } });
    expect(b.rows[1]!.hos).toBeNull();
    expect(b.rows[1]!.flags.emptyNow).toBe(true);
  });

  it("leaves out a truck McLeod is winding down — 506 on 2026-10-12 — and keeps one not yet reported", async () => {
    const rec = recorder({
      vehicles: [
        vehicle(),
        vehicle({ id: "veh-506", unit_number: "506", assigned_driver_id: null, winding_down: true }),
        vehicle({ id: "veh-552", unit_number: "552", assigned_driver_id: null, winding_down: null }),
        vehicle({ id: "veh-601", unit_number: "601", assigned_driver_id: null, winding_down: false }),
      ],
    });
    const b = await readDispatchBoard(rec.client, ORG, USER, NOW);
    expect(b.rows.map((r) => r.unitNumber)).toEqual(["552", "601", "773"]);
  });

  it("keeps a truck McLeod is winding down while it still holds a load — a load is work", async () => {
    const rec = recorder({
      vehicles: [vehicle({ winding_down: true }), vehicle({ id: "veh-506", unit_number: "506", winding_down: true })],
      loads: [load({ id: "load-2", vehicle_id: "veh-506", ref: "291386", status: "pending_approval", external_status: "A", dispatcher_external_id: null })],
      stops: [stop({ load_id: "load-2", seq: 1, kind: "pickup", appointment_start: "2026-10-10T12:00:00Z" })],
    });
    const b = await readDispatchBoard(rec.client, ORG, USER, NOW);
    // 773 has no load here and is winding down, so it goes; 506's only load is its NEXT one, so it stays.
    expect(b.rows.map((r) => r.unitNumber)).toEqual(["506"]);
    expect(b.rows[0]!.next!.ref).toBe("291386");
  });

  it("keeps a winding-down truck that is carrying a load right now", async () => {
    const b = await readDispatchBoard(recorder({ vehicles: [vehicle({ winding_down: true })] }).client, ORG, USER, NOW);
    expect(b.rows.map((r) => r.current?.ref)).toEqual(["291013"]);
  });

  it("scopes every read to the caller's org", async () => {
    const rec = recorder();
    await readDispatchBoard(rec.client, ORG, USER, NOW);
    expectOrgScoped(rec, ORG);
  });
});
