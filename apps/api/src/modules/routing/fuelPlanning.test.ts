import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import type { Env } from "../../env.js";

/**
 * The fuel planner's characterisation (TRUCK-CARD-ROUTE-PLAN TC3, D-TC6). Until 2026-10-09 the planning
 * path had NO tests (routing/index.ts says so), and TC3 splits `planFuelRoute` into "route" and "solve
 * on a given line" so the live map can plan fuel on the remaining slice of a load's route. This pins the
 * whole answer the Fuel planning page gets — stops, gallons, costs, flags, the route view — on a fixed
 * line, fixed stations and prices, and a manual fuel level, so the split is proven to move nothing.
 *
 * Vendors are faked at the module edge: HERE's route (`getOrComputeRoute`) returns a fixed line, the
 * border check's reverse geocoder answers "no state" (no border top-off), and the truck has no Samsara
 * link, so the planner takes the manual-fuel path — the one path that needs no live vendor at all.
 */
const route = vi.hoisted(() => {
  // Due east from Chicago along a parallel, ~690 miles in 30 points: long enough to need a fill.
  const polyline = Array.from({ length: 30 }, (_, i) => ({ lat: 41.6, lng: -87.6 + i * 0.47 }));
  return { polyline, distanceMeters: 1_110_000, durationSeconds: 40_000, steps: [{ instruction: "Head east on I-80. Go for 1110 km.", lengthMeters: 1_110_000 }], cacheKey: "k", cached: true };
});
vi.mock("./routeGeometry.js", () => ({ getOrComputeRoute: vi.fn(async () => route) }));
vi.mock("../../lib/hereGeocode.js", () => ({ hereReverseGeocodeState: vi.fn(async () => null) }));

const { planFuelRoute } = await import("./fuelPlanning.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-09T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

/** Stations a few hundred metres north of the line every ~70 miles, alternating brands, each with a price. */
const stations = Array.from({ length: 10 }, (_, i) => ({
  id: `st-${i}`,
  brand: i % 2 === 0 ? "pilot" : "loves",
  store_number: String(100 + i),
  name: `Stop ${i}`,
  lat: 41.603,
  lng: -87.6 + (i + 1) * 1.3,
  state: i < 3 ? "IN" : "OH",
  exit: String(10 + i),
  has_diesel: true,
}));

function recorder() {
  return createSupabaseRecorder({
    tables: {
      route_fuel_settings: { data: [] },
      vehicles: {
        data: [{ id: "veh-1", samsara_vehicle_id: null, tank_capacity_gal: 200, observed_max_fill_gal: null, baseline_mpg: 6.5, height_in: null, length_in: null, width_in: null, axle_count: null }],
      },
      trailers: { data: [] },
      fuel_stations: { data: stations },
      fuel_prices: { data: stations.map((s, i) => ({ station_id: s.id, net_price: 3.1 + i * 0.03, posted_price: 3.7 + i * 0.03, observed_at: hoursAgo(2) })) },
      fuel_prices_posted: { data: [] },
      fuel_discount_rules: { data: [] },
    },
  });
}

const env = { HERE_API_KEY: "test" } as unknown as Env;
const request = {
  vehicleId: "veh-1",
  origin: { lat: 41.6, lng: -87.6 },
  destination: { lat: 41.6, lng: -87.6 + 29 * 0.47 },
  manualFuelPct: 45,
  manualHos: { driveHours: 11, breakHours: 8, shiftHours: 14, cycleHours: 70 },
};

describe("planFuelRoute — the Fuel planning page's answer, pinned before TC3 splits it", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("plans fuel stops on a fixed line from a manual fuel level, every read scoped to the org", async () => {
    const rec = recorder();
    const result = await planFuelRoute(rec.client, env, ORG, request);
    // Global tables (stations, posted prices) are org-agnostic by design; everything org-owned is scoped.
    expectOrgScoped({ ...rec, queries: rec.queries.filter((q) => !["fuel_stations", "fuel_prices_posted"].includes(q.table)) }, ORG);
    expect(result.status).toBe("ok");
    expect(result.manualFuelUsed).toBe(true);
    expect(result.plan!.stops.length).toBeGreaterThan(0);
    expect(result).toMatchSnapshot();
  });

  it("says why it cannot plan when the truck has no link and no manual fuel level", async () => {
    const result = await planFuelRoute(recorder().client, env, ORG, { ...request, manualFuelPct: null });
    expect(result.status).toBe("telematics_unavailable");
    expect(result.telematicsReason).toBe("not_linked");
    expect(result.route?.distanceMiles).toBeGreaterThan(0);
  });
});
