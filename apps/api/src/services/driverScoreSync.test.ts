import { describe, it, expect } from "vitest";
import { syncDriverScores, syncRecentDriverScoreWeeks } from "./driverScoreSync.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { testEnv } from "../testing/testEnv.js";

/**
 * Migrated off the local `makeAdmin` Proxy (audit 2026-08-09, Stage 2.5). The roster read here decides
 * WHICH Samsara driver ids get sent to the scores API and whose driver_scores rows get written; with
 * the old fake, losing `.eq("org_id", …)` from it changed no assertion, while in production it would
 * have leaked one fleet's driver ids into another fleet's API call and score table.
 */
const ORG = "org1";
const NOW = Date.UTC(2026, 6, 15, 17, 0, 0); // Wed 2026-07-15 12:00 CDT → week starts Mon 2026-07-13
const env = testEnv({ SAMSARA_API_URL: "https://api.samsara.com" });

const baseFixtures = () => ({
  driver_performance_settings: { data: null },
  organizations: { data: { operating_hours: { tz: "America/Chicago" } } },
  drivers: [
    { id: "d1", samsara_driver_id: "66010", full_name: "A" },
    { id: "d2", samsara_driver_id: "77", full_name: "B" },
  ],
});

/**
 * `organizations` is exempt because it IS the org row: the service reads it with `.eq("id", orgId)`,
 * i.e. scoped by the tenant's own primary key. Asserted here rather than taken on trust.
 */
const expectScopedToOrg = (rec: SupabaseRecorder) => {
  expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  for (const q of rec.forTable("organizations")) expect(q.filters()).toContainEqual({ col: "id", val: ORG });
};

const safety = async () => ({
  data: [
    { driverId: "66010", driverScore: 98, driveDistanceMeters: 1609344, driveTimeMilliseconds: 3_600_000, behaviors: [{ behaviorType: "braking", count: 2 }], speeding: [{ durationMilliseconds: 500 }] },
    { driverId: "77", driverScore: 80, driveDistanceMeters: 804672, driveTimeMilliseconds: 7_200_000, behaviors: [], speeding: [] },
    { driverId: "999", driverScore: 50, driveDistanceMeters: 0, driveTimeMilliseconds: 0, behaviors: [], speeding: [] },
  ],
});

describe("syncDriverScores", () => {
  it("upserts one row per known driver with safety, joining efficiency when present", async () => {
    const rec = createSupabaseRecorder({ tables: baseFixtures() });
    const efficiency = async () => ({
      data: [{ driverId: "66010", scoreData: { overallScore: "47" }, rawData: { engineOnDurationMs: 7_200_000 }, percentageData: { idlingPercentage: 30 } }],
    });
    const res = await syncDriverScores(rec.client, env, ORG, { nowMs: NOW, safetyFetcher: safety, efficiencyFetcher: efficiency });
    expect(res.weekStart).toBe("2026-07-13");
    expect(res.safetyOk).toBe(true);
    expect(res.efficiencyOk).toBe(true);
    expect(res.upserted).toBe(2);
    const rows = rec.writtenRows("driver_scores");
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
    expectScopedToOrg(rec);
  });

  it("degrades gracefully when the efficiency feed throws (safety still stored)", async () => {
    const rec = createSupabaseRecorder({ tables: baseFixtures() });
    const efficiency = async () => { throw new Error("403 beta"); };
    const res = await syncDriverScores(rec.client, env, ORG, { nowMs: NOW, safetyFetcher: safety, efficiencyFetcher: efficiency });
    expect(res.safetyOk).toBe(true);
    expect(res.efficiencyOk).toBe(false);
    expect(res.upserted).toBe(2);
    const rows = rec.writtenRows("driver_scores");
    expect(rows.every((r) => r.efficiency_score === null)).toBe(true);
    expectScopedToOrg(rec);
  });

  it("returns early when there are no Samsara-linked drivers", async () => {
    const rec = createSupabaseRecorder({ tables: { ...baseFixtures(), drivers: [] } });
    const res = await syncDriverScores(rec.client, env, ORG, { nowMs: NOW, safetyFetcher: safety });
    expect(res.drivers).toBe(0);
    expect(res.upserted).toBe(0);
    expectScopedToOrg(rec);
  });
});

describe("syncRecentDriverScoreWeeks", () => {
  it("syncs the current week plus the trailing/settle cover and aggregates", async () => {
    const rec = createSupabaseRecorder({ tables: baseFixtures() });
    const efficiency = async () => ({ data: [] });
    const res = await syncRecentDriverScoreWeeks(rec.client, env, ORG, { nowMs: NOW, safetyFetcher: safety, efficiencyFetcher: efficiency });
    expect(res.weeks).toBe(3); // defaults: max(trailing 3, ceil(96/168)+1 = 2) = 3
    expect(res.results).toHaveLength(3);
    expect(res.totalUpserted).toBe(6); // 2 known drivers × 3 weeks
    const weekStarts = new Set(rec.writtenRows("driver_scores").map((r) => r.week_start));
    expect(weekStarts.size).toBe(3);
    expectScopedToOrg(rec);
  });
});
