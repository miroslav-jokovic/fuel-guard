/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncDriverScores } from "./driverScoreSync.js";
import type { Env } from "../env.js";

function makeAdmin(fixtures: Record<string, { data: unknown }>) {
  const captured: Record<string, Record<string, unknown>[]> = {};
  function node(table: string): any {
    const result = fixtures[table] ?? { data: [] };
    const proxy: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result);
        if (prop === "upsert")
          return (rows: unknown) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            (captured[table] ||= []).push(...(arr as Record<string, unknown>[]));
            return Promise.resolve({ error: null });
          };
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  }
  return { admin: { from: (t: string) => node(t) } as unknown as SupabaseClient, captured };
}

const NOW = Date.UTC(2026, 6, 15, 17, 0, 0); // Wed 2026-07-15 12:00 CDT → week starts Mon 2026-07-13
const env = { SAMSARA_API_URL: "https://api.samsara.com" } as unknown as Env;

const baseFixtures = () => ({
  driver_performance_settings: { data: null },
  organizations: { data: { operating_hours: { tz: "America/Chicago" } } },
  drivers: {
    data: [
      { id: "d1", samsara_driver_id: "66010", full_name: "A" },
      { id: "d2", samsara_driver_id: "77", full_name: "B" },
    ],
  },
});

const safety = async () => ({
  data: [
    { driverId: "66010", driverScore: 98, driveDistanceMeters: 1609344, driveTimeMilliseconds: 3_600_000, behaviors: [{ behaviorType: "braking", count: 2 }], speeding: [{ durationMilliseconds: 500 }] },
    { driverId: "77", driverScore: 80, driveDistanceMeters: 804672, driveTimeMilliseconds: 7_200_000, behaviors: [], speeding: [] },
    { driverId: "999", driverScore: 50, driveDistanceMeters: 0, driveTimeMilliseconds: 0, behaviors: [], speeding: [] },
  ],
});

describe("syncDriverScores", () => {
  it("upserts one row per known driver with safety, joining efficiency when present", async () => {
    const { admin, captured } = makeAdmin(baseFixtures());
    const efficiency = async () => ({
      data: [{ driverId: "66010", scoreData: { overallScore: "47" }, rawData: { engineOnDurationMs: 7_200_000 }, percentageData: { idlingPercentage: 30 } }],
    });
    const res = await syncDriverScores(admin, env, "org1", { nowMs: NOW, safetyFetcher: safety, efficiencyFetcher: efficiency });
    expect(res.weekStart).toBe("2026-07-13");
    expect(res.safetyOk).toBe(true);
    expect(res.efficiencyOk).toBe(true);
    expect(res.upserted).toBe(2);
    const rows = captured.driver_scores ?? [];
    const r1 = rows.find((r) => r.driver_id === "d1")!;
    const r2 = rows.find((r) => r.driver_id === "d2")!;
    expect(r1.safety_score).toBe(98);
    expect(r1.drive_distance_mi).toBe(1000);
    expect(r1.harsh_brake_count).toBe(2);
    expect(r1.efficiency_score).toBe(47);
    expect(r1.engine_on_hours).toBe(2);
    expect(r1.idling_pct).toBe(30);
    expect(r1.week_start).toBe("2026-07-13");
    expect(r2.efficiency_score).toBeNull();
    expect(r2.safety_score).toBe(80);
  });

  it("degrades gracefully when the efficiency feed throws (safety still stored)", async () => {
    const { admin, captured } = makeAdmin(baseFixtures());
    const efficiency = async () => { throw new Error("403 beta"); };
    const res = await syncDriverScores(admin, env, "org1", { nowMs: NOW, safetyFetcher: safety, efficiencyFetcher: efficiency });
    expect(res.safetyOk).toBe(true);
    expect(res.efficiencyOk).toBe(false);
    expect(res.upserted).toBe(2);
    const rows = captured.driver_scores ?? [];
    expect(rows.every((r) => r.efficiency_score === null)).toBe(true);
  });

  it("returns early when there are no Samsara-linked drivers", async () => {
    const { admin } = makeAdmin({ ...baseFixtures(), drivers: { data: [] } });
    const res = await syncDriverScores(admin, env, "org1", { nowMs: NOW, safetyFetcher: safety });
    expect(res.drivers).toBe(0);
    expect(res.upserted).toBe(0);
  });
});
