import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { syncIdleDutyEvidence } from "./idleDutyEvidenceSync.js";

const ORG = "org-1";
const START = "2026-08-01T00:00:00.000Z";
const END = "2026-08-02T00:00:00.000Z";

describe("syncIdleDutyEvidence", () => {
  it("writes full rest/work coverage and preserves ambiguity instead of guessing", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        idle_park_sessions: {
          pages: [
            [
              {
                id: "p1",
                org_id: ORG,
                vehicle_id: "v1",
                started_at: START,
                ended_at: "2026-08-01T03:00:00.000Z",
                duration_sec: 10_800,
                idle_sec: 10_800,
                off_sec: 0,
                cycles: 0,
                mode: "continuous",
              },
              {
                id: "p2",
                org_id: ORG,
                vehicle_id: "v2",
                started_at: START,
                ended_at: "2026-08-01T02:00:00.000Z",
                duration_sec: 7_200,
                idle_sec: 7_200,
                off_sec: 0,
                cycles: 0,
                mode: "continuous",
              },
              {
                id: "p3",
                org_id: ORG,
                vehicle_id: "v3",
                started_at: START,
                ended_at: "2026-08-01T01:00:00.000Z",
                duration_sec: 3_600,
                idle_sec: 3_600,
                off_sec: 0,
                cycles: 0,
                mode: "continuous",
              },
            ],
          ],
        },
        hos_duty_segments: {
          pages: [
            [
              {
                driver_id: "d1",
                vehicle_id: "v1",
                status: "sleeper",
                started_at: START,
                ended_at: "2026-08-01T03:00:00.000Z",
              },
              {
                driver_id: "d2",
                vehicle_id: "v2",
                status: "sleeper",
                started_at: START,
                ended_at: "2026-08-01T02:00:00.000Z",
              },
              {
                driver_id: "d3",
                vehicle_id: "v2",
                status: "on_duty",
                started_at: "2026-08-01T01:00:00.000Z",
                ended_at: "2026-08-01T02:00:00.000Z",
              },
            ],
          ],
        },
        idle_events: { pages: [[]] },
      },
    });

    const result = await syncIdleDutyEvidence(rec.client, ORG, { sinceDays: 2, endIso: END });

    expect(result).toEqual({
      sessions: 3,
      sufficient: 1,
      insufficient: 1,
      ambiguous: 1,
      rowsWritten: 3,
    });
    expect(rec.writtenRows("idle_park_sessions")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "p1",
          org_id: ORG,
          hos_evidence_status: "sufficient",
          hos_covered_sec: 10_800,
          hos_rest_sec: 10_800,
          hos_work_sec: 0,
          hos_ambiguous_sec: 0,
          hos_evidence_version: "vehicle-hos-v1",
        }),
        expect.objectContaining({
          id: "p2",
          hos_evidence_status: "ambiguous",
          hos_covered_sec: 7_200,
          hos_rest_sec: 3_600,
          hos_work_sec: 0,
          hos_ambiguous_sec: 3_600,
        }),
        expect.objectContaining({
          id: "p3",
          hos_evidence_status: "insufficient",
          hos_covered_sec: 0,
          hos_unknown_sec: 3_600,
        }),
      ]),
    );
    expectOrgScoped(rec, ORG);
  });

  it("fails before writes when the HOS read fails", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        idle_park_sessions: {
          data: [
            {
              id: "p1",
              org_id: ORG,
              vehicle_id: "v1",
              started_at: START,
              ended_at: END,
              duration_sec: 86_400,
              idle_sec: 86_400,
              off_sec: 0,
              cycles: 0,
              mode: "continuous",
            },
          ],
        },
        hos_duty_segments: { error: { message: "HOS unavailable" } },
      },
    });

    await expect(syncIdleDutyEvidence(rec.client, ORG, { endIso: END })).rejects.toThrow(
      "HOS segment read failed",
    );
    expect(rec.writes()).toHaveLength(0);
  });

  it("uses explicit idle-event driver attribution when the HOS log has no vehicle link", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        idle_park_sessions: {
          data: [
            {
              id: "p-driver-fallback",
              org_id: ORG,
              vehicle_id: "v4",
              started_at: START,
              ended_at: "2026-08-01T01:00:00.000Z",
              duration_sec: 3_600,
              idle_sec: 3_600,
              off_sec: 0,
              cycles: 0,
              mode: "continuous",
            },
          ],
        },
        hos_duty_segments: {
          data: [
            {
              driver_id: "d4",
              vehicle_id: null,
              status: "sleeper",
              started_at: START,
              ended_at: "2026-08-01T01:00:00.000Z",
            },
          ],
        },
        idle_events: {
          data: [
            {
              vehicle_id: "v4",
              driver_id: "d4",
              started_at: START,
              duration_sec: 3_600,
            },
          ],
        },
      },
    });

    const result = await syncIdleDutyEvidence(rec.client, ORG, { sinceDays: 2, endIso: END });

    expect(result).toMatchObject({ sessions: 1, sufficient: 1, rowsWritten: 1 });
    expect(rec.writtenRows("idle_park_sessions")[0]).toMatchObject({
      id: "p-driver-fallback",
      vehicle_id: "v4",
      started_at: START,
      ended_at: "2026-08-01T01:00:00.000Z",
      duration_sec: 3_600,
      idle_sec: 3_600,
      off_sec: 0,
      cycles: 0,
      mode: "continuous",
      hos_evidence_status: "sufficient",
      hos_rest_sec: 3_600,
    });
    expectOrgScoped(rec, ORG);
  });
});
