import { beforeEach, describe, expect, it } from "vitest";
import { __resetDispatchBoardCaches, readDispatchBoard } from "./dispatchBoard.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * What each load pays, on the dispatch board (LOAD-RATES-PLAN D-RATE7): added per reader AFTER the org's
 * row cache, and only for a reader the route found holding `dispatch.load_rates`. Anyone else's current
 * and next loads carry no `charges` key at all — even when the cache was warmed by a holder.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-09T20:00:00.000Z");
const DISPATCHER = { userId: "7e3c1a2b-0000-4000-8000-000000000001", role: "dispatcher" as const, sections: null };

const load = (o: Record<string, unknown>) => ({
  id: "load-1", vehicle_id: "veh-773", driver_id: "drv-1", ref: "291013", status: "in_transit", source: "tms",
  external_status: "P", customer_name: "Viking Packing", dispatcher_external_id: null,
  drivers: { full_name: "Ana Ruiz" }, trailers: null, ...o,
});
const stop = (o: Record<string, unknown>) => ({
  load_id: "load-1", seq: 2, kind: "dropoff", name: null, location_name: "Kroger DC", city: "Indianapolis", state: "IN",
  postal_code: "46241", appointment_start: "2026-10-10T02:00:00Z", appointment_end: null, status: "pending",
  external_status: null, actual_arrival_at: null, lat: 39.7684, lon: -86.1581, ...o,
});

// PostgREST answers `numeric` as a string; the reader turns it back into a number.
const PRICE_1 = {
  load_id: "load-1", org_id: ORG, total_charge: "4580.00", linehaul: "4200.00", other_charges: "380.00", currency: "USD",
  billed_miles: "1982.0", order_loaded_movements: 1,
};

function recorder() {
  return createSupabaseRecorder({
    tables: {
      vehicles: { data: [{ id: "veh-773", unit_number: "773", status: "active", assigned_driver_id: "drv-1", mcleod_fleet_code: null }] },
      drivers: { data: [{ id: "drv-1", full_name: "Ana Ruiz", status: "active" }] },
      vehicle_positions: { data: [] },
      driver_hos_clocks: { data: [] },
      loads: {
        data: [load({}), load({ id: "load-2", ref: "291386", status: "pending_approval", external_status: "A" })],
      },
      load_stops: { data: [stop({}), stop({ load_id: "load-2", seq: 1, kind: "pickup", appointment_start: "2026-10-10T12:00:00Z" })] },
      // load-2 is an empty movement: McLeod states no price for it, so it has no row (D-RATE3).
      load_charges: { data: [PRICE_1] },
      tms_dispatchers: { data: [] },
      tms_fleets: { data: [] },
    },
    rpc: { org_module_enabled: false },
  });
}

describe("load rates on the dispatch board (D-RATE7)", () => {
  beforeEach(() => __resetDispatchBoardCaches());

  it("gives a holder each load's price, and null for a load McLeod states none for", async () => {
    const rec = recorder();
    const r = (await readDispatchBoard(rec.client, ORG, { ...DISPATCHER, readsRates: true }, NOW)).rows[0]!;
    expect(r.current!.charges).toEqual({
      total_charge: 4580, linehaul: 4200, other_charges: 380, currency: "USD", billed_miles: 1982, order_loaded_movements: 1,
    });
    expect(r.next!.ref).toBe("291386");
    expect(r.next!.charges).toBeNull();
    // One read, of the board's two loads, scoped to the org (the service role bypasses RLS).
    const reads = rec.forTable("load_charges");
    expect(reads).toHaveLength(1);
    expect(reads[0]!.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }]));
    expect(JSON.stringify(reads[0]!.ops)).toContain("load-2");
    expectOrgScoped(rec, ORG);
  });

  it("sends a reader without the switch no `charges` key and never reads the prices", async () => {
    const rec = recorder();
    const r = (await readDispatchBoard(rec.client, ORG, DISPATCHER, NOW)).rows[0]!;
    expect(r.current).not.toHaveProperty("charges");
    expect(r.next).not.toHaveProperty("charges");
    expect(rec.forTable("load_charges")).toHaveLength(0);
  });

  it("never lets a holder's request leave a price in the org's 20-second row cache", async () => {
    const rec = recorder();
    await readDispatchBoard(rec.client, ORG, { ...DISPATCHER, readsRates: true }, NOW);
    // Same org, same instant: the rows come from the cache the holder's request just built.
    const r = (await readDispatchBoard(rec.client, ORG, DISPATCHER, NOW)).rows[0]!;
    expect(r.current).not.toHaveProperty("charges");
    expect(r.next).not.toHaveProperty("charges");
  });
});
