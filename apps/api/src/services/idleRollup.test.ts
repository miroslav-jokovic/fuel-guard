/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncIdleRollup } from "./idleRollup.js";

/** Chainable Supabase fake: awaiting a node yields the table fixture; .upsert() captures rows. */
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

const today = new Date().toISOString().slice(0, 10);
const todayT = (h: number) => `${today}T${String(h).padStart(2, "0")}:00:00.000Z`;

describe("syncIdleRollup", () => {
  it("aggregates raw inputs into one row per (vehicle, day) and upserts", async () => {
    const { admin, captured } = makeAdmin({
      vehicle_engine_days: {
        data: [{ vehicle_id: "v1", day: today, drive_sec: 3600, idle_sec: 1800, off_sec: 0, coverage_sec: 5400 }],
      },
      idle_park_sessions: {
        data: [{ vehicle_id: "v1", started_at: todayT(1), idle_sec: 900, mode: "continuous" }],
      },
      idle_events: {
        data: [{ vehicle_id: "v1", driver_id: "d1", started_at: todayT(2), duration_sec: 600 }],
      },
      hos_duty_segments: {
        data: [{ driver_id: "d1", status: "sleeper", started_at: todayT(0), ended_at: todayT(6) }],
      },
      driver_vehicle_assignments: { data: [] },
      vehicles: { data: [{ id: "v1", samsara_vehicle_id: "s1" }] },
      drivers: { data: [{ id: "d1", samsara_driver_id: "op1" }] },
      idle_rollup_days: { data: [] }, // empty → self-backfill window, and no diff hits
    });

    const res = await syncIdleRollup(admin, "org1");
    expect(res.rows).toBe(1);
    expect(res.written).toBe(1);
    expect(res.windowDays).toBe(400); // empty table → deep self-backfill
    const row = captured.idle_rollup_days![0]!;
    expect(row).toMatchObject({
      org_id: "org1",
      vehicle_id: "v1",
      day: today,
      drive_sec: 3600,
      idle_sec: 1800,
      coverage_sec: 5400,
      continuous_idle_sec: 900,
      managed_idle_sec: 0,
      rest_idle_sec: 600, // event fully inside the sleeper segment
      work_idle_sec: 0,
      other_idle_sec: 0,
      attributed_driver_id: "d1",
    });
  });

  it("skips the write when the stored rollup row already matches (diff-before-write)", async () => {
    const { admin, captured } = makeAdmin({
      vehicle_engine_days: {
        data: [{ vehicle_id: "v1", day: today, drive_sec: 100, idle_sec: 50, off_sec: 0, coverage_sec: 150 }],
      },
      idle_park_sessions: { data: [] },
      idle_events: { data: [] },
      hos_duty_segments: { data: [] },
      driver_vehicle_assignments: { data: [] },
      vehicles: { data: [] },
      drivers: { data: [] },
      idle_rollup_days: {
        data: [{
          vehicle_id: "v1", day: today, drive_sec: 100, idle_sec: 50, off_sec: 0, coverage_sec: 150,
          managed_idle_sec: 0, continuous_idle_sec: 0, rest_idle_sec: 0, work_idle_sec: 0,
          other_idle_sec: 0, attributed_driver_id: null,
        }],
      },
    });
    const res = await syncIdleRollup(admin, "org1", { sinceDays: 35 });
    expect(res.rows).toBe(1);
    expect(res.written).toBe(0);
    expect(captured.idle_rollup_days).toBeUndefined();
    expect(res.windowDays).toBe(35);
  });

  it("resolves assignment samsara ids to our ids for attribution", async () => {
    const { admin, captured } = makeAdmin({
      vehicle_engine_days: {
        data: [{ vehicle_id: "v1", day: today, drive_sec: 100, idle_sec: 0, off_sec: 0, coverage_sec: 100 }],
      },
      idle_park_sessions: { data: [] },
      idle_events: { data: [] },
      hos_duty_segments: { data: [] },
      driver_vehicle_assignments: {
        data: [{ vehicle_samsara_id: "s1", driver_samsara_id: "op1", start_at: todayT(0), end_at: null }],
      },
      vehicles: { data: [{ id: "v1", samsara_vehicle_id: "s1" }] },
      drivers: { data: [{ id: "d1", samsara_driver_id: "op1" }] },
      idle_rollup_days: { data: [] },
    });
    await syncIdleRollup(admin, "org1", { sinceDays: 2 });
    const row = captured.idle_rollup_days!.find((r) => r.day === today)!;
    expect(row.attributed_driver_id).toBe("d1");
  });
});
