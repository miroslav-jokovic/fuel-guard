import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { readTruckLoadPlans } from "./truckLoadPlanReads.js";

/**
 * The dispatch board's read of each truck's current load (DISPATCH-BOARD-PLAN DB4). Here only what T1
 * N-7 (D-MK15) adds: a stop McLeod stopped listing keeps its `load_stops` row, so the read must ask for
 * listed stops only, and the board's next stop, stops left and path ahead are computed from those.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const TRUCK = "33333333-3333-4333-8333-333333333333";
const LOAD = "44444444-4444-4444-8444-444444444444";

const stop = (seq: number, over: Record<string, unknown> = {}) => ({
  load_id: LOAD, seq, kind: seq === 1 ? "pickup" : "dropoff", name: `Stop ${seq}`, location_name: null, city: "Howell", state: "MI",
  postal_code: null, appointment_start: null, appointment_end: null, status: "pending", external_status: "A",
  actual_arrival_at: null, lat: null, lon: null, mcleod_removed_at: null, ...over,
});
// The pickup is departed in McLeod; stop 2 was removed in McLeod (stamped, moved to the tail by 0660 —
// here left at 2 so that, read unfiltered, it would be the next stop); stop 3 is where the truck goes.
const STOPS = [stop(1, { external_status: "D" }), stop(2, { mcleod_removed_at: "2026-11-20T15:00:00Z" }), stop(3)];

/** Serve the stops as Postgres would for the filter the read actually applied. */
const servedStops = (q: RecordedQuery) => {
  if (!q.filters().some((f) => f.col === "org_id" && f.val === ORG)) return [];
  const listedOnly = q.filters().some((f) => f.col === "mcleod_removed_at" && f.val === null);
  return STOPS.filter((s) => !listedOnly || s.mcleod_removed_at === null).map(({ mcleod_removed_at: _r, ...rest }) => rest);
};

describe("readTruckLoadPlans — stops McLeod removed", () => {
  it("a stop removed in McLeod is not the board's next stop", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        loads: [{
          id: LOAD, vehicle_id: TRUCK, driver_id: null, ref: "0135527", status: "in_transit", source: "tms", external_status: "P",
          customer_name: null, dispatcher_external_id: null, trailer_id: null, drivers: null, trailers: null,
        }],
        load_stops: servedStops,
      },
    });
    const { byVehicleId } = await readTruckLoadPlans(rec.client, ORG);
    const plan = byVehicleId.get(TRUCK)!;
    expect(plan.current?.nextStop?.seq).toBe(3);
    expect(plan.current?.stopsLeft).toBe(1);
    expect(plan.currentAhead.map((s) => s.seq)).toEqual([3]);
    expectOrgScoped(rec, ORG);
  });
});
