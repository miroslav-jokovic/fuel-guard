import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
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

/**
 * ⚠ The evidence the hire gate reads (Q-HM5, D-HB5): an applicant whose six federal gates and
 * handbook are all on file, and whose application is filed. The recorder does not filter, so the
 * `qualification_records` fixture answers by WHAT was selected: the checklist's evidence read
 * (`kind` + jurisdiction) gets this, and `loadFile`'s gap read (`kind, detail`) gets the test's own
 * rows — the two are different questions and the file's gaps are what several tests below are about.
 */
const READY_KINDS = ["mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "road_test", "handbook"];
const selectOf = (q: RecordedQuery): string => String(q.ops.find((o) => o.method === "select")?.args[0] ?? "");

const seed = (over: { drivers?: unknown[]; employment?: unknown[]; records?: unknown[]; evidence?: string[]; rpc?: unknown } = {}) =>
  createSupabaseRecorder({
    tables: {
      drivers: over.drivers ?? [{ id: DRIVER, full_name: "An Applicant", status: "applicant", hire_date: null }],
      driver_employment_history: over.employment ?? [EMPLOYER],
      qualification_records: (q: RecordedQuery) =>
        // ⚠ Keyed on the checklist's OWN read — the only one that selects the MVR's `jurisdiction`.
        // Every other read (the file's gaps, §40.25(j)'s return-to-duty check) gets the test's rows:
        // two earlier discriminators each handed one read the other's answer, found by probing.
        selectOf(q).includes("jurisdiction") ? (over.evidence ?? READY_KINDS).map((kind) => ({ kind })) : (over.records ?? []),
      application_invitations: [{ id: "inv-1", created_at: "2026-08-01T00:00:00Z", submitted_at: "2026-08-10T00:00:00Z" }],
      audit_logs: [],
    },
    rpc: { hire_applicant: over.rpc ?? { status: "active", hire_date: "2026-09-01", filed: 2 } },
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
    // Through `seed()`: an applicant the gate lets through, so the call reaches the race it is about.
    const rec = seed({ rpc: { error: { code: "HA010", message: "hire_applicant_not_applicant" } } });
    const result = await hireApplicant(rec.client, ORG, "u", body, TODAY);
    expect(isHireError(result) && result.code).toBe("not_an_applicant");
  });
});

describe("what hiring refuses without (Q-HM5, D-HB5)", () => {
  it("refuses without the signed handbook, names it, and never calls the transaction", async () => {
    const rec = seed({ evidence: READY_KINDS.filter((k) => k !== "handbook") });
    const result = await hireApplicant(rec.client, ORG, "u", body, TODAY);
    expect(isHireError(result) && result.code).toBe("not_ready_to_hire");
    expect(isHireError(result) && result.missing).toEqual(["handbook"]);
    expect(isHireError(result) && result.message).toMatch(/Handbook signed/);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses without a federal gate — the drug test — and names it", async () => {
    const rec = seed({ evidence: READY_KINDS.filter((k) => k !== "drug_test") });
    const result = await hireApplicant(rec.client, ORG, "u", body, TODAY);
    expect(isHireError(result) && result.missing).toEqual(["drug_test"]);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("does not refuse for what only warns (the §391.23 investigation)", async () => {
    // EMPLOYER's inquiry is answered; one still pending is the warn-only case.
    const rec = seed({ employment: [{ ...EMPLOYER, inquiry_status: "pending", inquiry_sent_on: null, inquiry_response_on: null }] });
    const result = await hireApplicant(rec.client, ORG, "u", body, TODAY);
    expect(isHireError(result)).toBe(false);
  });

  it("the preview names what the press will be refused for, before it", async () => {
    const rec = seed({ evidence: READY_KINDS.filter((k) => k !== "handbook") });
    const result = await previewHire(rec.client, ORG, DRIVER);
    expect(!isHireError(result) && result.hireBlockedBy).toEqual(["handbook"]);
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
