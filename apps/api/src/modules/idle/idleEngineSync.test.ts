import { describe, expect, it } from "vitest";
import { IN_SERVICE_VEHICLE_STATUSES } from "@silvicom/shared";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import type { StatsHistoryFetcher, StatsSnapshotFetcher } from "../samsara/lib/samsaraStatsHistory.js";
import { syncIdleEngine } from "./idleEngineSync.js";

/**
 * The idle engine's collector (IE2). The classifier is pinned in `@silvicom/shared`; what is only
 * testable here is what the collector ASKS Samsara for, which window it replaces, what it carries in
 * (a stored park, a snapshot seed), when it refuses to write, and that every read is the org's.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const iso = (ms: number) => new Date(ms).toISOString();

const V1 = { id: "v650", samsara_vehicle_id: "s650" };
const V2 = { id: "v661", samsara_vehicle_id: "s661" };

interface Call {
  ids: string[];
  types: string[];
  start: string;
  end: string;
}

/** A fake Samsara: per vehicle, whatever series the test gives, filtered to the asked window. */
function samsara(series: Record<string, Record<string, { time: string; [k: string]: unknown }[]>>, o: { incomplete?: boolean } = {}) {
  const calls: Call[] = [];
  const history: StatsHistoryFetcher = async (ids, types, start, end) => {
    calls.push({ ids, types, start, end });
    const data = ids.map((id) => {
      const rec: Record<string, unknown> = { id };
      for (const t of types)
        rec[t] = (series[id]?.[t] ?? []).filter((x) => x.time >= start && x.time <= end);
      return rec;
    });
    return { data, complete: !o.incomplete, pages: 1 };
  };
  return { calls, history };
}

function recorder(o: { jobs?: unknown[]; stops?: unknown[]; minIdle?: number } = {}) {
  return createSupabaseRecorder({
    tables: {
      organizations: [{ operating_hours: { tz: "America/Chicago" } }],
      idle_settings: [{ min_idle_minutes: o.minIdle ?? 5 }],
      vehicles: [V1, V2],
      jobs: o.jobs ?? [],
      idle_engine_stops: o.stops ?? [],
    },
    rpc: { idle_engine_write: { hours: 0, stops: 0, days: 0 } },
  });
}

const noSnapshot: StatsSnapshotFetcher = async () => [];
const writes = (rec: ReturnType<typeof recorder>) =>
  rec.rpcs().filter((r) => r.fn === "idle_engine_write").map((r) => r.args as Record<string, unknown>);

// 09:20 Chicago (CDT) on 10/02 — an hourly run.
const MORNING = Date.parse("2026-10-02T14:20:00Z");

