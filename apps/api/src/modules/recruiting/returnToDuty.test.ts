import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { returnToDutyBlocked } from "./returnToDuty.js";

/**
 * §40.25(j)'s read (0237) — two facts, two homes, and the org filter on both.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const rec = (required: boolean, records: unknown[] = []) =>
  createSupabaseRecorder({
    tables: {
      drivers: [{ return_to_duty_required: required }],
      qualification_records: records,
    },
  });

describe("the §40.25(j) read", () => {
  it("is clear when the driver never admitted anything", async () => {
    const r = rec(false);
    expect(await returnToDutyBlocked(r.client, ORG, DRIVER)).toBe(false);
  });

  /**
   * ⚠ The second query is not issued at all for a driver who owes nothing, and that is the reason
   * the discharge is not a second boolean: the cost of reading the evidence is paid only by the
   * small minority of drivers who have a reason to pay it.
   */
  it("does not go looking for a discharge nobody owes", async () => {
    const r = rec(false);
    await returnToDutyBlocked(r.client, ORG, DRIVER);
    expect(r.forTable("qualification_records")).toHaveLength(0);
  });

  it("blocks when the admission stands and nothing is filed", async () => {
    expect(await returnToDutyBlocked(rec(true).client, ORG, DRIVER)).toBe(true);
  });

  it("clears when the return-to-duty documentation is on file", async () => {
    expect(await returnToDutyBlocked(rec(true, [{ id: "rec-1" }]).client, ORG, DRIVER)).toBe(false);
  });

  /**
   * The API reads with the service role, which bypasses RLS. A gate another tenant's record could
   * satisfy would be worse than no gate at all.
   */
  it("scopes every read to the caller's org", async () => {
    const r = rec(true, [{ id: "rec-1" }]);
    await returnToDutyBlocked(r.client, ORG, DRIVER);
    expectOrgScoped(r, ORG);
    const records = r.forTable("qualification_records")[0]!;
    expect(records.filters()).toContainEqual({ col: "kind", val: "return_to_duty" });
    expect(records.filters()).toContainEqual({ col: "driver_id", val: DRIVER });
  });
});
