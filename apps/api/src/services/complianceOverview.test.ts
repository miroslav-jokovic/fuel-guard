import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { getComplianceOverview } from "./complianceOverview.js";

/**
 * The overview's driver read decides who owes a §391.51 file, and it runs on the SERVICE ROLE — RLS
 * is not a second line of defence here, so the query itself is what these tests pin:
 *   - employed only (`status in active,on_leave` — commit 3876960, which shipped with no test), and
 *   - real identities only (`identity_source <> 'efs'` — 0204/A6: a fuel-card name-stub asserts
 *     `active` with no employment behind it; a third of the measured queue was these).
 */
const ORG = "org1";

function makeRecorder(drivers: unknown[]) {
  return createSupabaseRecorder({
    tables: {
      drivers,
      certifications: [],
      qualification_records: [],
      documents: [],
    },
    rpc: { org_module_enabled: false },
  });
}

describe("getComplianceOverview — the driver predicate", () => {
  it("filters to employed, non-EFS drivers and stays org-scoped", async () => {
    const rec = makeRecorder([{ id: "d1", full_name: "A Driver", status: "active" }]);
    const result = await getComplianceOverview(rec.client, ORG, "2026-08-19");

    const driversQ = rec.queries.find((q) => q.table === "drivers");
    expect(driversQ).toBeDefined();
    expect(driversQ!.ops).toContainEqual({ method: "in", args: ["status", ["active", "on_leave"]] });
    expect(driversQ!.ops).toContainEqual({ method: "neq", args: ["identity_source", "efs"] });
    expect(result.drivers).toHaveLength(1);
    expectOrgScoped(rec, ORG);
  });

  it("computes a file for every returned driver even with zero evidence rows", async () => {
    const rec = makeRecorder([
      { id: "d1", full_name: "A Driver", status: "active" },
      { id: "d2", full_name: "B Driver", status: "on_leave" },
    ]);
    const result = await getComplianceOverview(rec.client, ORG, "2026-08-19");
    expect(result.drivers.map((d) => d.state)).toEqual(["not_started", "not_started"]);
    expect(result.truncated).toBe(false);
  });
});
