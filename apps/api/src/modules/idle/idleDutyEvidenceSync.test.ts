import { describe, expect, it } from "vitest";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type SupabaseRecorder,
} from "../../testing/supabaseRecorder.js";
import { syncIdleDutyEvidence } from "./idleDutyEvidenceSync.js";

const ORG = "org-1";
const START = "2026-08-01T00:00:00.000Z";
const END = "2026-08-02T00:00:00.000Z";

/** The RPC returns the number of rows it actually updated; scripted per test. */
const rpcUpdating = (rows: number) => ({ apply_idle_hos_evidence: rows });

/**
 * The write path is `apply_idle_hos_evidence` (migration 0174), not a table upsert. That is load-bearing:
 * a PostgREST upsert carrying only the hos_* columns compiles to `INSERT … ON CONFLICT DO UPDATE`, and
 * Postgres checks NOT NULL before conflict arbitration, so it fails on rows that already exist. These
 * helpers assert the RPC contract — and `expectNoSessionTableWrite` is the regression guard that fails if
 * anyone reintroduces a direct write to idle_park_sessions here.
 */
function hosEvidenceRows(rec: SupabaseRecorder): Record<string, unknown>[] {
  return rec
    .rpcs()
    .filter((call) => call.fn === "apply_idle_hos_evidence")
    .flatMap((call) => (call.args as { p_rows: Record<string, unknown>[] }).p_rows);
}

function expectRpcOrgScoped(rec: SupabaseRecorder, orgId: string): void {
  const calls = rec.rpcs().filter((call) => call.fn === "apply_idle_hos_evidence");
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) expect((call.args as { p_org: string }).p_org).toBe(orgId);
}