describe("syncIdleEngine — the window", () => {
  it("an hourly run replaces the trailing three whole hours in the org's zone", async () => {
    const rec = recorder();
    const s = samsara({});
    const r = await syncIdleEngine(rec.client as never, env, ORG, { nowMs: MORNING, historyFetcher: s.history, snapshotFetcher: noSnapshot });
    expect(r).toMatchObject({ mode: "hourly", from: "2026-10-02T11:00:00.000Z", to: "2026-10-02T14:00:00.000Z", vehicles: 2, batches: 1 });
    const [w] = writes(rec);
    expect(w).toMatchObject({ p_org: ORG, p_vehicles: ["v650", "v661"], p_from: "2026-10-02T11:00:00.000Z", p_to: "2026-10-02T14:00:00.000Z", p_tz: "America/Chicago" });
    expect((w!.p_hours as unknown[]).length).toBe(6);
  });

  it("asks for engine and counters a day back, GPS only a quarter-hour back, all up to now", async () => {
    const rec = recorder();
    const s = samsara({});
    await syncIdleEngine(rec.client as never, env, ORG, { nowMs: MORNING, historyFetcher: s.history, snapshotFetcher: noSnapshot });
    const by = (t: string) => s.calls.find((c) => c.types.includes(t))!;
    expect(by("engineStates")).toMatchObject({ start: "2026-10-01T11:00:00.000Z", end: iso(MORNING) });
    expect(by("engineStates").types).toEqual(["engineStates", "fuelConsumedMilliliters", "obdEngineSeconds"]);
    expect(by("ambientAirTemperatureMilliC").start).toBe("2026-10-01T11:00:00.000Z");
    expect(by("gps")).toMatchObject({ start: "2026-10-02T10:45:00.000Z", end: iso(MORNING) });
  });

  it("between 02:00 and 05:59 local, with no nightly run in 20 h, the run is the nightly two-day recompute", async () => {
    const rec = recorder({ jobs: [] });
    const night = Date.parse("2026-10-02T08:20:00Z"); // 03:20 CDT
    const r = await syncIdleEngine(rec.client as never, env, ORG, { nowMs: night, historyFetcher: samsara({}).history, snapshotFetcher: noSnapshot });
    // local midnight two days back: 09/30 00:00 CDT = 05:00Z
    expect(r).toMatchObject({ mode: "nightly", from: "2026-09-30T05:00:00.000Z", to: "2026-10-02T08:00:00.000Z" });
    const q = rec.forTable("jobs")[0]!;
    expect(q.filters()).toEqual(expect.arrayContaining([
      { col: "kind", val: "idle_engine" },
      { col: "status", val: "done" },
      { col: "stats->>mode", val: "nightly" },
    ]));
  });

  it("…but not when tonight's has already run, and never in the daytime", async () => {
    const night = Date.parse("2026-10-02T08:20:00Z");
    const ran = recorder({ jobs: [{ id: "j1" }] });
    expect((await syncIdleEngine(ran.client as never, env, ORG, { nowMs: night, historyFetcher: samsara({}).history, snapshotFetcher: noSnapshot })).mode).toBe("hourly");
    const day = recorder({ jobs: [] });
    expect((await syncIdleEngine(day.client as never, env, ORG, { nowMs: MORNING, historyFetcher: samsara({}).history, snapshotFetcher: noSnapshot })).mode).toBe("hourly");
    expect(day.forTable("jobs")).toHaveLength(0); // the daytime run does not even ask
  });

  it("reads in-service trucks only — not one on order, not one gone", async () => {
    const rec = recorder();
    await syncIdleEngine(rec.client as never, env, ORG, { nowMs: MORNING, historyFetcher: samsara({}).history, snapshotFetcher: noSnapshot });
    expect(rec.forTable("vehicles")[0]!.filters()).toContainEqual({ col: "status", val: [...IN_SERVICE_VEHICLE_STATUSES] });
    expect(IN_SERVICE_VEHICLE_STATUSES).not.toContain("retired");
    expect(IN_SERVICE_VEHICLE_STATUSES).not.toContain("ordered");
  });
});

