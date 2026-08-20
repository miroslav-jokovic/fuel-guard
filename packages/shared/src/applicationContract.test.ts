import { describe, it, expect } from "vitest";
import {
  driverApplicationSchema,
  employmentSegments,
  requiredEmployers,
  type ApplicationEmployer,
} from "./applicationContract.js";

const ASOF = "2026-08-19"; // windows: (b)(10) 2023-08-19 → 2026-08-19, (b)(11) 2016-08-19 → 2023-08-19

const employer = (o: Partial<ApplicationEmployer> & Pick<ApplicationEmployer, "started_on">) =>
  ({
    employer_name: o.employer_name ?? "Carrier",
    usdot_number: o.usdot_number ?? null,
    started_on: o.started_on,
    ended_on: o.ended_on ?? null,
    operated_cmv: o.operated_cmv ?? true,
    dot_regulated: o.dot_regulated ?? true,
  }) as ApplicationEmployer;

/**
 * §391.21(b)(10) is 3 years of ALL employment; (b)(11) is the 7 years before that and ONLY where the
 * applicant operated a CMV. The boundary is ours to compute — the applicant answers "did you drive"
 * per job and never has to remember which window a date falls in (HIRING-PLAN.md D-HIRE1).
 */
describe("employmentSegments", () => {
  it("puts recent employment in (b)(10), whatever the work was", () => {
    expect(employmentSegments(employer({ started_on: "2025-01-01", operated_cmv: false }), ASOF)).toEqual(["b10"]);
  });

  it("puts older CMV work in (b)(11)", () => {
    expect(
      employmentSegments(employer({ started_on: "2018-01-01", ended_on: "2020-01-01" }), ASOF),
    ).toEqual(["b11"]);
  });

  it("leaves older NON-CMV work out of both — (b)(11) asks only for driving", () => {
    expect(
      employmentSegments(
        employer({ started_on: "2018-01-01", ended_on: "2020-01-01", operated_cmv: false }),
        ASOF,
      ),
    ).toEqual(["outside"]);
  });

  it("returns BOTH for a job that spans the boundary, rather than picking one", () => {
    // A 2018-2025 driving job is a (b)(10) employer AND a (b)(11) one. Dropping either half would
    // under-report a list the applicant is required to give in full.
    expect(
      employmentSegments(employer({ started_on: "2018-01-01", ended_on: "2025-01-01" }), ASOF),
    ).toEqual(["b10", "b11"]);
  });

  it("gives a job starting exactly on the boundary to (b)(10) alone", () => {
    expect(employmentSegments(employer({ started_on: "2023-08-19" }), ASOF)).toEqual(["b10"]);
  });

  it("ignores employment older than ten years", () => {
    expect(
      employmentSegments(employer({ started_on: "2005-01-01", ended_on: "2010-01-01" }), ASOF),
    ).toEqual(["outside"]);
  });

  it("reads a null end date as 'still there', not as an open interval", () => {
    expect(employmentSegments(employer({ started_on: "2019-01-01" }), ASOF)).toEqual(["b10", "b11"]);
  });
});

describe("requiredEmployers", () => {
  it("sorts one list into the two the regulation asks for", () => {
    const { b10, b11 } = requiredEmployers(
      [
        employer({ employer_name: "Now", started_on: "2024-01-01" }),
        // Spans the boundary, so it is owed to both lists.
        employer({ employer_name: "Spanning", started_on: "2019-01-01", ended_on: "2024-06-01" }),
        employer({ employer_name: "Old driving", started_on: "2018-01-01", ended_on: "2021-01-01" }),
        employer({ employer_name: "Old warehouse", started_on: "2017-01-01", ended_on: "2019-01-01", operated_cmv: false }),
        employer({ employer_name: "Ancient", started_on: "2004-01-01", ended_on: "2008-01-01" }),
      ],
      ASOF,
    );
    expect(b10.map((e) => e.employer_name)).toEqual(["Now", "Spanning"]);
    expect(b11.map((e) => e.employer_name)).toEqual(["Spanning", "Old driving"]);
  });
});

describe("the application itself", () => {
  const complete = {
    first_name: "Susan",
    last_name: "Godfrey",
    date_of_birth: "1980-03-14",
    email: "s@example.test",
    phone: "555-0100",
    addresses: [{ line1: "1 Road", city: "Chicago", state: "IL", postal_code: "60601", from: "2020-01", to: null }],
    cdl_number: "D123456",
    cdl_state: "IL",
    cdl_expires_at: "2028-01-01",
    accidents: [],
    declares_no_accidents: true,
    violations: [],
    declares_no_violations: true,
    licence_ever_denied: false,
    employers: [],
    declares_no_employment: true,
    certified: true as const,
    signed_name: "Susan Godfrey",
  };

  it("accepts a complete application", () => {
    expect(driverApplicationSchema.safeParse(complete).success).toBe(true);
  });

  /**
   * An empty array is an ANSWER, not an omission. Without the explicit declaration a blank form and a
   * clean record are the same bytes, and §391.21(b)(7)-(8) asks a question the applicant must answer.
   */
  it("will not read an empty list as 'none' unless the applicant said so", () => {
    for (const field of ["declares_no_accidents", "declares_no_violations", "declares_no_employment"]) {
      const parsed = driverApplicationSchema.safeParse({ ...complete, [field]: false });
      expect(parsed.success, field).toBe(false);
    }
  });

  it("requires the certification — the sentence is the document's whole legal weight", () => {
    expect(driverApplicationSchema.safeParse({ ...complete, certified: false }).success).toBe(false);
  });

  it("demands the detail behind a declared licence denial", () => {
    expect(
      driverApplicationSchema.safeParse({ ...complete, licence_ever_denied: true }).success,
    ).toBe(false);
    expect(
      driverApplicationSchema.safeParse({
        ...complete,
        licence_ever_denied: true,
        licence_denial_detail: "Suspended 2019, reinstated 2020",
      }).success,
    ).toBe(true);
  });

  it("applies the date-of-birth rules the roster uses — PSP bills for a bad one", () => {
    expect(driverApplicationSchema.safeParse({ ...complete, date_of_birth: "2015-01-01" }).success).toBe(false);
    expect(driverApplicationSchema.safeParse({ ...complete, date_of_birth: "1990-02-31" }).success).toBe(false);
  });

  /** The releases are separate documents (D-HIRE3); there is nowhere here to smuggle one in. */
  it("refuses an unknown field, so a consent cannot ride along inside the application", () => {
    const parsed = driverApplicationSchema.safeParse({ ...complete, psp_consent: true });
    expect(parsed.success).toBe(false);
  });

  it("refuses an employer whose dates run backwards", () => {
    const parsed = driverApplicationSchema.safeParse({
      ...complete,
      declares_no_employment: false,
      employers: [
        { employer_name: "X", started_on: "2025-01-01", ended_on: "2024-01-01", operated_cmv: true, dot_regulated: true },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
