import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
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

/**
 * D-HIRE5: an applicant is a `drivers` row, and the §391.51 queue must never admit one — there is no
 * qualification file for somebody who is not employed, and listing them as "missing a medical card"
 * would be a compliance finding against a person we have not hired. The overview selects by
 * INCLUSION (`["active", "on_leave"]`), which is what makes that true; this pins it, because an
 * exclusion list would have admitted the status silently.
 */
describe("applicant scoping", () => {
  it("selects active and on_leave by inclusion, so a new status is never admitted by default", () => {
    const src = readFileSync(new URL("./complianceOverview.ts", import.meta.url), "utf8");
    expect(src).toContain('.in("status", ["active", "on_leave"])');
    expect(src).not.toMatch(/neq\("status"/);
  });
});

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

  it("carries computed state only — no record payloads the restricted-kind filter could miss (Phase G)", async () => {
    const rec = makeRecorder([{ id: "d1", full_name: "A Driver", status: "active" }]);
    const result = await getComplianceOverview(rec.client, ORG, "2026-08-19");
    // A dispatcher may see restricted items' STATE (D-DQ15) but never the records behind them. The
    // overview satisfies that by construction — it returns no evidence rows at all — and this pins
    // the shape so a future field addition has to face the question.
    expect(Object.keys(result.drivers[0]!).sort()).toEqual(
      ["attention", "counts", "driver_id", "driver_name", "driver_status", "groups", "state"],
    );
  });

  it("a 60-day-out item is invisible at the default horizon and present at 91 (C2 — the assertion that would have caught the plan's own defect)", async () => {
    const rec = () =>
      createSupabaseRecorder({
        tables: {
          drivers: [{ id: "d1", full_name: "A Driver", status: "active", cdl_number: "D123" }],
          certifications: [
            {
              subject_id: "d1", kind: "medical_card", qualifier: null, training_type: null,
              issued_at: "2026-01-01", expires_at: "2026-10-18", document_id: null, // 60 days from TODAY
            },
          ],
          qualification_records: [],
          documents: [],
        },
        rpc: { org_module_enabled: false },
      });
    const TODAY = "2026-08-19";

    const narrow = await getComplianceOverview(rec().client, ORG, TODAY);
    expect(narrow.drivers[0]!.attention.map((a) => a.key)).not.toContain("medical_card");

    const wide = await getComplianceOverview(rec().client, ORG, TODAY, { expiringWithinDays: 91 });
    const medical = wide.drivers[0]!.attention.find((a) => a.key === "medical_card");
    expect(medical).toBeDefined();
    expect(medical!.state).toBe("expiring");
    expect(medical!.daysRemaining).toBe(60);
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
