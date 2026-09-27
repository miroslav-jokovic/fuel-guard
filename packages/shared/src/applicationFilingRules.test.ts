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

/** One address, lived at since before the (b)(3) window opened — every test below but the (b)(3) ones. */
const HOME = [{ line1: "1 Road", city: "Joliet", state: "IL", postal_code: "60432", from: "2019-01", to: null }];

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
    expect(applicationV2FilingIssues({ addresses: HOME, employers: [employer()], employment_gaps: [] }, AS_OF)).toEqual([]);
  });

  it("names each missing (b)(10) answer on the employer it belongs to", () => {
    const issues = applicationV2FilingIssues({
      addresses: HOME,
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
    const issues = applicationV2FilingIssues({ addresses: HOME, employers: [older, employer()], employment_gaps: [] }, AS_OF);
    expect(issues).toEqual([]);
  });

  it("requires every gap over 30 days in the three years to be explained, and accepts an explanation that covers it", () => {
    // Nothing between the window's start (2023-09-26) and a job starting 2024-03-01.
    const late = employer({ started_on: "2024-03-01" });
    const unexplained = applicationV2FilingIssues({ addresses: HOME, employers: [late], employment_gaps: [] }, AS_OF);
    expect(unexplained).toEqual([
      { path: "employment_gaps.2023-09-26", message: "Tell us what you were doing from 09/26/2023 to 03/01/2024" },
    ]);
    const explained = applicationV2FilingIssues({
      addresses: HOME,
      employers: [late],
      employment_gaps: [{ from: "2023-09-26", to: "2024-03-01", explanation: "Medical leave" }],
    }, AS_OF);
    expect(explained).toEqual([]);
  });

  it("treats a declared-unemployed applicant's whole window as one gap to explain", () => {
    const issues = applicationV2FilingIssues({ addresses: HOME, employers: [], employment_gaps: [] }, AS_OF);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe("employment_gaps.2023-09-26");
  });
});

/**
 * §391.21(b)(3) (C3c1): "The addresses at which the applicant has resided during the 3 years preceding
 * the date on which the application is submitted" — the text committed in docs/plans/recruitment/cfr-391-21/.
 * `asOf` 2026-09-26 opens the window in 2023-09.
 */
describe("applicationV2FilingIssues — the three years of addresses, (b)(3)", () => {
  const addr = (from: string, to: string | null) => ({ line1: "1 Road", city: "Joliet", state: "IL", postal_code: "60432", from, to });
  const run = (addresses: ReturnType<typeof addr>[]) =>
    applicationV2FilingIssues({ addresses, employers: [employer()], employment_gaps: [] }, AS_OF);

  it("refuses today's address alone when it began inside the three years, naming the months missing", () => {
    expect(run([addr("2025-02", null)])).toEqual([
      { path: "addresses", message: "Tell us where you lived from 09/2023 to 01/2025" },
    ]);
  });

  it("accepts a history that reaches back to the window's first month, moving in the month of moving out", () => {
    expect(run([addr("2023-09", "2024-05"), addr("2024-05", null)])).toEqual([]);
    // And moving in the month AFTER moving out is continuous too — a month is the form's unit.
    expect(run([addr("2021-01", "2024-05"), addr("2024-06", null)])).toEqual([]);
  });

  it("names one whole month with no address in the middle of the history", () => {
    expect(run([addr("2020-01", "2024-03"), addr("2024-05", null)])).toEqual([
      { path: "addresses", message: "Tell us where you lived in 04/2024" },
    ]);
  });

  it("asks for today's address when the newest one has ended", () => {
    expect(run([addr("2020-01", "2026-06")])).toEqual([
      { path: "addresses", message: "Tell us where you lived from 07/2026 to 09/2026" },
    ]);
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
