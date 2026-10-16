import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * The map's driven path (DISPATCH-BOARD-V2-PLAN DBV6): the load's own read through loads, the trail
 * through samsara's index (stubbed here — its request is `vehicleTrailReads.test.ts`'s), the window
 * and the thinning shared's.
 */
const trail = vi.hoisted(() => ({
  calls: [] as Array<{ vehicleId: string; startIso: string; endIso: string }>,
  answer: null as unknown,
  fail: null as Error | null,
}));
vi.mock("../samsara/index.js", () => ({
  readVehicleTrail: vi.fn(async (_a: unknown, _e: unknown, _o: string, vehicleId: string, startIso: string, endIso: string) => {
    trail.calls.push({ vehicleId, startIso, endIso });
    if (trail.fail) throw trail.fail;
    return trail.answer;
  }),
}));

const { readDrivenPath, readDrivenPathCached, __resetDrivenPathCache, DRIVEN_PATH_CACHE_TTL_MS } = await import("./liveMapDrivenPath.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LOAD = "11111111-2222-4333-8444-000000000001";
const NOW = new Date("2026-10-16T16:00:00.000Z");
const env = testEnv({});
// A straight road north, one fix a minute: thinned to its two ends.
const road = Array.from({ length: 30 }, (_, i) => ({ lat: 41 + i * 0.01, lng: -88, time: new Date(NOW.getTime() - (30 - i) * 60_000).toISOString() }));

function recorder(o: { vehicleId?: string | null; first?: Record<string, unknown> } = {}) {
  return createSupabaseRecorder({
    tables: {
      loads: { data: [{ id: LOAD, ref: "291013", vehicle_id: o.vehicleId === undefined ? "veh-1" : o.vehicleId, hazmat: false }] },
      load_stops: { data: [
        { seq: 1, kind: "pickup", name: "Viking", location_name: null, lat: 41, lon: -88, status: "completed", external_status: "D",
          actual_departure_at: "2026-10-15T18:59:00Z", completed_at: null, ...o.first },
        { seq: 2, kind: "dropoff", name: "Kroger", location_name: null, lat: 42, lon: -88, status: "pending", external_status: null,
          actual_departure_at: null, completed_at: null },
      ] },
    },
  });
}

afterEach(() => {
  trail.calls = [];
  trail.answer = { ok: true, points: road };
  trail.fail = null;
  __resetDrivenPathCache();
});
trail.answer = { ok: true, points: road };

describe("readDrivenPath", () => {
  it("draws the truck's GPS since it left the pickup, thinned, and says where it starts", async () => {
    const rec = recorder();
    const a = await readDrivenPath(rec.client, env, ORG, LOAD, NOW);
    expect(trail.calls).toEqual([{ vehicleId: "veh-1", startIso: "2026-10-15T18:59:00.000Z", endIso: NOW.toISOString() }]);
    expect(a).toEqual({ ok: true, path: {
      loadId: LOAD, points: [{ lat: 41, lng: -88 }, { lat: road[29]!.lat, lng: -88 }], since: "2026-10-15T18:59:00.000Z", capped: false, note: null,
    } });
    expectOrgScoped(rec, ORG);
  });

  it("starts at McLeod's departure over the driver app's completion, and at the app's when McLeod has none", async () => {
    await readDrivenPath(recorder({ first: { completed_at: "2026-10-16T02:00:00Z" } }).client, env, ORG, LOAD, NOW);
    expect(trail.calls[0]!.startIso).toBe("2026-10-15T18:59:00.000Z");
    await readDrivenPath(recorder({ first: { actual_departure_at: null, completed_at: "2026-10-16T02:00:00Z" } }).client, env, ORG, LOAD, NOW);
    expect(trail.calls[1]!.startIso).toBe("2026-10-16T02:00:00.000Z");
  });

  it("caps an old load at three days and says so", async () => {
    const a = await readDrivenPath(recorder({ first: { actual_departure_at: "2026-09-28T10:00:00Z" } }).client, env, ORG, LOAD, NOW);
    expect(trail.calls[0]!.startIso).toBe("2026-10-13T16:00:00.000Z");
    expect(a.ok && a.path.capped).toBe(true);
  });

  it("asks Samsara nothing, and says why, before the truck has left the pickup or with no truck on the load", async () => {
    const notLeft = await readDrivenPath(recorder({ first: { actual_departure_at: null } }).client, env, ORG, LOAD, NOW);
    expect(notLeft.ok && notLeft.path).toMatchObject({ points: [], note: expect.stringMatching(/has not left the pickup/) });
    const noTruck = await readDrivenPath(recorder({ vehicleId: null }).client, env, ORG, LOAD, NOW);
    expect(noTruck.ok && noTruck.path).toMatchObject({ points: [], note: "This load has no truck on it." });
    expect(trail.calls).toEqual([]);
  });

  it("says why there is no line when the truck is not linked, Samsara is not connected, or there is no GPS", async () => {
    for (const [answer, words] of [
      [{ ok: false, unavailable: "not_linked" }, /not linked to Samsara/],
      [{ ok: false, unavailable: "no_token" }, /Samsara is not connected/],
      [{ ok: true, points: road.slice(0, 1) }, /no GPS for this truck/],
    ] as const) {
      trail.answer = answer;
      const a = await readDrivenPath(recorder().client, env, ORG, LOAD, NOW);
      expect(a.ok && a.path).toMatchObject({ points: [], since: "2026-10-15T18:59:00.000Z", note: expect.stringMatching(words) });
    }
  });

  it("is a 404 for a load that is not this org's", async () => {
    const rec = createSupabaseRecorder({ tables: { loads: { data: [] }, load_stops: { data: [] } } });
    expect(await readDrivenPath(rec.client, env, ORG, LOAD, NOW)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("readDrivenPathCached — a minute per load", () => {
  const T = NOW.getTime();

  it("answers a second viewer inside the minute from the first read, and reads again after it", async () => {
    await readDrivenPathCached(recorder().client, env, ORG, LOAD, T);
    await readDrivenPathCached(recorder().client, env, ORG, LOAD, T + DRIVEN_PATH_CACHE_TTL_MS - 1);
    expect(trail.calls).toHaveLength(1);
    await readDrivenPathCached(recorder().client, env, ORG, LOAD, T + DRIVEN_PATH_CACHE_TTL_MS);
    expect(trail.calls).toHaveLength(2);
  });

  it("keeps one org's answer from another's, though the load id is the same", async () => {
    await readDrivenPathCached(recorder().client, env, ORG, LOAD, T);
    await readDrivenPathCached(recorder().client, env, "99999999-0000-4000-8000-000000000000", LOAD, T);
    expect(trail.calls).toHaveLength(2);
  });

  it("⚠ does not cache a failed read: the next viewer asks again", async () => {
    trail.fail = new Error("Samsara API 503");
    await expect(readDrivenPathCached(recorder().client, env, ORG, LOAD, T)).rejects.toThrow("503");
    trail.fail = null;
    const a = await readDrivenPathCached(recorder().client, env, ORG, LOAD, T + 1);
    expect(a.ok).toBe(true);
    expect(trail.calls).toHaveLength(2);
  });
});