describe("syncIdleEngine — what it carries in", () => {
  it("a truck in a stored park from three days ago is fetched alone, from its park's start, and the park is continued", async () => {
    const since = "2026-09-29T10:00:00Z";
    const rec = recorder({ stops: [{ vehicle_id: "v650", started_at: since, start_observed: true }] });
    const s = samsara({ s650: { engineStates: [{ time: since, value: "Off" }], gps: [{ time: "2026-10-02T11:30:00Z", speedMilesPerHour: 0, latitude: 41.5, longitude: -88.1 }] } });
    const r = await syncIdleEngine(rec.client as never, env, ORG, { nowMs: MORNING, historyFetcher: s.history, snapshotFetcher: noSnapshot });
    expect(r.batches).toBe(2);
    const engineCalls = s.calls.filter((c) => c.types.includes("engineStates"));
    expect(engineCalls.find((c) => c.ids.length === 1 && c.ids[0] === "s650")?.start).toBe("2026-09-29T10:00:00.000Z");
    expect(engineCalls.find((c) => c.ids.includes("s661"))?.ids).toEqual(["s661"]);
    const w = writes(rec).find((x) => (x.p_vehicles as string[])[0] === "v650")!;
    expect(w.p_stops).toEqual([expect.objectContaining({ vehicle_id: "v650", started_at: "2026-09-29T10:00:00.000Z", ended_at: null, start_observed: true })]);
    // the stored park is read as the one in progress at the window's start
    const q = rec.forTable("idle_engine_stops")[0]!;
    expect(q.filters()).toContainEqual({ col: "started_at", val: "2026-10-02T11:00:00.000Z" });
  });

  it("a truck with no flip in its fetch is seeded from Samsara's latest flip when that is older — off, not unknown", async () => {
    const rec = recorder();
    const snapshot: StatsSnapshotFetcher = async () => [
      { id: "s650", engineState: { time: "2026-09-22T17:41:27Z", value: "Off" } },
      { id: "s661", engineState: { time: "2026-10-02T12:00:00Z", value: "Off" } }, // newer than the fetch: no seed
    ];
    await syncIdleEngine(rec.client as never, env, ORG, { nowMs: MORNING, historyFetcher: samsara({}).history, snapshotFetcher: snapshot });
    const hours = writes(rec)[0]!.p_hours as { vehicle_id: string; engine_off_sec: number; no_data_sec: number }[];
    expect(hours.filter((h) => h.vehicle_id === "v650").every((h) => h.engine_off_sec === 3600)).toBe(true);
    expect(hours.filter((h) => h.vehicle_id === "v661").every((h) => h.no_data_sec === 3600)).toBe(true);
  });

  it("the park threshold comes from idle_settings", async () => {
    // A seven-minute park: a stop row at the default five minutes, brief at ten.
    const gps = [
      ...Array.from({ length: 40 }, (_, i) => ({ time: iso(Date.parse("2026-10-02T11:40:00Z") + i * 30_000), speedMilesPerHour: 60, latitude: 41.5, longitude: -88.1 })),
      ...Array.from({ length: 14 }, (_, i) => ({ time: iso(Date.parse("2026-10-02T12:00:00Z") + i * 30_000), speedMilesPerHour: 0, latitude: 41.5, longitude: -88.1 })),
      ...Array.from({ length: 40 }, (_, i) => ({ time: iso(Date.parse("2026-10-02T12:07:00Z") + i * 30_000), speedMilesPerHour: 60, latitude: 41.5, longitude: -88.1 })),
    ];
    const series = { s650: { engineStates: [{ time: "2026-10-02T09:00:00Z", value: "On" }], gps } };
    for (const [minIdle, rows] of [[5, 1], [10, 0]] as const) {
      const rec = recorder({ minIdle });
      await syncIdleEngine(rec.client as never, env, ORG, { nowMs: MORNING, historyFetcher: samsara(series).history, snapshotFetcher: noSnapshot });
      expect((writes(rec)[0]!.p_stops as unknown[]).length).toBe(rows);
    }
  });
});

describe("syncIdleEngine — what it refuses, and whose rows it reads", () => {
  it("a batch whose fetch stopped at the page cap is not written — a replace of a window it did not read would delete good rows", async () => {
    const rec = recorder();
    const r = await syncIdleEngine(rec.client as never, env, ORG, { nowMs: MORNING, historyFetcher: samsara({}, { incomplete: true }).history, snapshotFetcher: noSnapshot });
    expect(r.incompleteBatches).toBe(1);
    expect(writes(rec)).toEqual([]);
  });

  it("every read is the org's", async () => {
    const rec = recorder({ jobs: [] });
    await syncIdleEngine(rec.client as never, env, ORG, { nowMs: Date.parse("2026-10-02T08:20:00Z"), historyFetcher: samsara({}).history, snapshotFetcher: noSnapshot });
    expectOrgScoped(rec, ORG);
    const orgs = rec.forTable("organizations")[0] as RecordedQuery;
    expect(orgs.filters()).toContainEqual({ col: "id", val: ORG });
  });
});
