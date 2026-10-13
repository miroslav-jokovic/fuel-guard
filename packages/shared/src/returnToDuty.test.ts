import { describe, it, expect } from "vitest";
import { RETURN_TO_DUTY_BLOCK, returnToDutyCause, returnToDutyOutstanding } from "./returnToDuty.js";

/**
 * §40.25(j)'s predicate — three surfaces read it and they must not disagree (0237).
 *
 * The table below is the whole rule: an admission creates the obligation, the §40.305 documentation
 * ends it, and nothing else about the driver is relevant to it.
 */
describe("the return-to-duty gate", () => {
  it.each([
    ["nobody asked, nothing filed", false, false, false],
    ["nobody asked, something filed anyway", false, true, false],
    ["admitted, nothing filed", true, false, true],
    ["admitted, documented", true, true, false],
  ])("%s", (_label, required, documented, outstanding) => {
    expect(returnToDutyOutstanding({
      returnToDutyRequired: required,
      returnToDutyDocumented: documented,
    })).toBe(outstanding);
  });

  /**
   * MS2 (F-5): a Med-Stop violation is discharged only by a record dated on or after it — a driver
   * with an old return-to-duty record and a NEW positive owes a second process.
   */
  it.each([
    ["violation, nothing filed", null, "violation"],
    ["violation, a record from before it", "2025-03-01", "violation"],
    ["violation, a record the same day", "2026-10-10", null],
    ["violation, a record after it", "2026-11-02", null],
  ] as const)("%s", (_label, lastReturnToDutyOn, cause) => {
    expect(returnToDutyCause({
      returnToDutyRequired: false,
      returnToDutyDocumented: lastReturnToDutyOn !== null,
      violationOn: "2026-10-10",
      lastReturnToDutyOn,
    })).toBe(cause);
  });

  it("a violation outranks an admission, and either one alone holds the driver", () => {
    const old = { returnToDutyRequired: true, returnToDutyDocumented: true, lastReturnToDutyOn: "2025-03-01" };
    expect(returnToDutyCause({ ...old, violationOn: "2026-10-10" })).toBe("violation");
    expect(returnToDutyCause({ ...old, returnToDutyDocumented: false, lastReturnToDutyOn: null, violationOn: "2026-10-10" })).toBe("violation");
    expect(returnToDutyCause({ returnToDutyRequired: true, returnToDutyDocumented: false, violationOn: null })).toBe("admission");
    expect(returnToDutyOutstanding({ ...old, violationOn: "2026-10-10" })).toBe(true);
  });

  it("the recruiter's copy for a Med-Stop hold names no result — they may not read testing records", () => {
    const m = RETURN_TO_DUTY_BLOCK.hireViolation.toLowerCase();
    for (const leak of ["drug", "alcohol", "positive", "refus", "test", "said"]) {
      expect(m, `hire copy leaks "${leak}"`).not.toContain(leak);
    }
    expect(m).toContain("hiring is allowed");
  });

  /**
   * ⚠ The dispatcher's message must not leak the fact behind the block.
   *
   * A return-to-duty record is a §382.401(a) testing record and a dispatcher may not read one. A
   * refusal that said "this driver failed a drug test" would hand them, in an error string, exactly
   * what the custody rule keeps out of their hands.
   */
  it("tells the dispatcher the load cannot be assigned without telling them why", () => {
    const m = RETURN_TO_DUTY_BLOCK.dispatch.toLowerCase();
    for (const leak of ["drug", "alcohol", "positive", "refus", "test"]) {
      expect(m, `dispatch copy leaks "${leak}"`).not.toContain(leak);
    }
    expect(m).toContain("cannot be assigned");
  });

  /** The recruiter read the answer on the application, so their copy says the thing plainly. */
  it("tells the recruiter the whole fact, and that hiring is still allowed", () => {
    expect(RETURN_TO_DUTY_BLOCK.hire).toContain("Hiring them is allowed");
    expect(RETURN_TO_DUTY_BLOCK.hire).toContain("return-to-duty process");
  });

  /** D-UI9: no screen names a regulation. */
  it("names no regulation on any screen", () => {
    for (const [k, v] of Object.entries(RETURN_TO_DUTY_BLOCK)) {
      expect(v, k).not.toMatch(/§|\bCFR\b/);
    }
  });
});
