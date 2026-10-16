import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * One truck's GPS trail on demand (DISPATCH-BOARD-V2-PLAN DBV6). The token is stubbed; Samsara itself is
 * a stubbed `fetch`, so the request the trail makes — which truck, which window, which lane — is what
 * is asserted, not a fetcher's mock.
 */
const token = vi.hoisted(() => ({ value: "tok" as string | null }));
vi.mock("./lib/samsaraToken.js", () => ({ loadSamsaraToken: vi.fn(async () => token.value) }));
const httpLane = vi.hoisted(() => ({ seen: [] as Array<string | undefined> }));
vi.mock("./lib/samsaraHttp.js", async (orig) => {
  const real = await orig<typeof import("./lib/samsaraHttp.js")>();
  return {
    ...real,
    samsaraFetch: vi.fn((env: unknown, tok: string, url: URL, opts?: { priority?: string }) => {
      httpLane.seen.push(opts?.priority);
      return real.samsaraFetch(env as never, tok, url, opts as never);
    }),
  };
});

const { readVehicleTrail } = await import("./vehicleTrailReads.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = testEnv({ SAMSARA_API_URL: "https://api.samsara.test", SAMSARA_MAX_RETRIES: 0 });
const vehicles = (samsaraId: string | null) =>
  createSupabaseRecorder({ tables: { vehicles: { data: [{ samsara_vehicle_id: samsaraId }] } } });

afterEach(() => {
  vi.unstubAllGlobals();
  token.value = "tok";
  httpLane.seen = [];
});

describe("readVehicleTrail", () => {
  it("asks Samsara for this truck's GPS over the window, in the live lane, and returns it oldest first", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: URL) => {
      urls.push(new URL(String(u)));
      return {
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({ data: [{ id: "281475007431815", gps: [
          { time: "2026-10-16T10:00:12Z", latitude: 41.2, longitude: -87.1 },
          { time: "2026-10-16T10:00:00Z", latitude: 41.1, longitude: -87.0 },
          { time: "2026-10-16T10:00:06Z", latitude: null, longitude: -87.05 },
        ] }] }),
      };
    }));
    const rec = vehicles("281475007431815");
    const trail = await readVehicleTrail(rec.client, env, ORG, "veh-1", "2026-10-15T18:59:00.000Z", "2026-10-16T16:00:00.000Z");
    expect(trail).toEqual({ ok: true, points: [
      { lat: 41.1, lng: -87.0, time: "2026-10-16T10:00:00Z" },
      { lat: 41.2, lng: -87.1, time: "2026-10-16T10:00:12Z" },
    ] });
    expect(urls[0]!.pathname).toBe("/fleet/vehicles/stats/history");
    expect(Object.fromEntries(urls[0]!.searchParams)).toMatchObject({
      vehicleIds: "281475007431815", types: "gps", startTime: "2026-10-15T18:59:00.000Z", endTime: "2026-10-16T16:00:00.000Z",
    });
    // A dispatcher is waiting: the live lane, never the backfill lane's leftovers.
    expect(httpLane.seen).toEqual(["live"]);
    expectOrgScoped(rec, ORG);
  });

  it("says the truck is not linked, without calling Samsara, when it has no Samsara id", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await readVehicleTrail(vehicles(null).client, env, ORG, "veh-1", "a", "b")).toEqual({ ok: false, unavailable: "not_linked" });
    expect(f).not.toHaveBeenCalled();
  });

  it("says Samsara is not connected, without calling it, when the org has no token", async () => {
    token.value = null;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await readVehicleTrail(vehicles("281475007431815").client, env, ORG, "veh-1", "a", "b")).toEqual({ ok: false, unavailable: "no_token" });
    expect(f).not.toHaveBeenCalled();
  });
});
