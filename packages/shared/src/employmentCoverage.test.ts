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
  inquiryStatus: over.inquiryStatus ?? "pending",
});

const TODAY = "2026-08-19";

describe("the §391.21(b)(10) window", () => {
  it("is three calendar years, and a leap day clamps rather than rolling forward", () => {
    expect(yearsBefore("2026-08-19", 3)).toBe("2023-08-19");
    // Feb 29 minus three years is Feb 28. Date.UTC(2021, 1, 29) would give March 1.
    expect(yearsBefore("2024-02-29", 3)).toBe("2021-02-28");
  });

  it("reports an empty file as empty rather than as one enormous gap", () => {
    const c = employmentCoverage([], TODAY);
    expect(c.empty).toBe(true);
    expect(c.employersInWindow).toBe(0);
    // The gap is still computed and still true — "nothing recorded" is a finding, not silence.
    expect(c.gaps).toHaveLength(1);
  });
});

describe("gaps", () => {
  it("finds nothing when one job covers the whole window", () => {
    const c = employmentCoverage([period({ startedOn: "2019-01-01" })], TODAY);
    expect(c.gaps).toEqual([]);
    expect(c.coveredDays).toBe(c.windowDays);
  });

  it("ignores a short break between two jobs, and reports a long one", () => {
    const short = employmentCoverage(
      [
        period({ id: "a", startedOn: "2019-01-01", endedOn: "2024-06-01" }),
        period({ id: "b", startedOn: "2024-06-20" }),
      ],
      TODAY,
    );
    expect(short.gaps).toEqual([]); // 19 days, under the 30-day carrier-practice threshold

    const long = employmentCoverage(
      [
        period({ id: "a", startedOn: "2019-01-01", endedOn: "2024-06-01" }),
        period({ id: "b", startedOn: "2024-10-01" }),
      ],
      TODAY,
    );
    expect(long.gaps).toHaveLength(1);
    expect(long.gaps[0]).toMatchObject({ from: "2024-06-01", to: "2024-10-01" });
    expect(long.gaps[0]!.days).toBeGreaterThan(GAP_TOLERANCE_DAYS);
  });

  it("leaves no phantom gap when one job ends the day the next begins", () => {
    const c = employmentCoverage(
      [
        period({ id: "a", startedOn: "2019-01-01", endedOn: "2025-03-31" }),
        period({ id: "b", startedOn: "2025-04-01" }),
      ],
      TODAY,
    );
    expect(c.gaps).toEqual([]);
  });

  it("merges two concurrent jobs into one covered stretch", () => {
    const c = employmentCoverage(
      [
        period({ id: "a", startedOn: "2023-01-01", endedOn: "2025-01-01" }),
        period({ id: "b", startedOn: "2024-01-01" }),
      ],
      TODAY,
    );
    expect(c.gaps).toEqual([]);
    expect(c.employersInWindow).toBe(2);
  });

  it("reports a gap that runs to today — an applicant out of work right now", () => {
    const c = employmentCoverage(
      [period({ startedOn: "2019-01-01", endedOn: "2026-01-01" })],
      TODAY,
    );
    expect(c.gaps).toHaveLength(1);
    expect(c.gaps[0]).toMatchObject({ to: TODAY });
  });

  it("ignores employment that ended before the window opened", () => {
    const c = employmentCoverage(
      [period({ startedOn: "2010-01-01", endedOn: "2015-01-01" })],
      TODAY,
    );
    expect(c.employersInWindow).toBe(0);
    expect(c.coveredDays).toBe(0);
  });
});

describe("§391.23(a)(2) inquiries", () => {
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

  it("does not chase an employer who falls entirely outside the three-year window", () => {
    const c = employmentCoverage(
      [period({ startedOn: "2015-01-01", endedOn: "2018-01-01", inquiryStatus: "pending" })],
      TODAY,
    );
    expect(c.inquiriesOutstanding).toEqual([]);
  });
});
