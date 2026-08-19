/**
 * §391.21(b)(10) employment-history arithmetic — WHETHER a driver's declared employment covers the
 * period the regulation asks about, and WHICH of those employers still owe a §391.23(a)(2) inquiry.
 *
 * Pure, and separate from `recruitmentContract.ts` for the same reason `dqFile.ts` is separate from
 * `dqCatalogue.ts`: the contract is the wire shape and changes when the API does; this is the
 * judgement and changes when the FMCSA does or when we find a bug.
 *
 * WHAT THE REGULATION ACTUALLY SAYS, because the window is the whole calculation:
 *   §391.21(b)(10) — the application lists every employer for the **3 years** preceding it.
 *   §391.21(b)(11) — a CDL applicant additionally lists 7 more years (10 total) of employment where
 *                    they operated a commercial motor vehicle. Tracked, not computed here: the
 *                    ten-year list has no gap obligation attached to it, and reporting a 2018 gap as
 *                    a defect would be inventing a rule.
 *   §391.23(a)(2),(d) — the carrier must investigate the safety performance history of every
 *                    **DOT-regulated** employer in the preceding 3 years, and a DOCUMENTED
 *                    non-response satisfies it.
 *
 * So the window is three years, the gap arithmetic runs inside it only, and a non-DOT-regulated
 * employer counts for coverage but owes no inquiry.
 */

/** A row as this module needs it — the contract's shape minus everything the arithmetic ignores. */
export interface EmploymentPeriod {
  id: string;
  employerName: string;
  startedOn: string;
  /** null = still employed there. Read as "through the window's end", never as an open interval. */
  endedOn: string | null;
  dotRegulated: boolean;
  inquiryStatus: "not_required" | "pending" | "sent" | "responded" | "no_response";
}

export interface EmploymentGap {
  from: string;
  to: string;
  days: number;
}

export interface EmploymentCoverage {
  windowStart: string;
  windowEnd: string;
  /** Gaps inside the window longer than GAP_TOLERANCE_DAYS, newest first. */
  gaps: EmploymentGap[];
  /** Days inside the window covered by at least one declared employment. */
  coveredDays: number;
  windowDays: number;
  /** Employers whose employment overlaps the window at all. */
  employersInWindow: number;
  /** DOT-regulated employers in the window whose §391.23(a)(2) inquiry has not been sent. */
  inquiriesOutstanding: EmploymentPeriod[];
  /** …and those where an inquiry went out but nothing has come back and no non-response was recorded. */
  inquiriesAwaitingResponse: EmploymentPeriod[];
  /** No rows at all — "nothing recorded" is not the same finding as "recorded and complete". */
  empty: boolean;
}

/** §391.21(b)(10)'s window, in years. */
export const EMPLOYMENT_WINDOW_YEARS = 3;

/**
 * How long a break has to be before it is worth a recruiter's attention.
 *
 * **The FMCSA specifies no threshold** — §391.21(b)(10) asks for the list and says nothing about
 * holes in it. 30 days is carrier practice, not regulation, and it is named here rather than
 * inlined so that nobody later reads a flagged 31-day gap as a federal finding. A week between two
 * trucking jobs is a week between two trucking jobs.
 */
export const GAP_TOLERANCE_DAYS = 30;

const DAY_MS = 86_400_000;

const toUtc = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** `today` minus N years, calendar-correct (never `days * 365`, which drifts a day per four years). */
export function yearsBefore(iso: string, years: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const y = Number(m[1]) - years;
  // Feb 29 minus three years is Feb 28, not Mar 1 — Date.UTC would roll it forward, so clamp.
  const day = Math.min(Number(m[3]), new Date(Date.UTC(y, Number(m[2]), 0)).getUTCDate());
  return fromUtc(Date.UTC(y, Number(m[2]) - 1, day));
}

/**
 * `asOf` is the date the window ends — the application date when we have one, today otherwise.
 * Passed in rather than read from a clock so the whole calculation is testable.
 */
export function employmentCoverage(
  periods: readonly EmploymentPeriod[],
  asOf: string,
): EmploymentCoverage {
  const windowEnd = toUtc(asOf);
  const windowStart = toUtc(yearsBefore(asOf, EMPLOYMENT_WINDOW_YEARS));
  const windowDays = Math.round((windowEnd - windowStart) / DAY_MS);

  // Clip every period to the window, drop the ones that miss it entirely, and merge overlaps —
  // two concurrent jobs cover one stretch of time, not two.
  const clipped = periods
    .map((p) => ({
      p,
      from: Math.max(toUtc(p.startedOn), windowStart),
      to: Math.min(p.endedOn ? toUtc(p.endedOn) : windowEnd, windowEnd),
    }))
    .filter((r) => Number.isFinite(r.from) && Number.isFinite(r.to) && r.to >= r.from)
    .sort((a, b) => a.from - b.from);

  const merged: Array<{ from: number; to: number }> = [];
  for (const r of clipped) {
    const last = merged[merged.length - 1];
    // `+ DAY_MS` so a job ending the day before the next one starts leaves no one-day phantom gap.
    if (last && r.from <= last.to + DAY_MS) last.to = Math.max(last.to, r.to);
    else merged.push({ from: r.from, to: r.to });
  }

  const gaps: EmploymentGap[] = [];
  let cursor = windowStart;
  for (const m of merged) {
    const days = Math.round((m.from - cursor) / DAY_MS);
    if (days > GAP_TOLERANCE_DAYS) gaps.push({ from: fromUtc(cursor), to: fromUtc(m.from), days });
    cursor = Math.max(cursor, m.to);
  }
  const tail = Math.round((windowEnd - cursor) / DAY_MS);
  if (tail > GAP_TOLERANCE_DAYS) gaps.push({ from: fromUtc(cursor), to: fromUtc(windowEnd), days: tail });

  const coveredDays = merged.reduce((sum, m) => sum + Math.round((m.to - m.from) / DAY_MS), 0);
  const inWindow = clipped.map((r) => r.p);
  const owed = inWindow.filter((p) => p.dotRegulated && p.inquiryStatus !== "not_required");

  return {
    windowStart: fromUtc(windowStart),
    windowEnd: fromUtc(windowEnd),
    gaps: gaps.reverse(),
    coveredDays,
    windowDays,
    employersInWindow: inWindow.length,
    inquiriesOutstanding: owed.filter((p) => p.inquiryStatus === "pending"),
    // 'no_response' is NOT awaiting anything: §391.23(d) lets a carrier rely on a documented
    // non-response, so listing it as outstanding would nag about a requirement already satisfied.
    inquiriesAwaitingResponse: owed.filter((p) => p.inquiryStatus === "sent"),
    empty: periods.length === 0,
  };
}
