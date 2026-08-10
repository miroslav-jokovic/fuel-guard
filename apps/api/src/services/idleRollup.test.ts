import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { syncIdleRollup } from "./idleRollup.js";

/**
 * Migrated off the local `makeAdmin` Proxy (audit 2026-08-09, Stage 2.5). This service reads SEVEN raw
 * tables and writes the table the Idling page renders; with the old fake, dropping `.eq("org_id", …)`
 * from any one of those reads changed nothing about these assertions, and the resulting rollup row
 * would have mixed another fleet's engine hours into this one's day. Same fixtures, same derived
 * numbers — plus `expectOrgScoped`, which is what actually pins the tenant boundary.
 */
const ORG = "org1";
const today = new Date().toISOString().slice(0, 10);
const todayT = (h: number) => `${today}T${String(h).padStart(2, "0")}:00:00.000Z`;

describe("syncIdleRollup", () => {
  it("aggregates raw inputs into one row per (vehicle, day) and upserts", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicle_engine_days: [
          {
            vehicle_id: "v1",
            day: today,
            drive_sec: 3600,
            idle_sec: 1800,
            off_sec: 0,
            coverage_sec: 5400,
          },
        ],
        idle_park_sessions: [
          { vehicle_id: "v1", started_at: todayT(1), idle_sec: 900, mode: "continuous" },
        ],
        idle_events: [
          { vehicle_id: "v1", driver_id: "d1", started_at: todayT(2), duration_sec: 600 },
        ],
        hos_duty_segments: [
          { driver_id: "d1", status: "sleeper", started_at: todayT(0), ended_at: todayT(6) },
        ],
        driver_vehicle_assignments: [],
        vehicles: [{ id: "v1", samsara_vehicle_id: "s1" }],
        drivers: [{ id: "d1", samsara_driver_id: "op1" }],
        idle_rollup_days: [], // empty → self-backfill window, and no diff hits
      },
    });

    const res = await syncIdleRollup(rec.client, ORG);
    expect(res.rows).toBe(1);
    expect(res.written).toBe(1);
    expect(res.windowDays).toBe(400); // empty table → deep self-backfill
    const row = rec.writtenRows("idle_rollup_days")[0]!;
    expect(row).toMatchObject({
      org_id: ORG,
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

    expectOrgScoped(rec, ORG);
  });

  it("skips the write when the stored rollup row already matches (diff-before-write)", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicle_engine_days: [
          {
            vehicle_id: "v1",
            day: today,
            drive_sec: 100,
            idle_sec: 50,
            off_sec: 0,
            coverage_sec: 150,
          },
        ],
        idle_park_sessions: [],
        idle_events: [],
        hos_duty_segments: [],
        driver_vehicle_assignments: [],
        vehicles: [],
        drivers: [],
        idle_rollup_days: [
          {
            vehicle_id: "v1",
            day: today,
            drive_sec: 100,
            idle_sec: 50,
            off_sec: 0,
            coverage_sec: 150,
            managed_idle_sec: 0,
            continuous_idle_sec: 0,
            rest_idle_sec: 0,
            work_idle_sec: 0,
            other_idle_sec: 0,
            attributed_driver_id: null,
          },
        ],
      },
    });
    const res = await syncIdleRollup(rec.client, ORG, { sinceDays: 35 });
    expect(res.rows).toBe(1);
    expect(res.written).toBe(0);
    expect(rec.writes()).toHaveLength(0); // no upsert issued at all
    expect(res.windowDays).toBe(35);
    expectOrgScoped(rec, ORG);
  });

  it("resolves assignment samsara ids to our ids for attribution", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicle_engine_days: [
          {
            vehicle_id: "v1",
            day: today,
            drive_sec: 100,
            idle_sec: 0,
            off_sec: 0,
            coverage_sec: 100,
          },
        ],
        idle_park_sessions: [],
        idle_events: [],
        hos_duty_segments: [],
        driver_vehicle_assignments: [
          { vehicle_samsara_id: "s1", driver_samsara_id: "op1", start_at: todayT(0), end_at: null },
        ],
        vehicles: [{ id: "v1", samsara_vehicle_id: "s1" }],
        drivers: [{ id: "d1", samsara_driver_id: "op1" }],
        idle_rollup_days: [],
      },
    });
    await syncIdleRollup(rec.client, ORG, { sinceDays: 2 });
    const row = rec.writtenRows("idle_rollup_days").find((r) => r.day === today)!;
    expect(row.attributed_driver_id).toBe("d1");
    expectOrgScoped(rec, ORG);
  });

  it("rolls direct on-duty HOS overlap and the bounded operational grace", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicle_engine_days: [
          {
            vehicle_id: "v1",
            day: today,
            drive_sec: 0,
            idle_sec: 3600,
            off_sec: 0,
            coverage_sec: 3600,
          },
        ],
        idle_park_sessions: [
          {
            vehicle_id: "v1",
            started_at: todayT(1),
            ended_at: todayT(2),
            idle_sec: 3600,
            mode: "continuous",
          },
        ],
        idle_events: [
          { vehicle_id: "v1", driver_id: "d1", started_at: todayT(1), duration_sec: 3600 },
        ],
        hos_duty_segments: [
          { driver_id: "d1", status: "on_duty", started_at: todayT(1), ended_at: todayT(2) },
        ],
        driver_vehicle_assignments: [],
        vehicles: [{ id: "v1", samsara_vehicle_id: "s1" }],
        drivers: [{ id: "d1", samsara_driver_id: "op1" }],
        idle_rollup_days: [],
      },
    });
    await syncIdleRollup(rec.client, ORG, { sinceDays: 2 });
    expect(rec.writtenRows("idle_rollup_days")[0]).toMatchObject({
      hos_work_sec: 3600,
      hos_grace_sec: 900,
      hos_unknown_sec: 0,
      hos_evidence_status: "sufficient",
    });
    expectOrgScoped(rec, ORG);
  });
});
