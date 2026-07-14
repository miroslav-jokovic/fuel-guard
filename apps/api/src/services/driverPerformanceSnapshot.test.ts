/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { snapshotSettledWeeks } from "./driverPerformanceSnapshot.js";
import type { Env } from "../env.js";

// Filter-aware Supabase fake: handlers may be a static {data} or a fn(filters)->{data}. Captures upserts.
function makeAdmin(handlers: Record<string, { data: unknown } | ((f: Record<string, unknown>) => { data: unknown })>) {
  const captured: Record<string, Record<string, unknown>[]> = {};
  function node(table: string): any {
    const filters: Record<string, unknown> = {};
    const proxy: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then")
          return (resolve: (v: unknown) => unknown) => {
            const h = handlers[table];
            const out = typeof h === "function" ? h(filters) : (h ?? { data: [] });
            return resolve(out);
          };
        if (prop === "upsert")
          return (rows: unknown) => {
            (captured[table] ||= []).push(...((Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[]));
            return Promise.resolve({ error: null });
          };
        return (...args: unknown[]) => {
          if (prop === "eq" && args.length === 2) filters[String(args[0])] = args[1];
          return proxy;
        };
      },
      apply: () => proxy,
    });
    return proxy;
  }
  return { admin: { from: (t: string) => node(t) } as unknown as SupabaseClient, captured };
}

const NOW = Date.UTC(2026, 6, 24, 18, 0, 0); // Fri 2026-07-24; week 07-13..07-19 is settled (>96h after end)
const env = {} as unknown as Env;

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

describe("snapshotSettledWeeks", () => {
  it("freezes the settled week with trailing rank + winners", async () => {
    const { admin, captured } = makeAdmin({
      driver_performance_settings: { data: settingsRow },
      organizations: { data: { operating_hours: { tz: "America/Chicago" } } },
      driver_performance_weeks: { data: [] }, // nothing frozen yet
      idle_events: { data: [] }, // no idle → idle score 100 (irrelevant, weight 0)
      drivers: { data: [{ id: "d1", full_name: "Alice" }, { id: "d2", full_name: "Bob" }, { id: "d3", full_name: "Cara" }] },
      driver_scores: (f) => ({ data: (byWeek[String(f.week_start)] as unknown[]) ?? [] }),
    });

    const res = await snapshotSettledWeeks(admin, env, "org1", { nowMs: NOW, maxWeeks: 1 });
    expect(res.weeksFrozen).toEqual(["2026-07-13"]);
    expect(res.rowsWritten).toBe(3);

    const rows = (captured.driver_performance_weeks ?? []) as Record<string, any>[];
    const by = Object.fromEntries(rows.map((r) => [r.driver_id, r]));
    // trailing(3wk): d1 = (98+90+70)/3 = 86 ; d2 = (80+85+60)/3 = 75
    expect(by.d1.week_final).toBe(98);
    expect(by.d1.trailing_final).toBe(86);
    expect(by.d1.rank).toBe(1);
    expect(by.d1.is_winner).toBe(true);
    expect(by.d1.driver_name).toBe("Alice");
    expect(by.d2.trailing_final).toBe(75);
    expect(by.d2.rank).toBe(2);
    expect(by.d2.is_winner).toBe(false);
    // d3 ineligible (miles<500) → no rank, flagged reason
    expect(by.d3.eligible).toBe(false);
    expect(by.d3.ineligible_reason).toBe("below_min_miles");
    expect(by.d3.rank).toBeNull();
  });

  it("is idempotent — a week already frozen is skipped", async () => {
    const { admin, captured } = makeAdmin({
      driver_performance_settings: { data: settingsRow },
      organizations: { data: { operating_hours: { tz: "America/Chicago" } } },
      driver_performance_weeks: { data: [{ week_start: "2026-07-13" }, { week_start: "2026-07-06" }, { week_start: "2026-06-29" }] },
      idle_events: { data: [] },
      drivers: { data: [] },
      driver_scores: (f) => ({ data: (byWeek[String(f.week_start)] as unknown[]) ?? [] }),
    });
    const res = await snapshotSettledWeeks(admin, env, "org1", { nowMs: NOW, maxWeeks: 1 });
    expect(res.weeksFrozen).toEqual([]);
    expect(captured.driver_performance_weeks ?? []).toHaveLength(0);
  });
});
