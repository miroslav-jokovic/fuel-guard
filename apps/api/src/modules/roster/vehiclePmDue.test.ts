import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { recordVehiclePmDue } from "./vehiclePmDue.js";

/** F11's door into `vehicles` (D-FP2): writes only what changed, and nothing for a row the org lacks. */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("recordVehiclePmDue", () => {
  it("updates the rows whose due point changed, skips the unchanged, and ignores an id this org does not have", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: {
          data: [
            { id: "v-same", next_pm_due_odometer: "120000", next_pm_due_at: "2026-11-01" },
            { id: "v-moved", next_pm_due_odometer: null, next_pm_due_at: "2026-11-01" },
            { id: "v-cleared", next_pm_due_odometer: 90_000, next_pm_due_at: null },
          ],
        },
      },
    });
    const changed = await recordVehiclePmDue(rec.client, ORG, [
      { vehicleId: "v-same", nextPmDueOdometer: 120_000, nextPmDueAt: "2026-11-01" },
      { vehicleId: "v-moved", nextPmDueOdometer: 125_000, nextPmDueAt: "2026-11-01" },
      { vehicleId: "v-cleared", nextPmDueOdometer: null, nextPmDueAt: null },
      { vehicleId: "v-foreign", nextPmDueOdometer: 1, nextPmDueAt: "2026-01-01" },
    ]);
    expectOrgScoped(rec, ORG);
    expect(changed).toBe(2);
    const writes = rec.writes().map((w) => [w.filters().find((f) => f.col === "id")?.val, w.write?.payload]);
    expect(writes).toEqual([
      ["v-moved", { next_pm_due_odometer: 125_000, next_pm_due_at: "2026-11-01" }],
      ["v-cleared", { next_pm_due_odometer: null, next_pm_due_at: null }],
    ]);
  });

  it("writes nothing when handed nothing", async () => {
    const rec = createSupabaseRecorder({ tables: { vehicles: { data: [] } } });
    expect(await recordVehiclePmDue(rec.client, ORG, [])).toBe(0);
    expect(rec.queries).toHaveLength(0);
  });
});
