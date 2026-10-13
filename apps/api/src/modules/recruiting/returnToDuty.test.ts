import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { returnToDutyBlocked, returnToDutyHold } from "./returnToDuty.js";

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

/**
 * MS2 (MEDSTOP-PLAN.md F-5): Med-Stop's positive or refusal is the door's second obligation. The
 * recorder does not filter, so the two filters that keep history and name-only matches from stopping
 * a driver are asserted on the QUERY, and the rows given are the ones those filters would return.
 */
describe("the Med-Stop violation read", () => {
  const medstop = (tests: unknown[], records: unknown[] = []) =>
    createSupabaseRecorder({
      tables: {
        drivers: [{ return_to_duty_required: false }],
        medstop_employees: [{ medstop_id: "e1" }],
        medstop_tests: tests,
        qualification_records: records,
      },
    });
  const positive = { service: "TD", status: "CLOSED", result: "POSITIVE", collected_local: "2026-10-09T14:24:00" };

  it("a verified positive holds the driver as a violation", async () => {
    expect(await returnToDutyHold(medstop([positive]).client, ORG, DRIVER)).toBe("violation");
  });

  it("an old return-to-duty record does not discharge a new positive; one on or after it does", async () => {
    expect(await returnToDutyHold(medstop([positive], [{ occurred_on: "2025-03-01" }]).client, ORG, DRIVER)).toBe("violation");
    expect(await returnToDutyHold(medstop([positive], [{ occurred_on: "2026-10-09" }]).client, ORG, DRIVER)).toBeNull();
  });

  it("a second violation after a completed return-to-duty holds the driver again — the NEWEST counts", async () => {
    const first = { ...positive, collected_local: "2025-01-15T09:00:00" };
    expect(await returnToDutyHold(medstop([first, positive], [{ occurred_on: "2025-06-01" }]).client, ORG, DRIVER)).toBe("violation");
  });

  it("a drug result before review, a dilute and a negative stop nobody", async () => {
    for (const t of [{ ...positive, status: "AT LAB" }, { ...positive, result: "NEGATIVE - DILUTE" }, { ...positive, result: "NEGATIVE" }]) {
      expect(await returnToDutyBlocked(medstop([t]).client, ORG, DRIVER)).toBe(false);
    }
  });

  it("reads only certain matches and only news — scoped to the org — and the newest record first", async () => {
    const r = medstop([positive], [{ occurred_on: "2026-10-10" }]);
    await returnToDutyHold(r.client, ORG, DRIVER);
    expect(r.forTable("medstop_employees")[0]!.filters()).toContainEqual({ col: "match_rule", val: ["licence", "name_dob"] });
    expect(r.forTable("medstop_employees")[0]!.filters()).toContainEqual({ col: "driver_id", val: DRIVER });
    expect(r.forTable("medstop_tests")[0]!.filters()).toContainEqual({ col: "baseline", val: false });
    expect(r.forTable("qualification_records")[0]!.ops).toContainEqual({ method: "order", args: ["occurred_on", { ascending: false }] });
    expectOrgScoped(r, ORG);
  });

  it("a driver Med-Stop does not know is read no further", async () => {
    const r = createSupabaseRecorder({ tables: { drivers: [{ return_to_duty_required: false }], medstop_employees: [] } });
    expect(await returnToDutyHold(r.client, ORG, DRIVER)).toBeNull();
    expect(r.forTable("medstop_tests")).toHaveLength(0);
  });
});
