import { describe, it, expect } from "vitest";
import { RETURN_TO_DUTY_BLOCK, returnToDutyOutstanding } from "./returnToDuty.js";

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