function expectNoSessionTableWrite(rec: SupabaseRecorder): void {
  expect(rec.forTable("idle_park_sessions").filter((q) => q.write !== null)).toHaveLength(0);
}

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
      rpc: rpcUpdating(3),
    });

    const result = await syncIdleDutyEvidence(rec.client, ORG, { sinceDays: 2, endIso: END });

    expect(result).toEqual({
      sessions: 3,
      sufficient: 1,
      insufficient: 1,
      ambiguous: 1,
      rowsWritten: 3,
    });
    expect(hosEvidenceRows(rec)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "p1",
          hos_evidence_status: "sufficient",
          hos_covered_sec: 10_800,
          hos_rest_sec: 10_800,
          hos_work_sec: 0,
          hos_ambiguous_sec: 0,
          hos_evidence_version: "vehicle-hos-v2",
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
    // The tenant no longer rides in the row payload — it is the RPC's p_org argument.
    expect(hosEvidenceRows(rec)[0]).not.toHaveProperty("org_id");
    expectNoSessionTableWrite(rec);
    expectRpcOrgScoped(rec, ORG);
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
    expect(rec.rpcs()).toHaveLength(0);
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
      rpc: rpcUpdating(1),
    });

    const result = await syncIdleDutyEvidence(rec.client, ORG, { sinceDays: 2, endIso: END });

    expect(result).toMatchObject({ sessions: 1, sufficient: 1, rowsWritten: 1 });
    expect(hosEvidenceRows(rec)[0]).toMatchObject({
      id: "p-driver-fallback",
      hos_evidence_status: "sufficient",
      hos_rest_sec: 3_600,
    });
    // Base park-session columns stay out of the payload — the capability sync owns them. Under the old
    // upsert that omission was what triggered the not-null violation; under the RPC it is simply an
    // UPDATE that does not touch them.
    expect(hosEvidenceRows(rec)[0]).not.toHaveProperty("vehicle_id");
    expect(hosEvidenceRows(rec)[0]).not.toHaveProperty("duration_sec");
    expectNoSessionTableWrite(rec);
    expectRpcOrgScoped(rec, ORG);
    expectOrgScoped(rec, ORG);
  });

  it("reports the row count the database actually changed, not the payload size", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        idle_park_sessions: {
          data: [
            {
              id: "p-vanished",
              org_id: ORG,
              vehicle_id: "v9",
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
        hos_duty_segments: { data: [] },
        idle_events: { data: [] },
      },
      // Capability reconciliation deleted the session between the read and the write: the UPDATE
      // matches nothing. That is a real outcome, not a silent success on one row.
      rpc: rpcUpdating(0),
    });

    const result = await syncIdleDutyEvidence(rec.client, ORG, { sinceDays: 2, endIso: END });

    expect(result).toMatchObject({ sessions: 1, rowsWritten: 0 });
  });

  it("rounds and clamps covered seconds to the persisted session duration", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        idle_park_sessions: {
          data: [
            {
              id: "p-rounding",
              org_id: ORG,
              vehicle_id: "v1",
              started_at: START,
              // Timestamp precision can produce 13449.999 seconds while duration_sec is an integer.
              ended_at: "2026-08-01T03:44:09.999Z",
              duration_sec: 13_449,
              idle_sec: 13_449,
              off_sec: 0,
              cycles: 0,
              mode: "continuous",
            },
          ],
        },
        hos_duty_segments: {
          data: [
            {
              driver_id: "d1",
              vehicle_id: "v1",
              status: "sleeper",
              started_at: START,
              ended_at: "2026-08-01T03:44:09.999Z",
            },
          ],
        },
        idle_events: { data: [] },
      },
      rpc: rpcUpdating(1),
    });

    await syncIdleDutyEvidence(rec.client, ORG, { sinceDays: 2, endIso: END });

    // Rest is reported in IDLE seconds, so it can never exceed the park's own idle. Unweighted, the
    // wall-clock overlap rounded UP to 13,450 — one second more rest than the truck had idle at all.
    expect(hosEvidenceRows(rec)[0]).toMatchObject({
      id: "p-rounding",
      hos_covered_sec: 13_449,
      hos_rest_sec: 13_449,
    });
  });

  it("reports rest in IDLE seconds, not the park's wall clock", async () => {
    // A 12 h sleeper park in which the engine idled for 9 h and was off for 3 h. The HOS overlay covers
    // the whole park, but only 9 h of it was idle: reporting 12 h of "rest idle" claims more rest than the
    // truck had idle, which is what produced 393 h of rest against 366 h of continuous idle on unit 688.
    // The reducible-idle measure reads this column directly, so the over-count fed straight into it.
    const rec = createSupabaseRecorder({
      tables: {
        idle_park_sessions: {
          data: [
            {
              id: "p-hotel",
              org_id: ORG,
              vehicle_id: "v1",
              started_at: START,
              ended_at: "2026-08-01T12:00:00.000Z",
              duration_sec: 12 * 3600,
              idle_sec: 9 * 3600,
              off_sec: 3 * 3600,
              cycles: 0,
              mode: "continuous",
            },
          ],
        },
        hos_duty_segments: {
          data: [
            {
              driver_id: "d1",
              vehicle_id: "v1",
              status: "sleeper",
              started_at: START,
              ended_at: "2026-08-01T12:00:00.000Z",
            },
          ],
        },
        idle_events: { data: [] },
      },
      rpc: rpcUpdating(1),
    });

    await syncIdleDutyEvidence(rec.client, ORG, { sinceDays: 2, endIso: END });

    const row = hosEvidenceRows(rec)[0]!;
    expect(row.hos_rest_sec).toBe(9 * 3600); // the idle, not the 12 h wall clock
    expect(Number(row.hos_rest_sec)).toBeLessThanOrEqual(9 * 3600);
  });

  it("attributes vehicle-less sleeper segments to the truck through the driver-vehicle assignment", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        idle_park_sessions: {
          data: [
            {
              id: "p-assigned",
              org_id: ORG,
              vehicle_id: "v5",
              started_at: START,
              ended_at: "2026-08-01T03:00:00.000Z",
              duration_sec: 10_800,
              idle_sec: 10_800,
              off_sec: 0,
              cycles: 0,
              mode: "continuous",
            },
          ],
        },
        // The overnight reality: the sleeper log names no truck, and no idle event carries the driver.
        hos_duty_segments: {
          data: [
            {
              driver_id: null,
              samsara_driver_id: "SD9",
              vehicle_id: null,
              status: "sleeper",
              started_at: START,
              ended_at: "2026-08-01T03:00:00.000Z",
            },
          ],
        },
        idle_events: { data: [] },
        vehicles: { data: [{ id: "v5", samsara_vehicle_id: "SV5" }] },
        driver_vehicle_assignments: {
          data: [
            {
              vehicle_samsara_id: "SV5",
              driver_samsara_id: "SD9",
              start_at: "2026-07-30T00:00:00.000Z",
              end_at: null, // open assignment — clipped to the window end
            },
          ],
        },
      },
      rpc: rpcUpdating(1),
    });

    const result = await syncIdleDutyEvidence(rec.client, ORG, { sinceDays: 2, endIso: END });

    expect(result).toMatchObject({ sessions: 1, sufficient: 1, rowsWritten: 1 });
    expect(hosEvidenceRows(rec)[0]).toMatchObject({
      id: "p-assigned",
      hos_evidence_status: "sufficient",
      hos_covered_sec: 10_800,
      hos_rest_sec: 10_800,
      hos_evidence_version: "vehicle-hos-v2",
    });
    expectNoSessionTableWrite(rec);
    expectRpcOrgScoped(rec, ORG);
    expectOrgScoped(rec, ORG);
  });

  it("never re-attributes a segment whose own logbook names a different truck", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        idle_park_sessions: {
          data: [
            {
              id: "p-log-conflict",
              org_id: ORG,
              vehicle_id: "v6",
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
              // The driver's log says this sleeper block happened in ANOTHER truck. The stale open
              // assignment below must not overrule the log and lend v6 evidence it does not have.
              driver_id: "d7",
              samsara_driver_id: "SD7",
              vehicle_id: "v-other",
              status: "sleeper",
              started_at: START,
              ended_at: "2026-08-01T01:00:00.000Z",
            },
          ],
        },
        idle_events: { data: [] },
        vehicles: { data: [{ id: "v6", samsara_vehicle_id: "SV6" }] },
        driver_vehicle_assignments: {
          data: [
            {
              vehicle_samsara_id: "SV6",
              driver_samsara_id: "SD7",
              start_at: "2026-07-30T00:00:00.000Z",
              end_at: null,
            },
          ],
        },
      },
      rpc: rpcUpdating(1),
    });

    const result = await syncIdleDutyEvidence(rec.client, ORG, { sinceDays: 2, endIso: END });

    expect(result).toMatchObject({ sessions: 1, insufficient: 1, sufficient: 0 });
    expect(hosEvidenceRows(rec)[0]).toMatchObject({
      id: "p-log-conflict",
      hos_evidence_status: "insufficient",
      hos_unknown_sec: 3_600,
    });
  });

  it("marks the session ambiguous when assignment-derived work overlaps logbook rest on one truck", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        idle_park_sessions: {
          data: [
            {
              id: "p-conflict-kinds",
              org_id: ORG,
              vehicle_id: "v8",
              started_at: START,
              ended_at: "2026-08-01T02:00:00.000Z",
              duration_sec: 7_200,
              idle_sec: 7_200,
              off_sec: 0,
              cycles: 0,
              mode: "continuous",
            },
          ],
        },
        hos_duty_segments: {
          data: [
            {
              driver_id: "d1",
              samsara_driver_id: "SD1",
              vehicle_id: "v8",
              status: "sleeper",
              started_at: START,
              ended_at: "2026-08-01T02:00:00.000Z",
            },
            {
              // A second driver assigned to the same truck was ON DUTY for the same hours — a wrong or
              // stale assignment must surface as ambiguity, not silently pick a winner.
              driver_id: "d2",
              samsara_driver_id: "SD2",
              vehicle_id: null,
              status: "on_duty",
              started_at: START,
              ended_at: "2026-08-01T02:00:00.000Z",
            },
          ],
        },
        idle_events: { data: [] },
        vehicles: { data: [{ id: "v8", samsara_vehicle_id: "SV8" }] },
        driver_vehicle_assignments: {
          data: [
            {
              vehicle_samsara_id: "SV8",
              driver_samsara_id: "SD2",
              start_at: "2026-07-30T00:00:00.000Z",
              end_at: null,
            },
          ],
        },
      },
      rpc: rpcUpdating(1),
    });

    const result = await syncIdleDutyEvidence(rec.client, ORG, { sinceDays: 2, endIso: END });

    expect(result).toMatchObject({ sessions: 1, ambiguous: 1, sufficient: 0 });
    expect(hosEvidenceRows(rec)[0]).toMatchObject({
      id: "p-conflict-kinds",
      hos_evidence_status: "ambiguous",
      hos_ambiguous_sec: 7_200,
    });
  });
});
