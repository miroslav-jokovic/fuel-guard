import { describe, it, expect } from "vitest";
import { dobCsvTemplate, importDriverDob } from "./dobImport.js";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";

/**
 * The bulk import, from the service side.
 *
 * The rules themselves are pinned in `packages/shared/src/driverDobCsv.test.ts`. What is pinned here
 * is that this service plans against the LIVE roster rather than trusting the caller, hands the RPC
 * only what it matched, and reports what the database actually changed rather than what it hoped to.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const D1 = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-08-20";

const seed = (drivers: unknown[], applied = 1) =>
  createSupabaseRecorder({
    tables: { drivers },
    rpc: { apply_driver_dob: applied },
  });

const roster = [
  { id: D1, full_name: "Susan Godfrey", employee_id: "E-100", cdl_number: "PA334554", date_of_birth: null },
];

const csv = (...lines: string[]) => lines.join("\r\n") + "\r\n";

describe("importing dates of birth", () => {
  it("hands the transaction only the rows it matched", async () => {
    const rec = seed(roster);
    const out = await importDriverDob(
      rec.client, ORG, csv("full_name,date_of_birth", "Susan Godfrey,1949-12-11", "Nobody Here,1970-01-01"), TODAY,
    );
    expect(out.matches).toHaveLength(1);
    expect(out.rejects[0]?.reason).toBe("no_match");
    const args = rec.rpcs()[0]!.args as { p_org: string; p_rows: unknown[] };
    expect(args.p_org).toBe(ORG);
    expect(args.p_rows).toEqual([{ driver_id: D1, date_of_birth: "1949-12-11" }]);
  });

  /**
   * The count comes from the database, not from the plan. The RPC updates only where the column is
   * still null, so a plan made against a roster read seconds ago can match a driver whose date was
   * typed in meanwhile — and reporting the matched count would claim a write that did not happen.
   */
  it("reports what the database changed, not what the plan hoped for", async () => {
    const rec = seed(roster, 0);
    const out = await importDriverDob(rec.client, ORG, csv("full_name,date_of_birth", "Susan Godfrey,1949-12-11"), TODAY);
    expect(out.matches).toHaveLength(1);
    expect(out.applied).toBe(0);
  });

  it("writes nothing on a dry run", async () => {
    const rec = seed(roster);
    const out = await importDriverDob(
      rec.client, ORG, csv("full_name,date_of_birth", "Susan Godfrey,1949-12-11"), TODAY, { dryRun: true },
    );
    expect(out.matches).toHaveLength(1);
    expect(out.applied).toBe(0);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("does not call the transaction when nothing matched", async () => {
    const rec = seed(roster);
    const out = await importDriverDob(rec.client, ORG, csv("full_name,date_of_birth", "Nobody Here,1949-12-11"), TODAY);
    expect(out.applied).toBe(0);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("plans against active and applicant drivers only", async () => {
    const rec = seed(roster);
    await importDriverDob(rec.client, ORG, csv("full_name,date_of_birth", "Susan Godfrey,1949-12-11"), TODAY);
    const statuses = rec.forTable("drivers")[0]!.ops.find((o) => o.method === "in");
    expect(statuses?.args).toEqual(["status", ["active", "applicant"]]);
  });

  it("scopes every read and the write to the caller's org", async () => {
    const rec = seed(roster);
    await importDriverDob(rec.client, ORG, csv("full_name,date_of_birth", "Susan Godfrey,1949-12-11"), TODAY);
    expectOrgScoped(rec, ORG);
  });

  it("builds a template with a row per driver", async () => {
    const rec = seed(roster);
    const out = await dobCsvTemplate(rec.client, ORG);
    expect(out.split("\r\n")[0]).toContain("driver_id");
    expect(out).toContain("Susan Godfrey");
  });
});
