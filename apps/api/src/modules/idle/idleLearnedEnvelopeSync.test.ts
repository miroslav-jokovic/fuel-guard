import { describe, expect, it } from "vitest";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type SupabaseRecorder,
} from "../../testing/supabaseRecorder.js";
import { syncIdleLearnedEnvelopes } from "./idleLearnedEnvelopeSync.js";

const ORG = "org-1";
const END = "2026-08-02T00:00:00.000Z";

/**
 * Written through `apply_idle_learned_envelope` (migration 0175) — never an upsert on `vehicles`. The
 * upsert failed the table's NOT NULL constraints (`unit_number`, `tank_capacity_gal`) on rows that
 * already existed, and would have let an evidence job CREATE a fleet row if it had not.
 */
function envelopeRows(rec: SupabaseRecorder): Record<string, unknown>[] {
  return rec
    .rpcs()
    .filter((call) => call.fn === "apply_idle_learned_envelope")
    .flatMap((call) => (call.args as { p_rows: Record<string, unknown>[] }).p_rows);
}

function expectNoVehicleTableWrite(rec: SupabaseRecorder): void {
  expect(rec.forTable("vehicles").filter((q) => q.write !== null)).toHaveLength(0);
}

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
      rpc: { apply_idle_learned_envelope: 2 }, // rows the DB reports it updated
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
    expect(envelopeRows(rec)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "v1",
          idle_learned_envelope_status: "sufficient",
          idle_learned_envelope_low_f: 40,
          idle_learned_envelope_high_f: 90,
          idle_learned_envelope_sessions: 20,
          idle_learned_envelope_version: "optimized-envelope-v1",
        }),
        expect.objectContaining({
          id: "v2",
          idle_learned_envelope_status: "not_applicable",
          idle_learned_envelope_low_f: null,
          idle_learned_envelope_high_f: null,
        }),
      ]),
    );
    // The tenant is the RPC's p_org argument now, not a column in the payload.
    expect(envelopeRows(rec)[0]).not.toHaveProperty("org_id");
    expectNoVehicleTableWrite(rec);
    for (const call of rec.rpcs()) expect((call.args as { p_org: string }).p_org).toBe(ORG);
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
      rpc: { apply_idle_learned_envelope: 1 }, // rows the DB reports it updated
    });

    const result = await syncIdleLearnedEnvelopes(rec.client, ORG, { endIso: END });

    expect(result.insufficient).toBe(1);
    expect(envelopeRows(rec)).toEqual([
      expect.objectContaining({
        id: "v1",
        idle_learned_envelope_status: "insufficient",
        idle_learned_envelope_low_f: null,
        idle_learned_envelope_high_f: null,
      }),
    ]);
    expectNoVehicleTableWrite(rec);
  });
});
