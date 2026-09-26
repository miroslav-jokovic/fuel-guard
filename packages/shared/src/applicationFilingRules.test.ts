import { describe, expect, it } from "vitest";
import { applicationV2FilingIssues } from "./applicationFilingRules.js";
import { applicationEmployerSchema, driverApplicationObject } from "./applicationContract.js";
import type { ApplicationEmployer } from "./applicationEmployerContract.js";

/**
 * AW1 / D-AW13: what a v2 filing must carry that the base contract leaves optional.
 *
 * `asOf` 2026-09-26 puts the (b)(10) window at 2023-09-26 → 2026-09-26.
 */
const AS_OF = "2026-09-26";
const EMPLOYER_ID = "5b0c6a4e-1f2d-4c3b-9a8e-7d6c5b4a3f21";

const employer = (over: Partial<ApplicationEmployer> = {}): ApplicationEmployer => ({
  key: EMPLOYER_ID,
  employer_name: "Midwest Freight",
  address_line1: "1 Main St",
  city: "Joliet",
  state: "IL",
  started_on: "2023-01-01",
  ended_on: null,
  operated_cmv: true,
  dot_regulated: true,
  reason_for_leaving: "Still employed",
  subject_to_fmcsr: true,
  safety_sensitive: true,
  ...over,
});

describe("applicationV2FilingIssues", () => {
  it("passes a complete application with no gaps", () => {
    expect(applicationV2FilingIssues({ employers: [employer()], employment_gaps: [] }, AS_OF)).toEqual([]);
  });

  it("names each missing (b)(10) answer on the employer it belongs to", () => {
    const issues = applicationV2FilingIssues({
      employers: [employer({ key: null, city: " ", reason_for_leaving: null, subject_to_fmcsr: null, safety_sensitive: undefined })],
      employment_gaps: [],
    }, AS_OF);
    expect(issues.map((i) => i.path)).toEqual([
      "employers.0.key",
      "employers.0.address_line1",
      "employers.0.reason_for_leaving",
      "employers.0.subject_to_fmcsr",
      "employers.0.safety_sensitive",
    ]);
  });

  it("asks the (iv) questions of (b)(10) employers only, not of the seven years before", () => {
    // A CMV job that ended before the three years: (b)(11), which asks for the address and the
    // reason for leaving but not (iv)(A)/(B).
    const older = employer({ started_on: "2018-01-01", ended_on: "2022-12-31", subject_to_fmcsr: null, safety_sensitive: null });
    const issues = applicationV2FilingIssues({ employers: [older, employer()], employment_gaps: [] }, AS_OF);
    expect(issues).toEqual([]);
  });

  it("requires every gap over 30 days in the three years to be explained, and accepts an explanation that covers it", () => {
    // Nothing between the window's start (2023-09-26) and a job starting 2024-03-01.
    const late = employer({ started_on: "2024-03-01" });
    const unexplained = applicationV2FilingIssues({ employers: [late], employment_gaps: [] }, AS_OF);
    expect(unexplained).toEqual([
      { path: "employment_gaps", message: "Tell us what you were doing from 09/26/2023 to 03/01/2024" },
    ]);
    const explained = applicationV2FilingIssues({
      employers: [late],
      employment_gaps: [{ from: "2023-09-26", to: "2024-03-01", explanation: "Medical leave" }],
    }, AS_OF);
    expect(explained).toEqual([]);
  });

  it("treats a declared-unemployed applicant's whole window as one gap to explain", () => {
    const issues = applicationV2FilingIssues({ employers: [], employment_gaps: [] }, AS_OF);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe("employment_gaps");
  });
});

describe("the base contract keeps parsing filings made before AW1", () => {
  it("accepts an employer without a key, and defaults the gaps to none", () => {
    const { key: _key, ...legacy } = employer();
    expect(applicationEmployerSchema.safeParse(legacy).success).toBe(true);
    const parsed = driverApplicationObject.shape.employment_gaps.parse(undefined);
    expect(parsed).toEqual([]);
  });

  it("refuses a key that is not a uuid", () => {
    expect(applicationEmployerSchema.safeParse(employer({ key: "employer-1" })).success).toBe(false);
  });
});
