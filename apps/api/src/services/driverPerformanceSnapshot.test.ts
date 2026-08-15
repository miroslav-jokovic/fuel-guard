import { describe, it, expect } from "vitest";
import { snapshotSettledWeeks } from "./driverPerformanceSnapshot.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../testing/supabaseRecorder.js";
import { testEnv } from "../testing/testEnv.js";

/**
 * Migrated off the local filter-aware `makeAdmin` Proxy (audit 2026-08-09, Stage 2.5). That fake read
 * `.eq()` pairs only to CHOOSE a fixture (week_start → that week's scores); it never let a test assert
 * on them, so the tenant filter on the weekly score reads was invisible. This is the rewards ledger —
 * a frozen week that pulled in another fleet's drivers would decide who gets paid — so the recorder
 * both feeds the per-week fixtures and pins the scope.
 */
const ORG = "org1";
const NOW = Date.UTC(2026, 6, 24, 18, 0, 0); // Fri 2026-07-24; week 07-13..07-19 is settled (>96h after end)
const env = testEnv();

/** The value the query filtered `col` on — how the fixture below answers per week. */
const filterVal = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;

const settingsRow = {
  normalization_method: "raw",
  weight_safety: 1,
  weight_efficiency: 0,
  weight_idling: 0,
  min_cohort_for_percentile: 0,
  min_distance_mi: 500,
  min_drive_hours: 10,
  reward_top_n: 1,
  trailing_weeks: 3,
  settle_hours: 96,
  efficiency_enabled: true,
  week_starts_on: 1,
  week_timezone: "America/Chicago",
};

// raw + safety-only weights → weekFinal == safety_score for eligible drivers.
const s = (driver_id: string, safety: number, miles: number) => ({
  driver_id, safety_score: safety, efficiency_score: null,
  drive_distance_mi: miles, drive_time_hours: 40, engine_on_hours: 40,
});
const byWeek: Record<string, unknown[]> = {
  "2026-07-13": [s("d1", 98, 1000), s("d2", 80, 800), s("d3", 60, 100)], // d3 miles<500 → ineligible
  "2026-07-06": [s("d1", 90, 1000), s("d2", 85, 800)],
  "2026-06-29": [s("d1", 70, 1000), s("d2", 60, 800)],
};
const scoresForWeek = (q: RecordedQuery) => (byWeek[String(filterVal(q, "week_start"))] as unknown[]) ?? [];

describe("snapshotSettledWeeks", () => {
  it("freezes the settled week with trailing rank + winners", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        driver_performance_settings: { data: settingsRow },
        organizations: { data: { operating_hours: { tz: "America/Chicago" } } },
        driver_performance_weeks: [], // nothing frozen yet
        idle_events: [], // no idle → idle score 100 (irrelevant, weight 0)
        drivers: [{ id: "d1", full_name: "Alice" }, { id: "d2", full_name: "Bob" }, { id: "d3", full_name: "Cara" }],
        driver_scores: scoresForWeek,
      },
    });

    const res = await snapshotSettledWeeks(rec.client, env, ORG, { nowMs: NOW, maxWeeks: 1 });
    expect(res.weeksFrozen).toEqual(["2026-07-13"]);
    expect(res.rowsWritten).toBe(3);

    const rows = rec.writtenRows("driver_performance_weeks");
    // A missing driver row must fail as "no row for d1", not as a confusing undefined-property read
    // five lines later — so the lookup asserts rather than returning `any`.
    const by = (id: string): Record<string, unknown> => {
      const row = rows.find((r) => r.driver_id === id);
      if (!row) throw new Error(`no driver_performance_weeks row written for ${id}`);
      return row as Record<string, unknown>;
    };
    // trailing(3wk): d1 = (98+90+70)/3 = 86 ; d2 = (80+85+60)/3 = 75
    expect(by("d1").week_final).toBe(98);
    expect(by("d1").trailing_final).toBe(86);
    expect(by("d1").rank).toBe(1);
    expect(by("d1").is_winner).toBe(true);
    expect(by("d1").driver_name).toBe("Alice");
    expect(by("d2").trailing_final).toBe(75);
    expect(by("d2").rank).toBe(2);
    expect(by("d2").is_winner).toBe(false);
    // d3 ineligible (miles<500) → no rank, flagged reason
    expect(by("d3").eligible).toBe(false);
    expect(by("d3").ineligible_reason).toBe("below_min_miles");
    expect(by("d3").rank).toBeNull();

    // Exempt, with reasons:
    //  - organizations IS the org row: it is keyed by its primary key `id`, so `.eq("id", orgId)` is the
    //    tenant filter (asserted below rather than assumed).
    //  - drivers is a name lookup by `.in("id", …)` over ids that came out of the org-scoped
    //    driver_scores read above — ownership was established before this query ran (also asserted).
    expectOrgScoped(rec, ORG, { exempt: ["organizations", "drivers"] });
    expect(rec.forTable("organizations")[0]!.filters()).toContainEqual({ col: "id", val: ORG });
    const looked = rec.forTable("drivers").flatMap((q) => (filterVal(q, "id") ?? []) as string[]);
    expect(looked.length).toBeGreaterThan(0);
    expect(looked.every((id) => ["d1", "d2", "d3"].includes(id))).toBe(true);
  });

  it("is idempotent — a week already frozen is skipped", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        driver_performance_settings: { data: settingsRow },
        organizations: { data: { operating_hours: { tz: "America/Chicago" } } },
        driver_performance_weeks: [
          { week_start: "2026-07-13" }, { week_start: "2026-07-06" }, { week_start: "2026-06-29" },
        ],
        idle_events: [],
        drivers: [],
        driver_scores: scoresForWeek,
      },
    });
    const res = await snapshotSettledWeeks(rec.client, env, ORG, { nowMs: NOW, maxWeeks: 1 });
    expect(res.weeksFrozen).toEqual([]);
    expect(rec.writtenRows("driver_performance_weeks")).toHaveLength(0);
    // The already-frozen check reads driver_performance_weeks — if THAT read lost its org filter, a
    // neighbouring tenant's frozen weeks would silently suppress this org's payouts.
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] }); // org row, keyed by `id` (see above)
  });
});
