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
/**
 * `organizations` is read by PRIMARY KEY (`.eq("id", orgId)`) to resolve the operating timezone the day
 * boundary is cut on — ownership is the filter, so there is no `org_id` column to scope by. Every fixture
 * pins that timezone to UTC so these day-bucketing assertions stay independent of the machine clock.
 */
const ORG_LOOKUP = ["organizations"];
/**
 * The UTC day these fixtures live on. Anchored 30 h back, NOT at `now`: the sync window ends at
 * `Date.now()` and buildHosVehicleTimelines clamps to it, so fixtures written on "today at 02:00 UTC" were
 * in the FUTURE whenever the suite ran between 00:00 and 06:00 UTC — the HOS overlay clamped to nothing and
 * the rest/work assertions failed. 30 h back always lands on D-1 or D-2, so every hour of the day is in the
 * past AND inside the shortest window these tests use (`sinceDays: 2`, whose calendar start is D-2 00:00).
 */
const day = new Date(Date.now() - 30 * 3600_000).toISOString().slice(0, 10);
const dayT = (h: number) => `${day}T${String(h).padStart(2, "0")}:00:00.000Z`;

describe("syncIdleRollup", () => {
  it("aggregates raw inputs into one row per (vehicle, day) and upserts", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicle_engine_days: [
          {
            vehicle_id: "v1",
            day,
            drive_sec: 3600,
            idle_sec: 1800,
            off_sec: 0,
            coverage_sec: 5400,
          },
        ],
        idle_park_sessions: [
          {
            vehicle_id: "v1",
            started_at: dayT(1),
            ended_at: dayT(2),
            idle_sec: 900,
            mode: "continuous",
          },
        ],
        idle_events: [
          { vehicle_id: "v1", driver_id: "d1", started_at: dayT(2), duration_sec: 600 },
        ],
        hos_duty_segments: [
          {
            driver_id: null,
            vehicle_id: "v1",
            status: "sleeper",
            started_at: dayT(0),
            ended_at: dayT(6),
          },
        ],
        driver_vehicle_assignments: [
          { vehicle_samsara_id: "s1", driver_samsara_id: "op1", start_at: dayT(0), end_at: null },
        ],
        vehicles: [{ id: "v1", samsara_vehicle_id: "s1" }],
        drivers: [{ id: "d1", samsara_driver_id: "op1" }],
        organizations: [{ id: ORG, operating_hours: { tz: "UTC" } }],
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
      day,
      drive_sec: 3600,
      idle_sec: 1800,
      coverage_sec: 5400,
      continuous_idle_sec: 900,
      managed_idle_sec: 0,
      // The park's own duty overlay, weighted onto its 900 s of idle — not an idle-event overlay.
      rest_idle_sec: 900,
      work_idle_sec: 0,
      // The 900 s of idle no park covered: real, but with no timing it cannot be placed against a duty
      // status, so it is "other" rather than silently counted as rest.
      other_idle_sec: 900,
      attributed_driver_id: "d1",
    });

    expectOrgScoped(rec, ORG, { exempt: ORG_LOOKUP });
  });

  it("deletes org-scoped rollup keys absent from the fresh derivation", async () => {
    const staleDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const rec = createSupabaseRecorder({
      rpc: { delete_idle_rollup_rows: 1 },
      tables: {
        vehicle_engine_days: [
          { vehicle_id: "v1", day, drive_sec: 100, idle_sec: 50, off_sec: 0, coverage_sec: 150 },
        ],
        idle_park_sessions: [],
        idle_events: [],
        hos_duty_segments: [],
        driver_vehicle_assignments: [],
        vehicles: [],
        drivers: [],
        organizations: [{ id: ORG, operating_hours: { tz: "UTC" } }],
        idle_rollup_days: [
          {
            vehicle_id: "v1",
            day: staleDay,
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

    const result = await syncIdleRollup(rec.client, ORG, { sinceDays: 2 });
    expect(result.deleted).toBe(1);
    expect(rec.rpcs()).toContainEqual({
      fn: "delete_idle_rollup_rows",
      args: { p_org: ORG, p_rows: [{ vehicle_id: "v1", day: staleDay }] },
    });
    expectOrgScoped(rec, ORG, { exempt: ORG_LOOKUP });
  });

  it("skips the write when the stored rollup row already matches (diff-before-write)", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicle_engine_days: [
          {
            vehicle_id: "v1",
            day,
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
        organizations: [{ id: ORG, operating_hours: { tz: "UTC" } }],
        idle_rollup_days: [
          {
            vehicle_id: "v1",
            day,
            drive_sec: 100,
            idle_sec: 50,
            off_sec: 0,
            coverage_sec: 150,
            managed_idle_sec: 0,
            continuous_idle_sec: 0,
            rest_idle_sec: 0,
            work_idle_sec: 0,
            other_idle_sec: 50, // idle under the 30-min park floor: reported as unclassifiable, not dropped
            attributed_driver_id: null,
          },
        ],
      },
    });
    const res = await syncIdleRollup(rec.client, ORG, { sinceDays: 35 });
    expect(res.rows).toBe(1);
    expect(res.written).toBe(0);
    // No ROLLUP upsert issued at all. The price-history sync that runs alongside writes its own table,
    // which is expected and unrelated to the diff-before-write guard.
    expect(rec.writes().filter((w) => w.table === "idle_rollup_days")).toHaveLength(0);
    expect(res.windowDays).toBe(35);
    expectOrgScoped(rec, ORG, { exempt: ORG_LOOKUP });
  });

  it("resolves assignment samsara ids to our ids for attribution", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicle_engine_days: [
          {
            vehicle_id: "v1",
            day,
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
          { vehicle_samsara_id: "s1", driver_samsara_id: "op1", start_at: dayT(0), end_at: null },
        ],
        vehicles: [{ id: "v1", samsara_vehicle_id: "s1" }],
        drivers: [{ id: "d1", samsara_driver_id: "op1" }],
        organizations: [{ id: ORG, operating_hours: { tz: "UTC" } }],
        idle_rollup_days: [],
      },
    });
    await syncIdleRollup(rec.client, ORG, { sinceDays: 2 });
    const row = rec.writtenRows("idle_rollup_days").find((r) => r.day === day)!;
    expect(row.attributed_driver_id).toBe("d1");
    expectOrgScoped(rec, ORG, { exempt: ORG_LOOKUP });
  });

  it("rolls assignment-attributed HOS evidence into the vehicle timeline", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicle_engine_days: [
          { vehicle_id: "v1", day, drive_sec: 0, idle_sec: 3600, off_sec: 0, coverage_sec: 3600 },
        ],
        idle_park_sessions: [
          { vehicle_id: "v1", started_at: dayT(1), ended_at: dayT(2), idle_sec: 3600, mode: "continuous" },
        ],
        idle_events: [],
        hos_duty_segments: [
          {
            driver_id: "d1",
            samsara_driver_id: "op1",
            vehicle_id: null,
            status: "on_duty",
            started_at: dayT(1),
            ended_at: dayT(2),
          },
        ],
        driver_vehicle_assignments: [
          { vehicle_samsara_id: "s1", driver_samsara_id: "op1", start_at: dayT(0), end_at: null },
        ],
        vehicles: [{ id: "v1", samsara_vehicle_id: "s1" }],
        drivers: [{ id: "d1", samsara_driver_id: "op1" }],
        organizations: [{ id: ORG, operating_hours: { tz: "UTC" } }],
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
    expectOrgScoped(rec, ORG, { exempt: ORG_LOOKUP });
  });

  it("rolls direct on-duty HOS overlap and the bounded operational grace", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicle_engine_days: [
          {
            vehicle_id: "v1",
            day,
            drive_sec: 0,
            idle_sec: 3600,
            off_sec: 0,
            coverage_sec: 3600,
          },
        ],
        idle_park_sessions: [
          {
            vehicle_id: "v1",
            started_at: dayT(1),
            ended_at: dayT(2),
            idle_sec: 3600,
            mode: "continuous",
          },
        ],
        idle_events: [
          { vehicle_id: "v1", driver_id: "d1", started_at: dayT(1), duration_sec: 3600 },
        ],
        hos_duty_segments: [
          { driver_id: "d1", status: "on_duty", started_at: dayT(1), ended_at: dayT(2) },
        ],
        driver_vehicle_assignments: [],
        vehicles: [{ id: "v1", samsara_vehicle_id: "s1" }],
        drivers: [{ id: "d1", samsara_driver_id: "op1" }],
        organizations: [{ id: ORG, operating_hours: { tz: "UTC" } }],
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
    expectOrgScoped(rec, ORG, { exempt: ORG_LOOKUP });
  });
});
