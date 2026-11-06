import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";

/**
 * McLeod's hire of somebody who applied through 360 (ROSTER-LIFECYCLE-PLAN D-RL5). The fixture is the
 * production case of 2026-11-06: Curtis Hairston applied on 10-21, McLeod hired him (CHAIRSTO) on 10-28,
 * and the sweep held him for a 360 hire nobody was going to press.
 *
 * The hire itself (`recordHireFromTms`) is recruiting's and pinned in `hireFromTms.test.ts`; here it is
 * replaced so the question is only WHO the sweep decides to hire, and in what order it writes.
 */
const recordHireFromTms = vi.fn(async (..._a: unknown[]) => ({ filed: 0, openSteps: [] as string[] }));
vi.mock("../recruiting/index.js", () => ({ recordHireFromTms: (...a: unknown[]) => recordHireFromTms(...a) }));

const { hireApplicantsFromTms } = await import("./rosterApplicantHire.js");
const { ingestDrivers } = await import("./rosterIngest.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const APP = "3d62c87f-fcbb-4d62-bdc5-96621bc11554";
const application = (over: Record<string, unknown> = {}) => ({
  id: APP, org_id: ORG, status: "applicant", identity_source: "manual", cdl_number: "H-123 456 789", full_name: "Curtis Hairston",
  mcleod_driver_id: null, archived_at: null, termination_date: null, ...over,
});
const chairsto = { external_id: "CHAIRSTO", company_id: "TMS", cdl_number: "H123456789", first_name: "CURTIS", last_name: "HAIRSTON", hire_date: "2026-10-28" };

const seed = (rows: Record<string, unknown>[]) =>
  createSupabaseRecorder({
    tables: {
      drivers: (q: RecordedQuery) =>
        q.ops.some((o) => o.method === "is" && o.args[0] === "archived_at" && o.args[1] === null) ? rows.filter((r) => r.archived_at == null) : rows,
      audit_logs: [],
    },
  });

beforeEach(() => recordHireFromTms.mockClear());

describe("an application McLeod has hired (D-RL5)", () => {
  it("is hired with McLeod's date when the licence and the name both agree", async () => {
    const rec = seed([application()]);
    const r = await hireApplicantsFromTms(rec.client, ORG, [chairsto], true);
    expect(r.hiredFromTms).toEqual(["CHAIRSTO"]);
    expect(recordHireFromTms).toHaveBeenCalledWith(rec.client, ORG, { driverId: APP, externalId: "CHAIRSTO", hireDate: "2026-10-28" });
    expectOrgScoped(rec, ORG);
  });

  it("links the row to McLeod and hands it to McLeod BEFORE the hire, so a failed hire is retried, not stranded", async () => {
    const rec = seed([application()]);
    let linkedFirst = false;
    recordHireFromTms.mockImplementationOnce(async () => {
      linkedFirst = rec.writtenRows("drivers").some((w) => w.mcleod_driver_id === "CHAIRSTO");
      return { filed: 0, openSteps: [] };
    });
    await hireApplicantsFromTms(rec.client, ORG, [chairsto], true);
    expect(linkedFirst).toBe(true);
    expect(rec.writtenRows("drivers")[0]).toEqual({ mcleod_driver_id: "CHAIRSTO", mcleod_company_id: "TMS", identity_source: "mcleod" });
  });

  it("accepts a middle name one side carries and the other does not", async () => {
    const rec = seed([application({ full_name: "Curtis Lee Hairston" })]);
    expect((await hireApplicantsFromTms(rec.client, ORG, [chairsto], true)).hiredFromTms).toEqual(["CHAIRSTO"]);
  });

  it("leaves every weaker case held, for a person", async () => {
    const cases: Array<[string, Record<string, unknown>[], Record<string, unknown>]> = [
      ["licence matches, name does not (an applicant typed somebody else's licence)", [application({ full_name: "Tatjana Petrovic" })], {}],
      ["name matches, licence does not", [application({ cdl_number: "OTHER1" })], {}],
      ["the application has no licence", [application({ cdl_number: null })], {}],
      ["two applications on one licence", [application(), application({ id: "app-2" })], {}],
      ["an archived application", [application({ archived_at: "2026-10-30T00:00:00Z" })], {}],
      ["a roster driver already answers the licence", [application(), application({ id: "live", status: "active", identity_source: "mcleod" })], {}],
      ["a roster driver already carries McLeod's id", [application(), application({ id: "live", status: "active", cdl_number: null, mcleod_driver_id: "CHAIRSTO" })], {}],
      ["McLeod has no hire date", [application()], { hire_date: null }],
      ["McLeod does not list them active", [application()], { status: "terminated" }],
    ];
    for (const [why, rows, input] of cases) {
      recordHireFromTms.mockClear();
      const rec = seed(rows);
      const r = await hireApplicantsFromTms(rec.client, ORG, [{ ...chairsto, ...input }], true);
      expect(r.hiredFromTms, why).toEqual([]);
      expect(rec.writes(), why).toEqual([]);
      expect(recordHireFromTms, why).not.toHaveBeenCalled();
    }
  });

  it("does not count a hire that the transaction refused", async () => {
    recordHireFromTms.mockResolvedValueOnce({ code: "not_an_applicant", message: "x" } as never);
    const rec = seed([application()]);
    expect((await hireApplicantsFromTms(rec.client, ORG, [chairsto], true)).hiredFromTms).toEqual([]);
  });

  it("writes nothing in report mode, and counts it", async () => {
    const rec = seed([application()]);
    const r = await ingestDrivers(rec.client, ORG, [chairsto], "report");
    expect(r.hiredFromTms).toEqual(["CHAIRSTO"]);
    expect(rec.writes()).toEqual([]);
    expect(recordHireFromTms).not.toHaveBeenCalled();
  });

  it("does not run in link mode, where the application stays held as before", async () => {
    const rec = seed([application()]);
    const r = await ingestDrivers(rec.client, ORG, [chairsto], "link");
    expect(r.hiredFromTms).toBeUndefined();
    expect(r.applicants).toEqual(["CHAIRSTO"]);
  });

  it("runs in the create sweep before the matcher loads, so the hire and the link happen in one sweep", async () => {
    const rec = seed([application()]);
    const r = await ingestDrivers(rec.client, ORG, [chairsto], "create");
    expect(r.hiredFromTms).toEqual(["CHAIRSTO"]);
    const drivers = rec.forTable("drivers");
    const firstWrite = drivers.findIndex((q) => q.write);
    const candidateRead = drivers.findIndex((q, i) => i > firstWrite && q.ops.some((o) => o.method === "is" && o.args[0] === "archived_at"));
    expect(candidateRead).toBeGreaterThan(firstWrite);
  });
});
