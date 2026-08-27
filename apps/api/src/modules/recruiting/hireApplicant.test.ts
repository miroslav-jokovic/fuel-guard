import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { hireApplicant, isHireError, previewHire } from "./hireApplicant.js";

/**
 * The hire, and the two things it must never do: file evidence under a date nobody recorded, and
 * write the same screening into the file twice.
 *
 * The rules themselves are pinned in `packages/shared/src/hireHandoff.test.ts`; what is pinned here
 * is that this service passes the RIGHT rows to the transaction — the drafts, the org, the actor —
 * and reports back what it could not file.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const TODAY = "2026-08-19";

const EMPLOYER = {
  id: "emp-1",
  employer_name: "Old Carrier",
  usdot_number: "123456",
  dot_regulated: true,
  inquiry_status: "responded",
  inquiry_sent_on: "2026-07-01",
  inquiry_response_on: "2026-07-14",
};

const seed = (over: { drivers?: unknown[]; employment?: unknown[]; records?: unknown[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      drivers: over.drivers ?? [{ id: DRIVER, full_name: "An Applicant", status: "applicant" }],
      driver_employment_history: over.employment ?? [EMPLOYER],
      qualification_records: over.records ?? [],
      audit_logs: [],
    },
    rpc: { hire_applicant: { status: "active", hire_date: "2026-09-01", filed: 2 } },
  });

const body = { driver_id: DRIVER, hire_date: "2026-09-01" };

describe("hiring an applicant", () => {
  it("hands the transaction the driver, the date, the actor and the drafts", async () => {
    const rec = seed();
    const result = await hireApplicant(rec.client, ORG, "u-fleet", body, TODAY);

    expect(isHireError(result)).toBe(false);
    const call = rec.rpcs().find((r) => r.fn === "hire_applicant")!;
    const args = call.args as { p_org: string; p_driver: string; p_actor: string; p_records: Array<Record<string, unknown>> };
    expect(args.p_org).toBe(ORG);
    expect(args.p_driver).toBe(DRIVER);
    expect(args.p_actor).toBe("u-fleet");
    expect(args.p_records.map((r) => [r.kind, r.occurred_on])).toEqual([
      ["previous_employer_inquiry", "2026-07-01"],
      ["previous_employer_response", "2026-07-14"],
    ]);
    // Every draft names the employment row it came from — the column the re-run guard reads.
    expect(args.p_records.every((r) => (r.detail as Record<string, unknown>).employment_id === "emp-1")).toBe(true);
  });

  it("reports what it would not file rather than dating it itself", async () => {
    const rec = seed({ employment: [{ ...EMPLOYER, inquiry_status: "sent", inquiry_sent_on: null }] });
    const result = await hireApplicant(rec.client, ORG, "u", body, TODAY);

    expect(!isHireError(result) && result.skipped.map((s) => s.reason)).toEqual(["undated_inquiry"]);
    const args = rec.rpcs()[0]!.args as { p_records: unknown[] };
    expect(args.p_records).toEqual([]);
  });

  it("names the §391.51(b) hiring items the file still lacks", async () => {
    const rec = seed();
    const result = await hireApplicant(rec.client, ORG, "u", body, TODAY);
    const keys = !isHireError(result) ? result.outstanding.map((o) => o.key) : [];
    expect(keys).toContain("employment_application");
    expect(keys).toContain("mvr_preemployment");
    expect(keys).not.toContain("previous_employer_inquiry"); // this call is filing it
    expect(keys).not.toContain("psp_report"); // advisory — a file without one is lawful
  });

  it("scopes every read to the caller's org", async () => {
    const rec = seed();
    await hireApplicant(rec.client, ORG, "u", body, TODAY);
    expectOrgScoped(rec, ORG);
  });
});

describe("what hiring refuses", () => {
  it("refuses a driver who is already hired, without calling the transaction", async () => {
    const rec = seed({ drivers: [{ id: DRIVER, status: "active" }] });
    const result = await hireApplicant(rec.client, ORG, "u", body, TODAY);
    expect(isHireError(result) && result.code).toBe("not_an_applicant");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses a driver in another org", async () => {
    const rec = seed({ drivers: [] });
    const result = await hireApplicant(rec.client, ORG, "u", body, TODAY);
    expect(isHireError(result) && result.code).toBe("not_found");
  });

  it("refuses a hire date a decade out before reading anything", async () => {
    const rec = seed();
    const result = await hireApplicant(rec.client, ORG, "u", { ...body, hire_date: "2036-01-01" }, TODAY);
    expect(isHireError(result) && result.code).toBe("invalid_request");
    expect(rec.queries).toHaveLength(0);
  });

  /** The lock inside the transaction is the truth; this is the message it produces. */
  it("turns the transaction's HA010 race into a plain answer", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        drivers: [{ id: DRIVER, status: "applicant" }],
        driver_employment_history: [EMPLOYER],
        qualification_records: [],
      },
      rpc: { hire_applicant: { error: { code: "HA010", message: "hire_applicant_not_applicant" } } },
    });
    const result = await hireApplicant(rec.client, ORG, "u", body, TODAY);
    expect(isHireError(result) && result.code).toBe("not_an_applicant");
  });
});

describe("the preview", () => {
  it("shows what the hire would file without filing it", async () => {
    const rec = seed({ employment: [{ ...EMPLOYER, inquiry_status: "pending", inquiry_sent_on: null, inquiry_response_on: null }] });
    const result = await previewHire(rec.client, ORG, DRIVER);
    expect(!isHireError(result) && result.skipped.map((s) => s.reason)).toEqual(["inquiry_not_sent"]);
    expect(rec.rpcs()).toHaveLength(0);
    expect(rec.writes()).toHaveLength(0);
    expectOrgScoped(rec, ORG);
  });

  /**
   * §40.25(j) (0237) — the recruiter learns it BEFORE they commit, not after.
   *
   * ⚠ It is NOT one of `outstanding`. Those are the §391.51(b) hiring items, they are unconditional,
   * and every one of them is effectively a reason to hesitate over the hire. This is neither: it
   * exists only for the applicants who answered yes, and hiring them is lawful — the regulation bars
   * the driving, and the block lands at load assignment.
   */
  it("warns that this applicant may be hired and may not be dispatched", async () => {
    const rec = seed({
      drivers: [{ id: DRIVER, full_name: "An Applicant", status: "applicant", return_to_duty_required: true }],
    });
    const result = await previewHire(rec.client, ORG, DRIVER);
    expect(!isHireError(result) && result.returnToDutyBlocked).toBe(true);
    expect(!isHireError(result) && result.outstanding.map((o) => o.key)).not.toContain("return_to_duty");
    expectOrgScoped(rec, ORG);
  });

  it("says nothing when the return-to-duty documentation is already on file", async () => {
    const rec = seed({
      drivers: [{ id: DRIVER, full_name: "An Applicant", status: "applicant", return_to_duty_required: true }],
      records: [{ kind: "return_to_duty", detail: {} }],
    });
    const result = await previewHire(rec.client, ORG, DRIVER);
    expect(!isHireError(result) && result.returnToDutyBlocked).toBe(false);
  });

  it("says nothing for an applicant who was never asked to admit anything", async () => {
    const result = await previewHire(seed().client, ORG, DRIVER);
    expect(!isHireError(result) && result.returnToDutyBlocked).toBe(false);
  });
});
