import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { actOnMedstopResults } from "./outcomes.js";

/**
 * What a new Med-Stop result does (MS2b, F-4/F-5). Proved here: a verified negative pre-employment
 * drug test files the hiring step's record — once, by nobody, citing Med-Stop's id; a violation, a
 * dilute and an unknown wording reach exactly the roles that may read testing records; a violation on
 * a name-only match says dispatch was NOT stopped; a drug result before review, and an unmatched
 * applicant's negative inside the wait, are left for the next sweep; a failed filing is not marked.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TODAY = "2026-10-13";

const t = (id: string, extra: Record<string, unknown>) => ({
  medstop_id: id, employee_medstop_id: "e-certain", service: "TD", reason: "RANDOM", status: "CLOSED",
  result: "NEGATIVE", collected_local: "2026-10-09T14:24:00", ...extra,
});
const TESTS = [
  t("t-neg", { reason: "PRE-EMPLOYMENT" }),
  t("t-pos", { result: "POSITIVE" }),
  t("t-ref", { result: "REFUSAL TO TEST", employee_medstop_id: "e-name" }),
  t("t-dil", { result: "NEGATIVE - DILUTE" }),
  t("t-lab", { result: "POSITIVE", status: "AT LAB" }),
  t("t-wait", { reason: "PRE-EMPLOYMENT", employee_medstop_id: "e-none", collected_local: "2026-10-03T08:00:00" }),
  t("t-gone", { reason: "PRE-EMPLOYMENT", employee_medstop_id: "e-none", collected_local: "2026-08-01T08:00:00" }),
];
const PEOPLE = [
  { medstop_id: "e-certain", driver_id: "d1", match_rule: "licence", first_name: "PAT", last_name: "DRIVER" },
  { medstop_id: "e-name", driver_id: "d2", match_rule: "name", first_name: "SAM", last_name: "SAME" },
];

function recorder(qualification: object = {}) {
  return createSupabaseRecorder({
    tables: {
      medstop_tests: TESTS,
      medstop_employees: PEOPLE,
      drivers: [{ id: "d1", full_name: "Pat Driver" }, { id: "d2", full_name: "Sam Same" }],
      memberships: [{ user_id: "u-admin" }, { user_id: "u-safety" }],
      driver_app_features: [],
      qualification_records: qualification,
    },
    rpc: () => ({ data: "n1", error: null }),
  });
}

const handled = (queries: RecordedQuery[]) =>
  queries.filter((q) => q.write?.method === "update").map((q) => ({
    id: q.filters().find((f) => f.col === "medstop_id")?.val,
    outcome: (q.write!.payload as { outcome_handled: string }).outcome_handled,
  }));

describe("actOnMedstopResults", () => {
  it("files, alerts and marks exactly what is new and final — scoped to the org", async () => {
    const db = recorder();
    const result = await actOnMedstopResults(db.client, ORG, TODAY);

    const filed = db.writtenRows("qualification_records");
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({
      org_id: ORG, driver_id: "d1", kind: "drug_test", occurred_on: "2026-10-09", result: "negative",
      performed_by: "Med-Stop", reference: "t-neg", created_by: null, detail: expect.objectContaining({ source: "medstop" }),
    });

    const sent = db.rpcs().filter((r) => r.fn === "emit_notification").map((r) => r.args as Record<string, string>);
    expect(sent.map((s) => s.p_user).sort()).toEqual(["u-admin", "u-admin", "u-admin", "u-safety", "u-safety", "u-safety"]);
    const pos = sent.find((s) => s.p_entity_id === "t-pos")!;
    expect(pos).toMatchObject({ p_category: "drug_alcohol_result", p_severity: "critical", p_dedupe_key: "medstop-result:t-pos:positive" });
    expect(pos.p_body).toContain("Pat Driver: verified positive on a random drug test collected 10/09/2026. Dispatch is stopped");
    expect(sent.find((s) => s.p_entity_id === "t-ref")!.p_body).toContain("dispatch was NOT stopped");
    expect(sent.find((s) => s.p_entity_id === "t-dil")!.p_severity).toBe("warning");

    expect(handled(db.forTable("medstop_tests")).sort((a, b) => String(a.id).localeCompare(String(b.id)))).toEqual([
      { id: "t-dil", outcome: "negative_dilute" },
      { id: "t-gone", outcome: "negative" },
      { id: "t-neg", outcome: "negative" },
      { id: "t-pos", outcome: "positive" },
      { id: "t-ref", outcome: "refusal" },
    ]);
    expect(result).toEqual({ filed: 1, alerted: 3, handled: 5 });

    const unhandled = db.forTable("medstop_tests").find((q) => !q.write)!;
    expect(unhandled.filters()).toContainEqual({ col: "baseline", val: false });
    expect(db.forTable("memberships")[0]!.filters()).toContainEqual({ col: "role", val: ["admin", "safety_manager"] });
    expectOrgScoped(db, ORG);
  });

  it("a filing that fails is not marked, so the next sweep files it", async () => {
    const db = recorder({ writeError: { code: "57014", message: "statement timeout" } });
    await actOnMedstopResults(db.client, ORG, TODAY);
    expect(handled(db.forTable("medstop_tests")).map((h) => h.id)).not.toContain("t-neg");
  });

  it("a filing already on file (0466's 23505) is done, not failed", async () => {
    const db = recorder({ writeError: { code: "23505", message: "duplicate key" } });
    const result = await actOnMedstopResults(db.client, ORG, TODAY);
    expect(handled(db.forTable("medstop_tests")).map((h) => h.id)).toContain("t-neg");
    expect(result.filed).toBe(1);
  });
});
