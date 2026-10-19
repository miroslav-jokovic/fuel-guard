import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { loadEnv } from "../../env.js";
import { routeLengthMiles } from "@silvicom/shared";

/**
 * A load's route on the live map (TRUCK-CARD-ROUTE-PLAN TC3). HERE's route and the border check's
 * reverse geocoder are faked at the module edge; everything else — the load and its stops, the truck,
 * its position, the stations and prices, the solver — runs for real against the recorder.
 */
const here = vi.hoisted(() => ({
  calls: [] as unknown[],
  // Due east from the pickup to the delivery along a parallel, ~690 miles in 30 points.
  route: {
    polyline: Array.from({ length: 30 }, (_, i) => ({ lat: 41.6, lng: -87.6 + i * 0.47 })),
    distanceMeters: 1_110_000, durationSeconds: 40_000, steps: [], cacheKey: "k", cached: true,
  },
  // From a truck up at 42.5 N back down to the delivery: a different road from the planned one.
  live: {
    polyline: Array.from({ length: 12 }, (_, i) => ({ lat: 42.5 - i * 0.08, lng: -86 + i * 0.4 })),
    distanceMeters: 480_000, durationSeconds: 18_000, steps: [], cacheKey: "live", cached: false,
  },
  // Set by a test: the route from the truck fails as it would with no HERE key and a cached planned line.
  liveFails: null as Error | null,
  // Set by a test: the planned route fails too, as every route did while HERE answered 503 (2026-10-16).
  plannedFails: null as Error | null,
}));
vi.mock("../routing/routeGeometry.js", () => ({
  getOrComputeRoute: vi.fn(async (_a: unknown, _e: unknown, req: { origin: { lat: number } }) => {
    here.calls.push(req);
    // Every planned route in these tests starts at the pickup, on 41.6 N; anything else is from the truck.
    if (req.origin.lat === 41.6) {
      if (here.plannedFails) throw here.plannedFails;
      return here.route;
    }
    if (here.liveFails) throw here.liveFails;
    return here.live;
  }),
}));
vi.mock("../../lib/hereGeocode.js", () => ({ hereReverseGeocodeState: vi.fn(async () => null) }));
// The live fuel reading: a truck linked to Samsara whose tank reads 40% a minute ago, and no HOS.
vi.mock("../samsara/lib/samsaraToken.js", () => ({ loadSamsaraToken: vi.fn(async () => "tok") }));
vi.mock("../samsara/lib/samsara.js", () => ({
  makeSamsaraFetcher: () => async () => ({ data: [{ id: "sam-1", fuelPercents: [{ time: new Date(Date.now() - 60_000).toISOString(), value: 40 }] }] }),
  makeSamsaraHosFetcher: () => async () => new Map(),
}));

const { readLoadRoute } = await import("./liveMapLoadRoute.js");
const { HereUnavailableError, NoHereKeyError } = await import("../../lib/here.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LOAD = "11111111-2222-4333-8444-000000000001";
const NOW = new Date("2026-10-09T15:00:00.000Z");
const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  HERE_API_KEY: "test",
} as NodeJS.ProcessEnv);

const stations = Array.from({ length: 10 }, (_, i) => ({
  id: `st-${i}`, brand: i % 2 === 0 ? "pilot" : "loves", store_number: String(100 + i), name: `Stop ${i}`,
  lat: 41.603, lng: -87.6 + (i + 1) * 1.3, state: i < 3 ? "IN" : "OH", exit: String(10 + i), has_diesel: true,
}));

function recorder(o: {
  truckAt?: { lat: number; lng: number } | null; heading?: number | null; hazmat?: boolean; stops?: unknown[]; vehicleId?: string | null;
} = {}) {
  const truckAt = o.truckAt === undefined ? { lat: 41.6, lng: -87.6 + 8.2 * 0.47 } : o.truckAt;
  return createSupabaseRecorder({
    tables: {
      loads: { data: [{ id: LOAD, ref: "0001", vehicle_id: o.vehicleId === undefined ? "veh-1" : o.vehicleId, hazmat: o.hazmat ?? false }] },
      load_stops: {
        data: o.stops ?? [
          // Out of sequence on purpose: the route goes by `seq`, not by row order.
          { seq: 2, kind: "dropoff", name: "ours-2", location_name: "Consignee DC", lat: 41.6, lon: -87.6 + 29 * 0.47 },
          { seq: 1, kind: "pickup", name: "Shipper", location_name: null, lat: 41.6, lon: -87.6 },
        ],
      },
      route_fuel_settings: { data: [] },
      vehicles: { data: [{ id: "veh-1", samsara_vehicle_id: "sam-1", tank_capacity_gal: 200, observed_max_fill_gal: null, baseline_mpg: 6.5, height_in: null, length_in: null, width_in: null, axle_count: null }] },
      trailers: { data: [] },
      vehicle_positions: {
        data: truckAt ? [{ vehicle_id: "veh-1", lat: truckAt.lat, lng: truckAt.lng, heading_degrees: o.heading ?? null, sampled_at: NOW.toISOString() }] : [],
      },
      fuel_stations: (q: RecordedQuery) =>
        q.filters().some((f) => f.col === "id")
          ? stations.map((s) => ({ id: s.id, address: `${s.store_number} Interstate Dr`, city: "Somewhere", zip: "46000" }))
          : stations,
      fuel_prices: { data: stations.map((s, i) => ({ station_id: s.id, net_price: 3.1 + i * 0.03, posted_price: 3.7, observed_at: new Date(NOW.getTime() - 2 * 3_600_000).toISOString() })) },
      fuel_prices_posted: { data: [] },
      fuel_discount_rules: { data: [] },
    },
  });
}

