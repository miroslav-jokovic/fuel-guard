import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { medstopViolationOn, medstopViolationsByDriver } from "./violations.js";

/**
 * The org-wide violation read (MEDSTOP-PLAN §7A.15) — the fleet overview's and the binder's, which must
 * agree with the dispatch door driver by driver. The recorder applies no filters, so the rules that
 * keep a name-only match from holding anybody are given rows the query would have excluded, and the
 * code is expected to drop them itself.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const positive = (employee: string, day: string) => ({ employee_medstop_id: employee, service: "TD", status: "CLOSED", result: "POSITIVE", collected_local: `${day}T09:00:00` });
const negative = (employee: string, day: string) => ({ ...positive(employee, day), result: "NEGATIVE" });

const db = (employees: unknown[], tests: unknown[]) => createSupabaseRecorder({ tables: { medstop_employees: employees, medstop_tests: tests } });

describe("medstopViolationsByDriver", () => {
  it("maps each certainly-matched driver to the day of their newest positive or refusal", async () => {
    const rec = db(
      [
        { medstop_id: "e1", driver_id: "d1", match_rule: "licence" },
        { medstop_id: "e2", driver_id: "d2", match_rule: "name_dob" },
        { medstop_id: "e3", driver_id: "d3", match_rule: "licence" },
      ],
      [positive("e1", "2026-05-01"), positive("e1", "2026-09-01"), negative("e1", "2026-10-01"), positive("e2", "2026-08-15"), negative("e3", "2026-08-15")],
    );
    expect(Object.fromEntries(await medstopViolationsByDriver(rec.client, ORG))).toEqual({ d1: "2026-09-01", d2: "2026-08-15" });
  });

  it("holds nobody on a name-only match, even when the query let one through", async () => {
    const rec = db([{ medstop_id: "e9", driver_id: "d9", match_rule: "name" }], [positive("e9", "2026-09-01")]);
    expect((await medstopViolationsByDriver(rec.client, ORG)).size).toBe(0);
  });

  it("asks only for certain matches and for tests the product watched (not D-MS5's baseline), org-scoped", async () => {
    const rec = db([], []);
    await medstopViolationsByDriver(rec.client, ORG);
    expect(rec.forTable("medstop_employees")[0]!.ops).toContainEqual({ method: "in", args: ["match_rule", ["licence", "name_dob"]] });
    expect(rec.forTable("medstop_tests")[0]!.filters()).toContainEqual({ col: "baseline", val: false });
    expectOrgScoped(rec, ORG);
  });

  it("gives the dispatch door's answer for every driver", async () => {
    const employees = [{ medstop_id: "e1", driver_id: "d1", match_rule: "licence" }];
    const tests = [positive("e1", "2026-05-01"), { ...positive("e1", "2026-06-01"), result: "REFUSAL TO TEST" }];
    const all = await medstopViolationsByDriver(db(employees, tests).client, ORG);
    expect(all.get("d1")).toBe(await medstopViolationOn(db(employees, tests).client, ORG, "d1"));
  });
});
