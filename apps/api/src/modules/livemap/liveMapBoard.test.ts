import { describe, it, expect } from "vitest";
import { readLiveMapBoard, FLEET_WIDE_SCOPE_REASON } from "./liveMapBoard.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-09-15T18:00:00.000Z");
const agoSec = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();

const position = (o: Record<string, unknown> = {}) => ({
  vehicle_id: "veh-1",
  lat: 44.51,
  lng: -88.01,
  heading_degrees: 275,
  speed_mph: 62,
  is_ecu_speed: true,
  formatted_location: "Green Bay, WI",
  sampled_at: agoSec(5),
  received_at: agoSec(4),
  ...o,
});

const vehicle = (o: Record<string, unknown> = {}) => ({
  id: "veh-1",
  unit_number: "1207",
  status: "active",
  assigned_driver_id: "drv-1",
  ...o,
});

function recorder(opts: {
  positions?: unknown[];
  vehicles?: unknown[];
  drivers?: unknown[];
  loads?: unknown[];
  stops?: unknown[];
} = {}) {
  return createSupabaseRecorder({
    tables: {
      vehicle_positions: { data: opts.positions ?? [position()] },
      vehicles: { data: opts.vehicles ?? [vehicle()] },
      drivers: { data: opts.drivers ?? [{ id: "drv-1", first_name: "Ana", last_name: "Ruiz" }] },
      loads: { data: opts.loads ?? [] },
      load_stops: { data: opts.stops ?? [] },
    },
  });
}

const board = (rec: ReturnType<typeof recorder>) => readLiveMapBoard(rec.client, ORG, { now: NOW });

