import { describe, expect, it } from "vitest";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type SupabaseRecorder,
} from "../../testing/supabaseRecorder.js";
import { syncIdleEquipmentEvidence } from "./idleEquipmentEvidenceSync.js";

/**
 * Written through `apply_idle_equipment_evidence` (migration 0174), never a partial upsert on
 * idle_park_sessions — that upsert failed the table's NOT NULL constraints on rows that already existed.
 */
function equipmentEvidenceRows(rec: SupabaseRecorder): Record<string, unknown>[] {
  return rec
    .rpcs()
    .filter((call) => call.fn === "apply_idle_equipment_evidence")
    .flatMap((call) => (call.args as { p_rows: Record<string, unknown>[] }).p_rows);
}

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
      rpc: { apply_idle_equipment_evidence: 4 },
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
    expect(equipmentEvidenceRows(rec)).toEqual(
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
    expect(equipmentEvidenceRows(rec)[0]).not.toHaveProperty("org_id");
    expect(rec.forTable("idle_park_sessions").filter((q) => q.write !== null)).toHaveLength(0);
    for (const call of rec.rpcs()) expect((call.args as { p_org: string }).p_org).toBe(ORG);
    expectOrgScoped(rec, ORG);
  });

  it("prefers the session's OWN weather over a borrowed idle-event temperature", async () => {
    // The dependency this removes: the session's idle seconds come from engineStates, the event's from
    // Samsara's own detector, and where they disagree the borrowed reading decided the verdict. Here the
    // overlapping event says 5 degF (outside the 25-90 degF band) while the park's own location says 60 degF
    // (inside it). The park's own reading must win, and the row must say where it came from.
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
              lat: 41.88,
              lng: -87.63,
            },
          ],
        },
        idle_events: {
          data: [{ vehicle_id: "v1", started_at: START, duration_sec: 3600, air_temp_f: 5 }],
        },
        vehicles: { data: [{ id: "v1", has_apu: null, apu_type: null, has_optimized_idle: true }] },
        weather_cache: {
          data: [{ hour_utc: "2026-08-01T00:00:00Z", temp_f: 60 }],
        },
      },
      rpc: { apply_idle_equipment_evidence: 1 },
    });

    await syncIdleEquipmentEvidence(rec.client, ORG, {
      endIso: END,
      sinceDays: 1,
      weatherFetcher: async () => null, // cache hit only; no external call needed
    });

    const row = equipmentEvidenceRows(rec)[0]!;
    expect(row.ambient_source).toBe("session_weather");
    expect(row.envelope_inside_sec).toBe(3600); // 60 degF, inside the band
    expect(row.envelope_outside_sec).toBe(0); // NOT the 5 degF the idle event claimed
    expect(row.equipment_evidence_status).toBe("inside_documented_default");
  });

  it("falls back to the idle-event temperature for a session with no location", async () => {
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
              lat: null,
              lng: null,
            },
          ],
        },
        idle_events: {
          data: [{ vehicle_id: "v1", started_at: START, duration_sec: 3600, air_temp_f: 5 }],
        },
        vehicles: { data: [{ id: "v1", has_apu: null, apu_type: null, has_optimized_idle: true }] },
        weather_cache: { data: [] },
      },
      rpc: { apply_idle_equipment_evidence: 1 },
    });

    await syncIdleEquipmentEvidence(rec.client, ORG, {
      endIso: END,
      sinceDays: 1,
      weatherFetcher: async () => null,
    });

    const row = equipmentEvidenceRows(rec)[0]!;
    expect(row.ambient_source).toBe("idle_events");
    expect(row.envelope_outside_sec).toBe(3600); // 5 degF, outside the band
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
    expect(rec.rpcs()).toHaveLength(0);
  });
});
