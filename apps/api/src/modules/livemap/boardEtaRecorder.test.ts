import { describe, it, expect } from "vitest";
import { recordBoardEtas } from "./boardEtaRecorder.js";
import { readDispatchBoard } from "./dispatchBoard.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * The board's ETA recorder (DISPATCH-BOARD-PLAN DB7, 0453): one row per truck heading to a stop, holding
 * the estimate the board showed and the basis it was made on, keyed so an arrival can be joined to it.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
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
  appointment_start: "2026-10-10T02:00:00Z", appointment_end: "2026-10-10T04:00:00Z", status: "pending",
  external_status: null, actual_arrival_at: null, lat: 39.7684, lon: -86.1581, ...o,
});
const pickup = stop({ seq: 1, kind: "pickup", location_name: "Viking Packing", city: "Joliet", state: "IL",
  appointment_start: "2026-10-09T14:00:00Z", appointment_end: null, external_status: "D",
  actual_arrival_at: "2026-10-09T14:10:00Z", lat: 41.52, lon: -88.08 });

function recorder(o: { vehicles?: unknown[]; positions?: unknown[]; loads?: unknown[]; clocks?: unknown[] } = {}) {
  return createSupabaseRecorder({
    tables: {
      vehicles: { data: o.vehicles ?? [vehicle()] },
      drivers: { data: [{ id: "drv-1", first_name: "Ana", last_name: "Ruiz", samsara_driver_id: "5551" }] },
      vehicle_positions: { data: o.positions ?? [position()] },
      driver_hos_clocks: {
        data: o.clocks ?? [{
          samsara_driver_id: "5551", duty_status: "driving", drive_remaining_ms: 6 * H, shift_remaining_ms: 8 * H,
          cycle_remaining_ms: 40 * H, break_remaining_ms: 3 * H, fetched_at: ago(120),
        }],
      },
      loads: { data: o.loads ?? [load()] },
      load_stops: { data: [pickup, stop()] },
      tms_dispatchers: { data: [] },
      tms_fleets: { data: [] },
      load_stop_eta_predictions: { data: [] },
    },
  });
}

describe("the board's ETA recorder", () => {
  it("records the ETA the board shows for a truck's next stop, keyed by load and stop, with its basis", async () => {
    const rec = recorder();
    const shown = (await readDispatchBoard(rec.client, ORG, "user-1", NOW)).rows[0]!;
    rec.reset();

    expect(await recordBoardEtas(rec.client, ORG, NOW)).toBe(1);
    expect(rec.writtenRows("load_stop_eta_predictions")).toEqual([{
      org_id: ORG,
      load_id: "load-1",
      // The delivery, not the pickup the truck has already left.
      stop_seq: 2,
      vehicle_id: "veh-773",
      predicted_at: NOW.toISOString(),
      eta_at: shown.eta!.at,
      miles: shown.eta!.miles,
      rest_added: false,
      gps_age_seconds: 20,
      hos_known: true,
      window_closes_at: "2026-10-10T04:00:00Z",
      verdict: shown.onTime,
    }]);
  });

  it("says when it had no HOS clocks, since then no rest could have been added", async () => {
    const rec = recorder({ clocks: [] });
    await recordBoardEtas(rec.client, ORG, NOW);
    expect(rec.writtenRows("load_stop_eta_predictions")[0]).toMatchObject({ hos_known: false, rest_added: false });
  });

  it("writes nothing for a truck with no load or no position — there is no estimate to score", async () => {
    const rec = recorder({
      vehicles: [vehicle(), vehicle({ id: "veh-660", unit_number: "660" })],
      positions: [position({ vehicle_id: "veh-660" })],
    });
    expect(await recordBoardEtas(rec.client, ORG, NOW)).toBe(0);
    expect(rec.forTable("load_stop_eta_predictions")).toHaveLength(0);
  });

  it("scopes every read and the write to the org", async () => {
    const rec = recorder();
    await recordBoardEtas(rec.client, ORG, NOW);
    expectOrgScoped(rec, ORG);
  });
});
