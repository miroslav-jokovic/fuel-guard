import { describe, it, expect } from "vitest";
import {
  employmentCoverage,
  yearsBefore,
  GAP_TOLERANCE_DAYS,
  type EmploymentPeriod,
} from "./employmentCoverage.js";

const period = (over: Partial<EmploymentPeriod> & Pick<EmploymentPeriod, "startedOn">): EmploymentPeriod => ({
  id: over.id ?? "p1",
  employerName: over.employerName ?? "Carrier",
  startedOn: over.startedOn,
  endedOn: over.endedOn ?? null,
  dotRegulated: over.dotRegulated ?? true,
  operatedCmv: over.operatedCmv,
  inquiryStatus: over.inquiryStatus ?? "pending",
});

const TODAY = "2026-08-19";

describe("the windows", () => {
  it("are three and ten calendar years, and a leap day clamps rather than rolling forward", () => {
    expect(yearsBefore("2026-08-19", 3)).toBe("2023-08-19");
    expect(yearsBefore("2026-08-19", 10)).toBe("2016-08-19");
    // Feb 29 minus three years is Feb 28. Date.UTC(2021, 1, 29) would give March 1.
    expect(yearsBefore("2024-02-29", 3)).toBe("2021-02-28");
  });

  it("meet at the three-year boundary — (b)(11) is the 7 years PRECEDING the 3", () => {
    const c = employmentCoverage([], TODAY);
    expect(c.segmentA.start).toBe("2023-08-19");
    expect(c.segmentA.end).toBe(TODAY);
    expect(c.segmentB.start).toBe("2016-08-19");
    expect(c.segmentB.end).toBe("2023-08-19");
  });

  it("reports an empty file as empty rather than as one enormous gap", () => {
    const c = employmentCoverage([], TODAY);
    expect(c.empty).toBe(true);
    expect(c.segmentA.employers).toBe(0);
    // The gap is still computed and still true — "nothing recorded" is a finding, not silence.
    expect(c.segmentA.gaps).toHaveLength(1);
  });
});

describe("Segment A — §391.21(b)(10), all employment, gaps meaningful", () => {
  it("finds nothing when one job covers the whole window", () => {
    const c = employmentCoverage([period({ startedOn: "2019-01-01" })], TODAY);
    expect(c.segmentA.gaps).toEqual([]);
    expect(c.segmentA.coveredDays).toBe(c.segmentA.windowDays);
  });

  it("ignores a short break between two jobs, and reports a long one", () => {
    const short = employmentCoverage(
      [
        period({ id: "a", startedOn: "2019-01-01", endedOn: "2024-06-01" }),
        period({ id: "b", startedOn: "2024-06-20" }),
      ],
      TODAY,
    );
    expect(short.segmentA.gaps).toEqual([]); // 19 days, under the carrier-practice threshold

    const long = employmentCoverage(
      [
        period({ id: "a", startedOn: "2019-01-01", endedOn: "2024-06-01" }),
        period({ id: "b", startedOn: "2024-10-01" }),
      ],
      TODAY,
    );
    expect(long.segmentA.gaps).toHaveLength(1);
    expect(long.segmentA.gaps[0]).toMatchObject({ from: "2024-06-01", to: "2024-10-01" });
    expect(long.segmentA.gaps[0]!.days).toBeGreaterThan(GAP_TOLERANCE_DAYS);
  });

  it("leaves no phantom gap when one job ends the day the next begins", () => {
    const c = employmentCoverage(
      [
        period({ id: "a", startedOn: "2019-01-01", endedOn: "2025-03-31" }),
        period({ id: "b", startedOn: "2025-04-01" }),
      ],
      TODAY,
    );
    expect(c.segmentA.gaps).toEqual([]);
  });

  it("merges two concurrent jobs into one covered stretch", () => {
    const c = employmentCoverage(
      [
        period({ id: "a", startedOn: "2023-01-01", endedOn: "2025-01-01" }),
        period({ id: "b", startedOn: "2024-01-01" }),
      ],
      TODAY,
    );
    expect(c.segmentA.gaps).toEqual([]);
    expect(c.segmentA.employers).toBe(2);
  });

  it("reports a gap that runs to the application date — an applicant out of work right now", () => {
    const c = employmentCoverage([period({ startedOn: "2019-01-01", endedOn: "2026-01-01" })], TODAY);
    expect(c.segmentA.gaps).toHaveLength(1);
    expect(c.segmentA.gaps[0]).toMatchObject({ to: TODAY });
  });
});

