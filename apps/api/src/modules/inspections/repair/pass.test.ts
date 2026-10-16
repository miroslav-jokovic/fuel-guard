import { describe, expect, it } from "vitest";
import { REPAIR_ENGINE_VERSION } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { proposeRepair } from "./propose.js";
import { proposeRepairs } from "./pass.js";

/**
 * The repair pass (IC11): which units it reads, and when it writes. Pinned: a unit a person decided is never
 * proposed again, an unchanged reading writes nothing, and a unit past its follow window keeps its last row.
 */

const ORG = "11111111-1111-1111-1111-111111111111";
const ZONE = "America/Chicago";
const NOW = Date.parse("2026-10-16T17:00:00Z");

const recorder = (repairs: Record<string, unknown>[] = [], inspectionDate = "2026-10-06") =>
  createSupabaseRecorder({
    tables: {
      roadside_inspections: () => ({ data: [{ id: "i-1", inspection_date: inspectionDate }] }),
      roadside_violations: () => ({ data: [{ inspection_id: "i-1", unit_id: "u-1", defect_verification_id: "3" }] }),
      roadside_inspection_units: () => ({ data: [{ id: "u-1", vehicle_id: "v-1", trailer_id: null }, { id: "u-2", vehicle_id: "v-2", trailer_id: null }] }),
      inspection_repairs: (q) => (q.write ? { data: [] } : { data: repairs }),
      fleetpal_units: () => ({ data: [{ fleetpal_id: "fu-1", vehicle_id: "v-1", trailer_id: null }] }),
      fleetpal_work_orders: () => ({
        data: [{ fleetpal_id: "wo-1", reference_number: "WO-1", status: "OPEN", unit_fleetpal_id: "fu-1", vendor_created_at: "2026-10-07T15:00:00Z", completed: null, description: "DOT" }],
      }),
      fleetpal_jobs: () => ({ data: [{ work_order_fleetpal_id: "wo-1", name: "Brake chamber" }] }),
    },
  });

/** The hash the pass will compute for the fixture's unit, from the same pure rule. */
const fixtureHash = () =>
  proposeRepair(
    { inspectionDate: "2026-10-06", vehicleId: "v-1", trailerId: null, defectVerifications: ["3"] },
    {
      vehiclesInFleetpal: new Set(["v-1"]),
      trailersInFleetpal: new Set(),
      orders: [{ vehicleId: "v-1", trailerId: null, fleetpalId: "wo-1", reference: "WO-1", status: "OPEN", openedAt: "2026-10-07T15:00:00Z", completedAt: null, description: "DOT", jobs: ["Brake chamber"] }],
    },
    ZONE,
  ).sha256;

describe("proposeRepairs", () => {
  it("proposes the unit's work order, org-scoped, only for the unit with a vehicle violation", async () => {
    const rec = recorder();
    expect(await proposeRepairs(rec.client, ORG, ZONE, NOW)).toEqual({ one_candidate: 1 });
    const [row] = rec.writtenRows("inspection_repairs");
    expect(row).toMatchObject({
      org_id: ORG, inspection_id: "i-1", inspection_unit_id: "u-1", source: "engine", engine_version: REPAIR_ENGINE_VERSION,
      outcome: "one_candidate", due_on: "2026-10-21",
    });
    expect((row!.candidates as { workOrderId: string; jobs: string[] }[])[0]).toMatchObject({ workOrderId: "wo-1", jobs: ["Brake chamber"] });
    expect(rec.writtenRows("inspection_repairs")).toHaveLength(1);
    expectOrgScoped(rec, ORG);
  });

  it("⚠ never proposes after a person decided", async () => {
    const rec = recorder([{ inspection_unit_id: "u-1", source: "person", engine_version: REPAIR_ENGINE_VERSION, candidates_sha256: null }]);
    expect(await proposeRepairs(rec.client, ORG, ZONE, NOW)).toEqual({});
    expect(rec.writtenRows("inspection_repairs")).toHaveLength(0);
  });

  it("⚠ writes nothing when the reading has not changed", async () => {
    const rec = recorder([{ inspection_unit_id: "u-1", source: "engine", engine_version: REPAIR_ENGINE_VERSION, candidates_sha256: fixtureHash() }]);
    expect(await proposeRepairs(rec.client, ORG, ZONE, NOW)).toEqual({});
    expect(rec.writtenRows("inspection_repairs")).toHaveLength(0);
  });

  it("writes the change when the unit's last reading differs", async () => {
    const rec = recorder([{ inspection_unit_id: "u-1", source: "engine", engine_version: REPAIR_ENGINE_VERSION, candidates_sha256: "b".repeat(64) }]);
    expect(await proposeRepairs(rec.client, ORG, ZONE, NOW)).toEqual({ one_candidate: 1 });
  });

  it("leaves a unit past its follow window on its last reading, but reads one that has none", async () => {
    const old = [{ inspection_unit_id: "u-1", source: "engine", engine_version: REPAIR_ENGINE_VERSION, candidates_sha256: "b".repeat(64) }];
    const stale = recorder(old, "2026-07-01");
    expect(await proposeRepairs(stale.client, ORG, ZONE, NOW)).toEqual({});
    const fresh = recorder([], "2026-07-01");
    expect(await proposeRepairs(fresh.client, ORG, ZONE, NOW)).toEqual({ no_candidate: 1 });
  });
});
