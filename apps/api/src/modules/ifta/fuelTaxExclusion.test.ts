import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { recordFuelTaxExclusion } from "./fuelTaxExclusion.js";

/**
 * McLeod's fuel-tax switch, turned into dated periods (0433). Every sweep calls this for every truck,
 * so the property that matters most is that the ordinary call — nothing changed — writes NOTHING.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const V = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

function recorder(openRow: { id: string; source: string; excluded_from: string } | null) {
  return createSupabaseRecorder({
    tables: { vehicle_fuel_tax_exclusions: (q) => (q.write ? [] : openRow ? [openRow] : []) },
  });
}
const run = (rec: ReturnType<typeof recorder>, excluded: boolean, day = "2026-10-05") =>
  recordFuelTaxExclusion(rec.client as unknown as SupabaseClient, ORG, V, excluded, day);

describe("recordFuelTaxExclusion", () => {
  it("writes nothing when a truck is included and nothing is open — the ordinary sweep", async () => {
    const rec = recorder(null);
    expect(await run(rec, false)).toBeNull();
    expect(rec.writtenRows("vehicle_fuel_tax_exclusions")).toEqual([]);
  });

  it("writes nothing when a truck is still excluded and its period is already open", async () => {
    const rec = recorder({ id: "p1", source: "mcleod", excluded_from: "2026-08-01" });
    expect(await run(rec, true)).toBeNull();
    expect(rec.writtenRows("vehicle_fuel_tax_exclusions")).toEqual([]);
  });

  it("opens a period from the sweep's day when the carrier first excludes the truck", async () => {
    const rec = recorder(null);
    expect(await run(rec, true)).toBe("opened");
    expect(rec.writtenRows("vehicle_fuel_tax_exclusions")).toEqual([
      { org_id: ORG, vehicle_id: V, excluded_from: "2026-10-05", source: "mcleod" },
    ]);
  });

  it("closes the open period at the sweep's day when the carrier includes the truck again", async () => {
    const rec = recorder({ id: "p1", source: "mcleod", excluded_from: "2026-08-01" });
    expect(await run(rec, false)).toBe("closed");
    const update = rec.queries.find((q) => q.table === "vehicle_fuel_tax_exclusions" && q.write?.method === "update");
    expect(update?.write?.payload).toMatchObject({ excluded_to: "2026-10-05" });
  });

  it("never closes a period the office stated by hand", async () => {
    const rec = recorder({ id: "p1", source: "manual", excluded_from: "2026-08-01" });
    expect(await run(rec, false)).toBeNull();
    expect(rec.queries.some((q) => q.write)).toBe(false);
  });

  it("leaves a period opened today open until a later day, rather than writing an empty one", async () => {
    const rec = recorder({ id: "p1", source: "mcleod", excluded_from: "2026-10-05" });
    expect(await run(rec, false, "2026-10-05")).toBeNull();
    expect(rec.queries.some((q) => q.write)).toBe(false);
  });

  it("scopes every read and write to the org — the service role bypasses RLS", async () => {
    const rec = recorder({ id: "p1", source: "mcleod", excluded_from: "2026-08-01" });
    await run(rec, false);
    expectOrgScoped(rec, ORG);
    const rec2 = recorder(null);
    await run(rec2, true);
    expectOrgScoped(rec2, ORG);
  });
});
