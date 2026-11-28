import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadSpan } from "@silvicom/shared";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * An Out of route warning on our map (OUT-OF-ROUTE-MAP-ANALYSIS option A, D-ORM1–6). Each owner's read
 * is stubbed at its index — their own requests are their own tests' — so what is proven here is the
 * composition: which load, which lines, from where, and that a vendor outage is a note and not a 500.
 * Synthetic geometry: the repository is public, and a real trace is a driver's movements.
 */
const H = 3_600_000;
const ALERT = Date.parse("2026-11-20T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
// The planned line runs east on 40 N; the truck drives it, wanders 10 mi north for 20 min, and comes back.
const PICKUP = { lat: 40, lng: -91 };
const DELIVERY = { lat: 40, lng: -88 };
const fakeLine = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
  Array.from({ length: 31 }, (_, i) => ({ lat: from.lat + ((to.lat - from.lat) * i) / 30, lng: from.lng + ((to.lng - from.lng) * i) / 30 }));
const trailPoints = Array.from({ length: 90 }, (_, i) => {
  const t = ALERT - 45 * 60_000 + i * 60_000;
  const wander = t >= ALERT - 5 * 60_000 && t < ALERT + 15 * 60_000;
  return { lat: wander ? 40 + 10 / 69 : 40, lng: -90 + i * 0.005, time: iso(t) };
});

const s = vi.hoisted(() => ({
  trail: null as unknown,
  spans: [] as LoadSpan[],
  load: null as unknown,
  routeCalls: [] as Array<{ origin: { lat: number; lng: number }; destination: { lat: number; lng: number } }>,
  routeFails: null as Error | null,
}));
vi.mock("../samsara/index.js", () => ({ readVehicleTrail: vi.fn(async () => s.trail), readVehiclePositions: vi.fn() }));
vi.mock("../loads/index.js", () => ({ readTruckLoadSpans: vi.fn(async () => s.spans), readLoadForRoute: vi.fn(async () => s.load) }));
vi.mock("../routing/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../routing/index.js")>()),
  getOrComputeRoute: vi.fn(async (_a: unknown, _e: unknown, req: { origin: { lat: number; lng: number }; destination: { lat: number; lng: number } }) => {
    s.routeCalls.push(req);
    if (s.routeFails) throw s.routeFails;
    return { polyline: fakeLine(req.origin, req.destination), distanceMeters: 1, durationSeconds: 1, steps: [], cacheKey: "k", cached: true };
  }),
}));

const { readOffRouteView, readOffRouteViewCached, __resetOffRouteCache } = await import("./offRouteView.js");
const { HereUnavailableError } = await import("../../lib/here.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = testEnv({});
// The truck's planning row is read for real (`loadPlanningTruck`): the fleet's default profile, no overrides.
const admin = createSupabaseRecorder({
  tables: {
    route_fuel_settings: [],
    vehicles: [{ id: "veh-1", samsara_vehicle_id: "s-v", tank_capacity_gal: 150, observed_max_fill_gal: null, baseline_mpg: 6.5, height_in: null, length_in: null, width_in: null, axle_count: null }],
  },
}).client;
const query = { vehicleId: "veh-1", happenedAt: iso(ALERT), endedAt: iso(ALERT + 15 * 60_000), stillActive: false, thresholdMeters: 9656 };
const NOW = ALERT + 48 * H;
const loadOf = (departedAt: string | null) => ({
  id: "L1", ref: "0138883", vehicleId: "veh-1", hazmat: false, unlocatedStops: 0, trailerIsReefer: false, departedAt,
  stops: [{ seq: 1, kind: "pickup", name: "Shipper", ...PICKUP, behind: true }, { seq: 2, kind: "dropoff", name: "Consignee", ...DELIVERY, behind: false }],
});

beforeEach(() => {
  s.trail = { ok: true, points: trailPoints };
  s.spans = [{ loadId: "L1", startMs: ALERT - 10 * H, endMs: ALERT + 10 * H }];
  s.load = loadOf(iso(ALERT - 9 * H));
  s.routeCalls = [];
  s.routeFails = null;
  __resetOffRouteCache();
});

describe("readOffRouteView", () => {
  it("draws the load's route and judges the path against Samsara's own six miles", async () => {
    const v = await readOffRouteView(admin, env, ORG, query, NOW);
    expect(s.routeCalls.map((c) => [c.origin, c.destination])).toEqual([[PICKUP, DELIVERY]]);
    expect(v.planned).toMatchObject({ loadRef: "0138883", relation: "on_load", toPickup: null });
    expect(v.thresholdMiles).toBeCloseTo(6, 1);
    expect(v.verdict).toMatchObject({ state: "back", left: { at: iso(ALERT - 5 * 60_000) }, back: { at: iso(ALERT + 15 * 60_000) } });
    expect(v.window).toEqual({ start: iso(ALERT - 45 * 60_000), end: iso(ALERT + 35 * 60_000), capped: false });
    expect(v.notes).toEqual([]);
  });

  it("before the pickup, routes the way to it from the truck's first fix, snapped to the shared grid", async () => {
    s.load = loadOf(null);
    const v = await readOffRouteView(admin, env, ORG, query, NOW);
    expect(s.routeCalls[1]).toMatchObject({ origin: { lat: 40, lng: -90 }, destination: PICKUP });
    expect(v.planned?.relation).toBe("to_pickup");
    expect(v.planned?.toPickup?.length).toBeGreaterThan(1);
  });

  it("with no load at all, draws the path alone and says why", async () => {
    s.spans = [];
    const v = await readOffRouteView(admin, env, ORG, query, NOW);
    expect([v.planned, v.verdict, v.notes]).toEqual([null, null, ["There was no load on this truck at that time."]]);
    expect(v.path.length).toBeGreaterThan(1);
  });

  it("says the routing service is down instead of failing, and still draws the path and the stops", async () => {
    s.routeFails = new HereUnavailableError("HTTP 503");
    const v = await readOffRouteView(admin, env, ORG, query, NOW);
    expect(v.planned).toMatchObject({ route: null, stops: [{ name: "Shipper" }, { name: "Consignee" }] });
    expect(v.verdict).toBeNull();
    expect(v.notes).toEqual(["The routing service is not answering, so the planned route cannot be drawn right now."]);
  });

  it("lets any other routing failure surface — it would be a bug, not an outage", async () => {
    s.routeFails = new Error("HERE routing 400: bad request");
    await expect(readOffRouteView(admin, env, ORG, query, NOW)).rejects.toThrow(/400/);
  });

  it("says a truck Samsara does not know cannot be drawn", async () => {
    s.trail = { ok: false, unavailable: "not_linked" };
    const v = await readOffRouteView(admin, env, ORG, query, NOW);
    expect(v.path).toEqual([]);
    expect(v.notes).toContain("This truck is not linked to Samsara, so where it drove cannot be drawn.");
  });
});

describe("readOffRouteViewCached", () => {
  it("answers a second open within a minute from the first read, per org and warning", async () => {
    await readOffRouteViewCached(admin, env, ORG, "w1", query, NOW);
    await readOffRouteViewCached(admin, env, ORG, "w1", query, NOW + 30_000);
    expect(s.routeCalls).toHaveLength(1);
    await readOffRouteViewCached(admin, env, ORG, "w1", query, NOW + 61_000);
    await readOffRouteViewCached(admin, env, "another-org", "w1", query, NOW + 61_000);
    expect(s.routeCalls).toHaveLength(3);
  });
});
