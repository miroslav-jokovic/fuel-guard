import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { syncIdleEquipmentEvidence } from "./idleEquipmentEvidenceSync.js";

const ORG = "org-1";
const END = "2026-08-02T00:00:00.000Z";
const START = "2026-08-01T00:00:00.000Z";

describe("syncIdleEquipmentEvidence", () => {
  it("persists documented optimized-idle evidence and does not invent an APU envelope", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        idle_park_sessions: {
          data: [
            {
              id: "p1",
              org_id: ORG,
              vehicle_id: "v1",
              started_at: START,
              ended_at: "2026-08-01T01:00:00.000Z",
              idle_sec: 3600,
            },
            {
              id: "p2",
              org_id: ORG,
              vehicle_id: "v2",
              started_at: START,
              ended_at: "2026-08-01T01:00:00.000Z",
              idle_sec: 3600,
            },
            {
              id: "p3",
              org_id: ORG,
              vehicle_id: "v1",
              started_at: "2026-08-01T02:00:00.000Z",
              ended_at: "2026-08-01T03:00:00.000Z",
              idle_sec: 3600,
            },
            {
              id: "p4",
              org_id: ORG,
              vehicle_id: "v1",
              started_at: "2026-08-01T04:00:00.000Z",
              ended_at: "2026-08-01T05:00:00.000Z",
              idle_sec: 3600,
            },
          ],
        },
        idle_events: {
          data: [
            { vehicle_id: "v1", started_at: START, duration_sec: 3600, air_temp_f: 55 },
            { vehicle_id: "v2", started_at: START, duration_sec: 3600, air_temp_f: 5 },
            {
              vehicle_id: "v1",
              started_at: "2026-08-01T02:00:00.000Z",
              duration_sec: 1800,
              air_temp_f: 55,
            },
            {
              vehicle_id: "v1",
              started_at: "2026-08-01T04:00:00.000Z",
              duration_sec: 3600,
              air_temp_f: 55,
            },
            {
              vehicle_id: "v1",
              started_at: "2026-08-01T04:00:00.000Z",
              duration_sec: 3600,
              air_temp_f: 70,
            },
          ],
        },
        vehicles: {
          data: [
            { id: "v1", has_apu: false, apu_type: "none", has_optimized_idle: true },
            { id: "v2", has_apu: true, apu_type: "battery_hvac", has_optimized_idle: false },
          ],
        },
      },
    });

    const result = await syncIdleEquipmentEvidence(rec.client, ORG, { sinceDays: 2, endIso: END });

    expect(result).toMatchObject({
      sessions: 4,
      inside: 1,
      insufficient: 1,
      ambiguous: 1,
      unknown: 1,
      rowsWritten: 4,
    });
    expect(rec.writtenRows("idle_park_sessions")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "p1",
          equipment_profile: "optimized_idle_documented_default",
          equipment_evidence_status: "inside_documented_default",
          ambient_known_idle_sec: 3600,
          ambient_unknown_idle_sec: 0,
          ambient_avg_f: 55,
        }),
        expect.objectContaining({
          id: "p2",
          equipment_profile: "battery_hvac_unprofiled",
          equipment_evidence_status: "unknown",
        }),
        expect.objectContaining({
          id: "p3",
          equipment_evidence_status: "insufficient",
          ambient_known_idle_sec: 1800,
          ambient_unknown_idle_sec: 1800,
        }),
        expect.objectContaining({
          id: "p4",
          equipment_evidence_status: "ambiguous",
          envelope_ambiguous_sec: 3600,
        }),
      ]),
    );
    expectOrgScoped(rec, ORG);
  });

  it("does not write when the session read fails", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        idle_park_sessions: { error: { message: "session unavailable" } },
      },
    });

    await expect(syncIdleEquipmentEvidence(rec.client, ORG, { endIso: END })).rejects.toThrow(
      "Idle equipment evidence session read failed",
    );
    expect(rec.writes()).toHaveLength(0);
  });
});