describe("the live map board", () => {
  it("joins a truck's position, identity and driver into one marker", async () => {
    const rec = recorder();
    const b = await board(rec);
    expect(b.vehicles).toHaveLength(1);
    expect(b.vehicles[0]).toMatchObject({
      vehicleId: "veh-1",
      unitNumber: "1207",
      driver: { id: "drv-1", name: "Ana Ruiz" },
      state: "moving",
      ageSeconds: 5,
      load: null,
    });
    expect(b.vehicles[0]!.position).toMatchObject({
      lat: 44.51,
      lng: -88.01,
      headingDegrees: 275,
      speedMph: 62,
      isEcuSpeed: true,
      formattedLocation: "Green Bay, WI",
    });
  });

  // The service role bypasses RLS, so the `.eq("org_id", …)` on every read is the ONLY tenant
  // boundary this endpoint has.
  it("scopes every read to the caller's org", async () => {
    const rec = recorder({ loads: [{ id: "load-1", vehicle_id: "veh-1", ref: "L-1", status: "in_transit" }] });
    await board(rec);
    expectOrgScoped(rec, ORG);
  });

  // ⚠ The state that matters most for LM6: `loads` has 0 rows in production and will until LM12.
  it("returns every truck with null load context when there are no loads at all", async () => {
    const rec = recorder({
      positions: [position(), position({ vehicle_id: "veh-2" })],
      vehicles: [vehicle(), vehicle({ id: "veh-2", unit_number: "1208", assigned_driver_id: null })],
    });
    const b = await board(rec);
    expect(b.vehicles).toHaveLength(2);
    expect(b.vehicles.every((v) => v.load === null)).toBe(true);
    // ...and it must not have asked `load_stops` anything, because there were no loads to ask about.
    expect(rec.forTable("load_stops")).toHaveLength(0);
  });

  it("carries the live load and its next stop when the feed is on", async () => {
    const rec = recorder({
      loads: [{ id: "load-1", vehicle_id: "veh-1", ref: "L-4417", status: "in_transit" }],
      stops: [
        { load_id: "load-1", seq: 1, kind: "pickup", name: "Shipper", city: "Chicago", state: "IL", appointment_start: null, appointment_end: null, status: "completed" },
        { load_id: "load-1", seq: 2, kind: "dropoff", name: "Consignee", city: "Green Bay", state: "WI", appointment_start: agoSec(-3600), appointment_end: null, status: "pending" },
      ],
    });
    const b = await board(rec);
    expect(b.vehicles[0]!.load).toMatchObject({ id: "load-1", ref: "L-4417", status: "in_transit" });
    // The next stop is the first one NOT already worked — a completed pickup is behind the truck.
    expect(b.vehicles[0]!.load!.nextStop).toMatchObject({ seq: 2, kind: "dropoff", city: "Green Bay" });
  });

  it("reports no next stop when every stop is behind the truck", async () => {
    const rec = recorder({
      loads: [{ id: "load-1", vehicle_id: "veh-1", ref: "L-1", status: "accepted" }],
      stops: [
        { load_id: "load-1", seq: 1, kind: "pickup", name: null, city: null, state: null, appointment_start: null, appointment_end: null, status: "completed" },
        { load_id: "load-1", seq: 2, kind: "dropoff", name: null, city: null, state: null, appointment_start: null, appointment_end: null, status: "skipped" },
      ],
    });
    const b = await board(rec);
    expect(b.vehicles[0]!.load!.nextStop).toBeNull();
  });

  it("computes every truck's state against ONE clock, not one read per truck", async () => {
    const rec = recorder({
      positions: [
        position({ vehicle_id: "veh-1", speed_mph: 62, sampled_at: agoSec(5) }),
        position({ vehicle_id: "veh-2", speed_mph: 0, sampled_at: agoSec(5) }),
        position({ vehicle_id: "veh-3", speed_mph: 0, sampled_at: agoSec(400) }),
        position({ vehicle_id: "veh-4", speed_mph: 0, sampled_at: agoSec(4000) }),
      ],
      vehicles: [
        vehicle({ id: "veh-1" }),
        vehicle({ id: "veh-2", unit_number: "2" }),
        vehicle({ id: "veh-3", unit_number: "3" }),
        vehicle({ id: "veh-4", unit_number: "4" }),
      ],
    });
    const b = await board(rec);
    expect(b.vehicles.map((v) => v.state)).toEqual(["moving", "stopped", "parked", "offline"]);
    expect(b.generatedAt).toBe(NOW.toISOString());
  });

  // D-LM3/D-LM18: fleet-wide until McLeod grants the dispatcher on each load. The banner is required
  // — a dispatcher who thinks they are seeing only their trucks will mis-read an empty column.
  it("says the scope is the whole fleet, and says why, rather than faking a personal scope", async () => {
    const b = await board(recorder());
    expect(b.scope).toBe("all");
    expect(b.scopeReason).toBe(FLEET_WIDE_SCOPE_REASON);
    expect(b.scopeReason).toMatch(/every truck/i);
  });

  it("sends the bounds its states were computed with, so a legend needs no second copy", async () => {
    const b = await board(recorder());
    expect(b.bounds).toEqual({ stoppedSpeedMph: 3, engineOnBoundSeconds: 30, offlineBoundSeconds: 900 });
  });

  // A dot with no unit number is something a dispatcher cannot act on. LM4 already counts this case
  // where it can be fixed.
  it("skips a position whose vehicle the roster does not carry", async () => {
    const rec = recorder({
      positions: [position(), position({ vehicle_id: "ghost" })],
      vehicles: [vehicle()],
    });
    const b = await board(rec);
    expect(b.vehicles.map((v) => v.vehicleId)).toEqual(["veh-1"]);
  });

  it("shows a truck with nobody on it rather than hiding it", async () => {
    const rec = recorder({ vehicles: [vehicle({ assigned_driver_id: null })], drivers: [] });
    const b = await board(rec);
    expect(b.vehicles[0]!.driver).toBeNull();
    // No driver ids to resolve means the drivers table is never asked.
    expect(rec.forTable("drivers")).toHaveLength(0);
  });

  it("names a driver whose roster row has only one half of a name", async () => {
    const rec = recorder({ drivers: [{ id: "drv-1", first_name: "Ana", last_name: null }] });
    expect((await board(rec)).vehicles[0]!.driver!.name).toBe("Ana");
  });

  it("falls back rather than rendering a blank where a person should be", async () => {
    const rec = recorder({ drivers: [{ id: "drv-1", first_name: null, last_name: null }] });
    expect((await board(rec)).vehicles[0]!.driver!.name).toBe("Unnamed driver");
  });

  it("shows a truck whose unit number is missing, with a placeholder to go fix", async () => {
    const rec = recorder({ vehicles: [vehicle({ unit_number: "  " })] });
    expect((await board(rec)).vehicles[0]!.unitNumber).toBe("—");
  });

  it("is not truncated at this fleet size, and says so", async () => {
    expect((await board(recorder())).truncated).toBe(false);
  });

  // ⚠ `supabaseRecorder` RECORDS filters, it does not APPLY them — a flat fixture answers every
  // query with every row. So the assertions above prove the board's ASSEMBLY and prove nothing about
  // its WHERE clauses; dropping the status filter entirely would leave all of them green. These two
  // read the recorded filters directly, which is the only way to pin a predicate with this fake.
  it("asks `loads` only for statuses that mean the load is on a truck now", async () => {
    const rec = recorder({ loads: [{ id: "l", vehicle_id: "veh-1", ref: null, status: "in_transit" }] });
    await board(rec);
    const q = rec.forTable("loads")[0]!;
    const statuses = q.ops.find((o) => o.method === "in" && o.args[0] === "status")?.args[1];
    expect(statuses).toEqual(["accepted", "in_transit"]);
    // A draft or offered load is not what a truck is doing, and delivered/canceled are finished.
    expect(statuses).not.toContain("draft");
    expect(statuses).not.toContain("delivered");
  });

  it("asks `drivers` only for the ids its own vehicles named", async () => {
    const rec = recorder({
      positions: [position(), position({ vehicle_id: "veh-2" })],
      vehicles: [vehicle(), vehicle({ id: "veh-2", unit_number: "2", assigned_driver_id: "drv-2" })],
      drivers: [{ id: "drv-1", first_name: "Ana", last_name: "Ruiz" }],
    });
    await board(rec);
    const q = rec.forTable("drivers")[0]!;
    expect(q.ops.find((o) => o.method === "in" && o.args[0] === "id")?.args[1]).toEqual(["drv-1", "drv-2"]);
  });

  it("returns an empty board, not an error, before the collector has stored anything", async () => {
    const rec = recorder({ positions: [] });
    const b = await board(rec);
    expect(b.vehicles).toEqual([]);
    expect(b.scope).toBe("all");
    expect(b.generatedAt).toBe(NOW.toISOString());
  });
});