/**
 * The correction this file exists for (HIRING-PLAN.md D-HIRE1). §391.21(b)(11) asks only for the jobs
 * where the applicant OPERATED A CMV, so a stretch of years 3-10 with no CMV work is not a hole in
 * anything — it is somebody who was not driving. A ten-year gap check would flag every honest
 * applicant who left the industry for two years, in the direction that costs them a job.
 */
describe("Segment B — §391.21(b)(11), CMV only, and NO gap findings", () => {
  it("has no gaps field at all — absence there is not a defect", () => {
    const c = employmentCoverage([], TODAY);
    expect(c.segmentB).not.toHaveProperty("gaps");
  });

  it("does not let a non-driving year 5 produce a single finding", () => {
    const c = employmentCoverage(
      [
        period({ id: "warehouse", startedOn: "2019-01-01", endedOn: "2021-06-01", operatedCmv: false }),
        period({ id: "now", startedOn: "2023-08-19" }),
      ],
      TODAY,
    );
    expect(c.segmentA.gaps).toEqual([]);
    expect(c.segmentB.cmvEmployers).toBe(0);
    expect(c.segmentB.otherEmployers).toBe(1);
  });

  it("counts declared CMV employment in the 7-year period", () => {
    const c = employmentCoverage(
      [period({ id: "old", startedOn: "2017-01-01", endedOn: "2020-01-01", operatedCmv: true })],
      TODAY,
    );
    expect(c.segmentB.cmvEmployers).toBe(1);
    expect(c.segmentB.coveredDays).toBeGreaterThan(1000);
  });

  it("treats `null` operatedCmv as not-stated, never as a claim the applicant made", () => {
    // Every row written before 0214 is null: the office was asked about a three-year window and the
    // CMV question was never put to anyone.
    const c = employmentCoverage(
      [period({ startedOn: "2017-01-01", endedOn: "2020-01-01", operatedCmv: null })],
      TODAY,
    );
    expect(c.segmentB.cmvEmployers).toBe(0);
    expect(c.segmentB.otherEmployers).toBe(1);
  });

  it("splits one long job at the boundary rather than counting it twice", () => {
    const c = employmentCoverage(
      [period({ startedOn: "2018-01-01", endedOn: "2025-01-01", operatedCmv: true })],
      TODAY,
    );
    expect(c.segmentA.employers).toBe(1);
    expect(c.segmentB.cmvEmployers).toBe(1);
    expect(c.segmentA.coveredDays + c.segmentB.coveredDays).toBeLessThanOrEqual(
      c.segmentA.windowDays + c.segmentB.windowDays,
    );
  });

  it("ignores employment older than ten years entirely", () => {
    const c = employmentCoverage(
      [period({ startedOn: "2005-01-01", endedOn: "2010-01-01", operatedCmv: true })],
      TODAY,
    );
    expect(c.segmentB.cmvEmployers).toBe(0);
    expect(c.segmentA.employers).toBe(0);
  });
});

describe("§391.23(a)(2) inquiries — the preceding 3 years, so Segment A's alone", () => {
  it("owes nothing for a non-DOT-regulated employer, however long they worked there", () => {
    const c = employmentCoverage(
      [period({ startedOn: "2024-01-01", dotRegulated: false, inquiryStatus: "not_required" })],
      TODAY,
    );
    expect(c.inquiriesOutstanding).toEqual([]);
    expect(c.inquiriesAwaitingResponse).toEqual([]);
  });

  it("counts a documented non-response as SATISFIED, per §391.23(d)", () => {
    const c = employmentCoverage(
      [period({ startedOn: "2024-01-01", inquiryStatus: "no_response" })],
      TODAY,
    );
    expect(c.inquiriesOutstanding).toEqual([]);
    expect(c.inquiriesAwaitingResponse).toEqual([]);
  });

  it("separates 'never sent' from 'sent and waiting' — they are different phone calls", () => {
    const c = employmentCoverage(
      [
        period({ id: "a", startedOn: "2024-01-01", endedOn: "2025-01-01", inquiryStatus: "pending" }),
        period({ id: "b", startedOn: "2025-01-01", inquiryStatus: "sent" }),
      ],
      TODAY,
    );
    expect(c.inquiriesOutstanding.map((p) => p.id)).toEqual(["a"]);
    expect(c.inquiriesAwaitingResponse.map((p) => p.id)).toEqual(["b"]);
  });

  it("does NOT chase a Segment B employer — §391.23(a)(2) reaches three years, not ten", () => {
    const c = employmentCoverage(
      [period({ startedOn: "2017-01-01", endedOn: "2020-01-01", operatedCmv: true, inquiryStatus: "pending" })],
      TODAY,
    );
    expect(c.inquiriesOutstanding).toEqual([]);
  });
});
