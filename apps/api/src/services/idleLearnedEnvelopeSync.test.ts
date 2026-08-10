import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { syncIdleLearnedEnvelopes } from "./idleLearnedEnvelopeSync.js";

const ORG = "org-1";
const END = "2026-08-02T00:00:00.000Z";

function session(
  vehicleId: string,
  temperatureF: number,
  mode: "optimized_cycling" | "continuous",
) {
  return {
    vehicle_id: vehicleId,
    mode,
    equipment_evidence_status:
      temperatureF >= 25 && temperatureF <= 90
        ? "inside_documented_default"
        : "outside_documented_default",
    ambient_avg_f: temperatureF,
    ambient_known_idle_sec: 3600,
    ambient_unknown_idle_sec: 0,
  };
}

describe("syncIdleLearnedEnvelopes", () => {
  it("learns only Optimized Idle vehicles and preserves APU as not applicable", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: {
          data: [
            { id: "v1", has_optimized_idle: true, status: "active" },
            { id: "v2", has_optimized_idle: false, status: "active" },
          ],
        },
        idle_park_sessions: {
          data: [
            ...[10, 15, 20, 25, 30].map((temperatureF) =>
              session("v1", temperatureF, "continuous"),
            ),
            ...[40, 45, 50, 55, 60, 65, 70, 75, 80, 85].map((temperatureF) =>
              session("v1", temperatureF, "optimized_cycling"),
            ),
            ...[90, 95, 100, 105, 110].map((temperatureF) =>
              session("v1", temperatureF, "continuous"),
            ),
          ],
        },
      },
    });

    const result = await syncIdleLearnedEnvelopes(rec.client, ORG, {
      sinceDays: 400,
      endIso: END,
    });

    expect(result).toEqual({
      vehicles: 2,
      sufficient: 1,
      insufficient: 0,
      notApplicable: 1,
      rowsWritten: 2,
    });
    expect(rec.writtenRows("vehicles")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "v1",
          org_id: ORG,
          idle_learned_envelope_status: "sufficient",
          idle_learned_envelope_low_f: 40,
          idle_learned_envelope_high_f: 90,
          idle_learned_envelope_sessions: 20,
          idle_learned_envelope_version: "optimized-envelope-v1",
        }),
        expect.objectContaining({
          id: "v2",
          org_id: ORG,
          idle_learned_envelope_status: "not_applicable",
          idle_learned_envelope_low_f: null,
          idle_learned_envelope_high_f: null,
        }),
      ]),
    );
    expectOrgScoped(rec, ORG);
  });

  it("does not learn from incomplete temperature evidence", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: { data: [{ id: "v1", has_optimized_idle: true, status: "active" }] },
        idle_park_sessions: {
          data: [
            {
              vehicle_id: "v1",
              mode: "optimized_cycling",
              equipment_evidence_status: "insufficient",
              ambient_avg_f: 55,
              ambient_known_idle_sec: 3600,
              ambient_unknown_idle_sec: 3600,
            },
          ],
        },
      },
    });

    const result = await syncIdleLearnedEnvelopes(rec.client, ORG, { endIso: END });

    expect(result.insufficient).toBe(1);
    expect(rec.writtenRows("vehicles")).toEqual([
      expect.objectContaining({
        id: "v1",
        idle_learned_envelope_status: "insufficient",
        idle_learned_envelope_low_f: null,
        idle_learned_envelope_high_f: null,
      }),
    ]);
  });
});
