import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  readFixedCostsForMonths,
} from "./costSchedules.js";

const ORG = "11111111-1111-1111-1111-111111111111";

const ROWS = [
  { id: "a", unit_number: "754", category: "lease", label: "VIP Lease 754", monthly_amount: "2500.00", effective_from: "2026-01-01", effective_to: null, notes: null },
  { id: "b", unit_number: "754", category: "insurance", label: "Policy 9 unit 754", monthly_amount: "1100.50", effective_from: "2026-01-01", effective_to: "2026-06-01", notes: null },
];

describe("costSchedules", () => {
  it("lists an org's rows with numeric amounts, org-scoped", async () => {
    const rec = createSupabaseRecorder({ tables: { truck_cost_schedules: ROWS } });
    const rows = await listSchedules(rec.client, ORG);
    expect(rows).toHaveLength(2);
    // numeric comes back as a string from PostgREST; the service converts before anything sums.
    expect(rows[0]!.monthly_amount).toBe(2500);
    expectOrgScoped(rec, ORG);
  });

  it("charges only rows whose half-open range covers the month — June excludes the row ended 2026-06-01", async () => {
    const rec = createSupabaseRecorder({ tables: { truck_cost_schedules: ROWS } });
    const s = await readFixedCostsForMonths(rec.client, ORG, [{ year: 2026, month: 6 }]);
    expect(s.byUnit["754"]).toBe(2500);
    expect(s.byCategory["insurance"]).toBeUndefined();
    expect(s.total).toBe(2500);
    expectOrgScoped(rec, ORG);
  });

  it("an empty month list reads nothing at all", async () => {
    const rec = createSupabaseRecorder({ tables: { truck_cost_schedules: ROWS } });
    const s = await readFixedCostsForMonths(rec.client, ORG, []);
    expect(s.total).toBe(0);
    expect(rec.queries.length).toBe(0);
  });

  it("create carries the org in the payload; update and delete filter by org AND id", async () => {
    const rec = createSupabaseRecorder({ tables: { truck_cost_schedules: ROWS } });
    await createSchedule(rec.client, ORG, {
      unit_number: "801",
      category: "gps",
      label: "Samsara unit 801",
      monthly_amount: 45,
      effective_from: "2026-07-01",
    });
    const inserted = rec.writtenRows("truck_cost_schedules");
    expect(inserted[0]).toMatchObject({ org_id: ORG, unit_number: "801", category: "gps" });

    await updateSchedule(rec.client, ORG, "a", { effective_to: "2026-09-01" });
    await deleteSchedule(rec.client, ORG, "b");
    expectOrgScoped(rec, ORG);
  });
});
