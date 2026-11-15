import { describe, expect, it } from "vitest";
import { employmentProgress, monthName } from "./employmentProgress";
import { emptyEmployer, type DraftEmployer } from "./draft";

/**
 * §391.21(b)(10)–(11): the coverage the driver is shown is the SHARED calculator's, including its
 * refusal to call a hole in years four to ten a defect (X5, D-AX2). The walk prints it under each job
 * (`TaskWalk`, `data-jobs-coverage`).
 *
 * Until 1b-5 this file also drove the legacy wizard's job list and its panel. Those went with that
 * screen; a job is asked one question to a screen now, tested in `wizard/useTaskWalk.test.ts`.
 */

const ASOF = "2026-09-11";

const job = (over: Partial<DraftEmployer> = {}): DraftEmployer => ({
  ...emptyEmployer(),
  employer_name: "Old Carrier",
  started_on: "2024-01-01",
  ended_on: "2026-09-01",
  ...over,
});

describe("how much of the window the driver has accounted for", () => {
  it("says nothing is covered when nothing is entered", () => {
    const p = employmentProgress([], ASOF);
    expect(p.empty).toBe(true);
    expect(p.percent).toBe(0);
    expect(p.gaps).toEqual([]);
  });

  it("ignores a row with no name or no start date, because a half-typed row is not a claim", () => {
    expect(employmentProgress([emptyEmployer()], ASOF).empty).toBe(true);
    expect(employmentProgress([job({ started_on: "" })], ASOF).empty).toBe(true);
    expect(employmentProgress([job({ employer_name: "  " })], ASOF).empty).toBe(true);
  });

  it("reads an empty end date as still employed, not as a zero-day job", () => {
    const p = employmentProgress([job({ started_on: "2020-01-01", ended_on: "" })], ASOF);
    expect(p.percent).toBe(100);
    expect(p.gaps).toEqual([]);
  });

  it("finds a hole in the last three years and says when it was", () => {
    const p = employmentProgress(
      [
        job({ employer_name: "A", started_on: "2023-09-01", ended_on: "2024-06-01" }),
        job({ employer_name: "B", started_on: "2025-02-01", ended_on: "" }),
      ],
      ASOF,
    );
    expect(p.gaps).toHaveLength(1);
    expect(p.gaps[0]!.from).toBe("June 2024");
    expect(p.gaps[0]!.to).toBe("February 2025");
  });

  /**
   * ⚠ The assertion that is really about `employmentCoverage`, and the reason this module converts
   * rather than calculates. §391.21(b)(11) asks only for COMMERCIAL driving in years four to ten, so
   * an applicant who spent year five in a warehouse owes no explanation — reporting a gap there would
   * be wrong in the direction that costs somebody a job.
   */
  it("never calls a hole in years four to ten a gap", () => {
    const p = employmentProgress(
      [job({ employer_name: "Recent", started_on: "2023-09-01", ended_on: "" })],
      ASOF,
    );
    expect(p.percent).toBe(100);
    expect(p.gaps).toEqual([]);
  });

  it("counts which window each job answers", () => {
    const p = employmentProgress(
      [
        job({ employer_name: "Recent", started_on: "2024-01-01", ended_on: "" }),
        job({ employer_name: "Old CMV", started_on: "2018-01-01", ended_on: "2020-01-01", operated_cmv: true }),
      ],
      ASOF,
    );
    expect(p.b10).toBe(1);
    expect(p.b11).toBe(1);
  });

  it("never reads over 100%, however the jobs overlap", () => {
    const p = employmentProgress(
      [
        job({ employer_name: "A", started_on: "2020-01-01", ended_on: "" }),
        job({ employer_name: "B", started_on: "2020-01-01", ended_on: "" }),
      ],
      ASOF,
    );
    // A meter reading 190% is a meter nobody trusts again.
    expect(p.percent).toBe(100);
  });

  it("names a month the same way in any timezone", () => {
    expect(monthName("2024-06-01")).toBe("June 2024");
    expect(monthName("2024-01-31")).toBe("January 2024");
    expect(monthName("nonsense")).toBe("nonsense");
  });
});
