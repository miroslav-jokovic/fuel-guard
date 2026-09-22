import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { affectedVehicleIds } from "./index.js";

/** The read now pages (cascadeScope.ts), so the fake is the recorder rather than a fixed chain. */
function makeAdmin(rows: { vehicle_id: string | null; fueled_at?: string }[]) {
  return createSupabaseRecorder({
    tables: { fuel_transactions: rows.map((r) => ({ fueled_at: "2026-09-01T00:00:00.000Z", ...r })) },
  });
}

describe("affectedVehicleIds (cascade scope)", () => {
  it("returns the distinct non-null vehicle ids from an import's rows", async () => {
    const rec = makeAdmin([
      { vehicle_id: "v1" },
      { vehicle_id: "v1" }, // dup
      { vehicle_id: "v2" },
      { vehicle_id: null }, // unattributed → excluded
    ]);
    const ids = await affectedVehicleIds(rec.client, "org1", "imp1");
    expect(ids.sort()).toEqual(["v1", "v2"]);
    expectOrgScoped(rec, "org1");
  });

  it("returns an empty list when the import attributed no vehicles", async () => {
    const rec = makeAdmin([{ vehicle_id: null }]);
    expect(await affectedVehicleIds(rec.client, "org1", "imp1")).toEqual([]);
  });
});