describe("readLoadRoute", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    here.calls.length = 0;
    here.liveFails = null;
    here.plannedFails = null;
  });
  afterEach(() => vi.useRealTimers());

  it("routes pickup → delivery with the fleet's standard truck, by sequence, with no hazmat", async () => {
    await readLoadRoute(recorder().client, env, ORG, LOAD);
    expect(here.calls).toEqual([
      {
        origin: { lat: 41.6, lng: -87.6 }, via: [], destination: { lat: 41.6, lng: -87.6 + 29 * 0.47 },
        // `route_fuel_settings` empty, so the code's standard; the fleet's own row replaces it in production.
        profile: { heightIn: 162, lengthIn: 840, widthIn: 102, axleCount: 5, grossWeightLb: 80000 },
        hazmat: [], tunnelCategory: null, avoidTunnels: false,
      },
    ]);
  });

  it("splits the line at the truck and plans fuel stops only on the part ahead, each with its address", async () => {
    const rec = recorder();
    const answer = await readLoadRoute(rec.client, env, ORG, LOAD);
    if (!answer.ok) throw new Error(answer.message);
    const r = answer.route;
    expectOrgScoped({ ...rec, queries: rec.queries.filter((q) => !["fuel_stations", "fuel_prices_posted"].includes(q.table)) }, ORG);
    expect(r.truckOnRoute).toBe(true);
    expect(r.covered.at(-1)).toEqual(r.ahead[0]);
    expect(r.ahead[0]!.lng).toBeCloseTo(-87.6 + 8.2 * 0.47, 6);
    expect(r.fuelStops.length).toBeGreaterThan(0);
    for (const s of r.fuelStops) {
      // Every stop lies ahead of the truck on the line drawn (D-TC6).
      expect(s.lng).toBeGreaterThan(r.ahead[0]!.lng);
      // ...and its miles are counted from the TRUCK, not from the pickup: the solver ran on the slice.
      expect(Math.abs(s.milesAhead - routeLengthMiles([r.ahead[0]!, { lat: 41.6, lng: s.lng }]))).toBeLessThan(2);
      expect(s.address).toMatch(/Interstate Dr$/);
      expect(s).not.toHaveProperty("netPrice");
    }
    expect(r.hazmatNotApplied).toBe(false);
  });

  it("pins the first and last stop by sequence, named as the board names them (McLeod's place name first)", async () => {
    const answer = await readLoadRoute(recorder().client, env, ORG, LOAD);
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.route.start).toEqual({ lat: 41.6, lng: -87.6, name: "Shipper", kind: "pickup" });
    expect(answer.route.end).toEqual({ lat: 41.6, lng: -87.6 + 29 * 0.47, name: "Consignee DC", kind: "dropoff" });
  });

  it("counts what is still ahead on the line the truck is on, and asks HERE once", async () => {
    const answer = await readLoadRoute(recorder().client, env, ORG, LOAD);
    if (!answer.ok) throw new Error(answer.message);
    const r = answer.route;
    expect(here.calls).toHaveLength(1);
    expect(r.fromTruck).toBe(false);
    expect(r).not.toHaveProperty("planned");
    // The truck is 8.2 of 29 segments along, so a little under three quarters of the trip is left.
    expect(r.aheadMiles).toBeLessThan(r.distanceMiles * 0.75);
    expect(r.aheadMiles).toBeGreaterThan(r.distanceMiles * 0.65);
  });

  it("off the planned line, routes from the truck's fix and heading, and plans fuel on the road it is on", async () => {
    // Nothing marks the pickup done here, so the truck is on its way TO it — Q-TC1's case, now routed.
    const answer = await readLoadRoute(recorder({ truckAt: { lat: 42.5012, lng: -86.0031 }, heading: 97 }).client, env, ORG, LOAD);
    if (!answer.ok) throw new Error(answer.message);
    const r = answer.route;
    expect(here.calls[1]).toMatchObject({
      // Snapped to the 0.01° grid and a 15° heading, so presses minutes apart share a cache row.
      origin: { lat: 42.5, lng: -86 }, originCourseDegrees: 90,
      via: [{ lat: 41.6, lng: -87.6 }], destination: { lat: 41.6, lng: -87.6 + 29 * 0.47 },
    });
    expect(r.truckOnRoute).toBe(false);
    expect(r.fromTruck).toBe(true);
    expect(r.covered).toEqual([]);
    expect(r.ahead).toEqual(here.live.polyline);
    expect(r.planned).toEqual(here.route.polyline);
    // "Still ahead" is the new road's length, not the whole planned trip.
    expect(r.aheadMiles).toBeCloseTo(480_000 / 1609.344, 0);
    expect(r.distanceMiles).toBeGreaterThan(r.aheadMiles);
    expect(r.offRouteMiles).toBeGreaterThan(1);
  });

  it("routes from the truck over the stops it has not reached, skipping one McLeod says it left", async () => {
    const stops = [
      { seq: 1, kind: "pickup", name: "Shipper", lat: 41.6, lon: -87.6, status: "pending", external_status: "D" },
      { seq: 2, kind: "dropoff", name: "Drop 1", lat: 41.9, lon: -84, status: "pending", external_status: null },
      { seq: 3, kind: "dropoff", name: "Drop 2", lat: 41.6, lon: -87.6 + 29 * 0.47, status: "pending", external_status: null },
    ];
    await readLoadRoute(recorder({ stops, truckAt: { lat: 42.5, lng: -86 } }).client, env, ORG, LOAD);
    expect(here.calls[1]).toMatchObject({ via: [{ lat: 41.9, lng: -84 }], destination: { lat: 41.6, lng: -87.6 + 29 * 0.47 }, originCourseDegrees: null });
  });

  it("with no HERE key for the second route, keeps the planned line and says the truck is off it", async () => {
    here.liveFails = new NoHereKeyError();
    const answer = await readLoadRoute(recorder({ truckAt: { lat: 42.5, lng: -86 } }).client, env, ORG, LOAD);
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.route).toMatchObject({ truckOnRoute: false, fromTruck: false, ahead: here.route.polyline });
  });

  it("with HERE not answering for the second route, keeps the planned line rather than failing the whole route", async () => {
    here.liveFails = new HereUnavailableError("HTTP 503");
    const answer = await readLoadRoute(recorder({ truckAt: { lat: 42.5, lng: -86 } }).client, env, ORG, LOAD);
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.route).toMatchObject({ truckOnRoute: false, fromTruck: false, ahead: here.route.polyline });
  });

  it("with HERE not answering for the planned route, answers 503 routing_unavailable, not an unhandled error", async () => {
    here.plannedFails = new HereUnavailableError("HTTP 503");
    const answer = await readLoadRoute(recorder().client, env, ORG, LOAD);
    expect(answer).toMatchObject({ ok: false, status: 503, code: "routing_unavailable" });
    if (!answer.ok) expect(answer.message).toMatch(/not answering/);
  });

  it("draws the route with no position at all, and says nothing about distance off it", async () => {
    const answer = await readLoadRoute(recorder({ truckAt: null }).client, env, ORG, LOAD);
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.route.truckOnRoute).toBe(false);
    expect(answer.route.offRouteMiles).toBeNull();
  });

  it("takes the reefer from the load's own trailer, never from the GPS pairing on trailers", async () => {
    const rec = recorder();
    const answer = await readLoadRoute(rec.client, env, ORG, LOAD);
    if (!answer.ok) throw new Error(answer.message);
    // `trailers.assigned_vehicle_id` agreed with the load's reefer on 0 of 17 trucks (2026-10-19).
    expect(rec.queries.some((q) => q.table === "trailers")).toBe(false);
  });

  it("says a hazmat-marked load is routed without hazmat restrictions, never silently", async () => {
    const answer = await readLoadRoute(recorder({ hazmat: true }).client, env, ORG, LOAD);
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.route.hazmatNotApplied).toBe(true);
  });

  it("refuses a load with fewer than two located stops, and one with no truck, without calling HERE", async () => {
    const one = await readLoadRoute(recorder({ stops: [{ seq: 1, kind: "pickup", lat: 41.6, lon: -87.6 }, { seq: 2, kind: "dropoff", lat: null, lon: null }] }).client, env, ORG, LOAD);
    expect(one).toMatchObject({ ok: false, status: 409, code: "no_route" });
    const none = await readLoadRoute(recorder({ vehicleId: null }).client, env, ORG, LOAD);
    expect(none).toMatchObject({ ok: false, status: 409, code: "no_truck" });
    expect(here.calls).toHaveLength(0);
  });
});
