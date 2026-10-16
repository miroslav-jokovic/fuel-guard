import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { loadEnv } from "../../env.js";

/**
 * The route cache's freshness (DISPATCH-BOARD-V2-PLAN §5.2): a row a day old is asked of HERE again
 * and restamped, so one early road choice cannot stand for every load on the same stops.
 */
const here = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../lib/here.js", () => ({
  fetchTruckRoute: vi.fn(async () => {
    here.calls += 1;
    return { polyline: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], distanceMeters: 2000, durationSeconds: 100, steps: [] };
  }),
}));
const { getOrComputeRoute, ROUTE_CACHE_MAX_AGE_MS } = await import("./routeGeometry.js");

const NOW = new Date("2026-10-16T12:00:00.000Z");
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const profile = { heightIn: 162, lengthIn: 840, widthIn: 102, axleCount: 5, grossWeightLb: 80000 };
const req = { origin: { lat: 41.6, lng: -87.6 }, via: [], destination: { lat: 41.6, lng: -74 }, profile, hazmat: [], tunnelCategory: null, avoidTunnels: false };
const cached = (ageMs: number) => ({
  polyline: [{ lat: 9, lng: 9 }], distance_meters: 1000, duration_seconds: 50, actions: [],
  created_at: new Date(NOW.getTime() - ageMs).toISOString(),
});

describe("getOrComputeRoute's cache", () => {
  beforeEach(() => {
    here.calls = 0;
  });

  it("serves a row younger than a day without asking HERE", async () => {
    const rec = createSupabaseRecorder({ tables: { route_geometries: { data: cached(ROUTE_CACHE_MAX_AGE_MS - 60_000) } } });
    const r = await getOrComputeRoute(rec.client, env, req, NOW);
    expect(r.cached).toBe(true);
    expect(r.distanceMeters).toBe(1000);
    expect(here.calls).toBe(0);
  });

  it("asks HERE again for a row older than a day, and restamps it so the next day starts from now", async () => {
    const rec = createSupabaseRecorder({ tables: { route_geometries: { data: cached(ROUTE_CACHE_MAX_AGE_MS + 60_000) } } });
    const r = await getOrComputeRoute(rec.client, env, req, NOW);
    expect(here.calls).toBe(1);
    expect(r.cached).toBe(false);
    expect(r.distanceMeters).toBe(2000);
    expect(rec.writtenRows("route_geometries")[0]).toMatchObject({ distance_meters: 2000, created_at: NOW.toISOString() });
  });

  it("keys a route from a truck by its heading too, and a route between stops exactly as before", async () => {
    const rec = createSupabaseRecorder({ tables: { route_geometries: { data: null } } });
    const a = await getOrComputeRoute(rec.client, env, req, NOW);
    const b = await getOrComputeRoute(rec.client, env, { ...req, originCourseDegrees: 90 }, NOW);
    const c = await getOrComputeRoute(rec.client, env, { ...req, originCourseDegrees: null }, NOW);
    expect(b.cacheKey).not.toBe(a.cacheKey);
    expect(c.cacheKey).toBe(a.cacheKey);
  });
});
