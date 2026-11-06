import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { recordHireFromTms } from "./hireApplicant.js";

/**
 * A hire the carrier made in McLeod, recorded here (ROSTER-LIFECYCLE-PLAN D-RL5). Pinned: it goes
 * through the same transaction as the Hire button with McLeod's date and no person as actor, it is
 * NOT refused for an unfinished file (the button's Q-HM5 rule) but says what is unfinished, and it
 * closes the application's links like any hire.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "3d62c87f-fcbb-4d62-bdc5-96621bc11554";
const selectOf = (q: RecordedQuery): string => String(q.ops.find((o) => o.method === "select")?.args[0] ?? "");

const seed = (over: { evidence?: string[]; rpcError?: { code: string; message: string } } = {}) =>
  createSupabaseRecorder({
    tables: {
      drivers: [{ id: DRIVER, full_name: "CURTIS HAIRSTON", status: "applicant", hire_date: null }],
      driver_employment_history: [],
      qualification_records: (q: RecordedQuery) =>
        selectOf(q).includes("jurisdiction")
          ? (over.evidence ?? []).map((kind) => ({ driver_id: DRIVER, kind, occurred_on: "2026-10-22" }))
          : [],
      application_invitations: [{ id: "inv-1", created_at: "2026-10-21T00:00:00Z", submitted_at: "2026-10-21T17:37:28Z" }],
      audit_logs: [],
      recruiting_settings: [],
      hiring_carrier_steps: [],
      hiring_carrier_step_records: [],
    },
    rpc: { hire_applicant: over.rpcError ? { error: over.rpcError } : { status: "active", hire_date: "2026-10-28", filed: 0 } },
  });

const facts = { driverId: DRIVER, externalId: "CHAIRSTO", hireDate: "2026-10-28" };

describe("recording a McLeod hire", () => {
  it("goes through hire_applicant with McLeod's hire date and no person as the actor", async () => {
    const rec = seed();
    await recordHireFromTms(rec.client, ORG, facts);
    const call = rec.rpcs().find((r) => r.fn === "hire_applicant")!;
    expect(call.args).toMatchObject({ p_org: ORG, p_driver: DRIVER, p_hire_date: "2026-10-28", p_actor: null });
    expectOrgScoped(rec, ORG);
  });

  it("is not refused for an unfinished file, and names what the file still lacks on the audit row", async () => {
    const rec = seed({ evidence: [] });
    const result = await recordHireFromTms(rec.client, ORG, facts);
    expect("code" in result).toBe(false);
    const audit = rec.writtenRows("audit_logs").find((a) => a.action === "driver.hired_from_tms")!;
    expect(audit).toMatchObject({ entity_id: DRIVER, actor_id: null });
    const meta = audit.meta as { externalId: string; hireDate: string; openSteps: string[] };
    expect(meta).toMatchObject({ externalId: "CHAIRSTO", hireDate: "2026-10-28" });
    expect(meta.openSteps).toContain("mvr");
    expect((result as { openSteps: string[] }).openSteps).toEqual(meta.openSteps);
  });

  it("ends the application's links, as any hire does", async () => {
    const rec = seed();
    await recordHireFromTms(rec.client, ORG, facts);
    expect(rec.writtenRows("application_invitations").some((w) => "expires_at" in w)).toBe(true);
  });

  it("returns the transaction's refusal and audits nothing when the hire did not happen", async () => {
    const rec = seed({ rpcError: { code: "HA010", message: "hire_applicant_not_applicant" } });
    const result = await recordHireFromTms(rec.client, ORG, facts);
    expect(result).toMatchObject({ code: "not_an_applicant" });
    expect(rec.writtenRows("audit_logs")).toEqual([]);
  });
});
