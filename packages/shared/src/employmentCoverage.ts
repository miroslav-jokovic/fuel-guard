/**
 * §391.21(b)(10)–(11) employment-history arithmetic — whether an applicant's declared employment
 * covers the periods the regulation asks about, and which employers still owe a §391.23(a)(2)
 * inquiry.
 *
 * Pure, and separate from `recruitmentContract.ts` for the reason `dqFile.ts` is separate from
 * `dqCatalogue.ts`: the contract is the wire shape and changes when the API does; this is the
 * judgement and changes when the FMCSA does or when we find a bug.
 *
 * ── TWO LISTS, TWO RULES (HIRING-PLAN.md D-HIRE1) ───────────────────────────────────────────────
 * Verified against 49 CFR §391.21(b) rather than recalled, because the first version of this file got
 * it wrong by computing a single three-year window:
 *
 *   (b)(10) — "A list of the names and addresses of the applicant's employers during the 3 years
 *             preceding", with dates and reasons for leaving. **ALL employment.**
 *   (b)(11) — "A list of the names and addresses of the applicant's employers during the 7-year
 *             period preceding the 3 years" in (10), **"but only for which the applicant was an
 *             operator of a commercial motor vehicle."**
 *
 * So a "ten-year employment history" is NOT ten years of everything, and **gap detection belongs to
 * Segment A alone**. An applicant who spent year five in a warehouse owes no explanation; reporting a
 * gap there would be wrong in the direction that costs somebody a job. Segment B reports what CMV
 * employment was declared and finds nothing missing, because absence there is not a defect.
 *
 *   (a)(2) — the §391.23 safety-performance investigation covers the **preceding 3 years**, so the
 *            inquiry obligations are Segment A's too, never Segment B's.
 */

/** A row as this module needs it — the contract's shape minus everything the arithmetic ignores. */
export interface EmploymentPeriod {
  id: string;
  employerName: string;
  startedOn: string;
  /** null = still employed there. Read as "through the window's end", never as an open interval. */
  endedOn: string | null;
  dotRegulated: boolean;
  /** §391.21(b)(11): did the applicant operate a CMV here? `null` = not stated (pre-0214 rows). */
  operatedCmv?: boolean | null;
  inquiryStatus: "not_required" | "pending" | "sent" | "responded" | "no_response";
}

export interface EmploymentGap {
  from: string;
  to: string;
  days: number;
}

/** §391.21(b)(10): the 3 years preceding the application. */
export const EMPLOYMENT_WINDOW_YEARS = 3;
/** §391.21(b)(11): the 7 years preceding those 3 — ten in total, CMV employment only. */
export const CMV_WINDOW_YEARS = 10;

/**
 * How long a break has to be before it is worth a recruiter's attention.
 *
 * **The FMCSA specifies no threshold** — §391.21(b)(10) asks for the list and says nothing about
 * holes in it. 30 days is carrier practice, not regulation, and it is named here rather than inlined
 * so nobody later reads a flagged 31-day gap as a federal finding. A week between two trucking jobs
 * is a week between two trucking jobs.
 */
export const GAP_TOLERANCE_DAYS = 30;

const DAY_MS = 86_400_000;

const toUtc = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** `iso` minus N years, calendar-correct (never `days * 365`, which drifts a day every four years). */
export function yearsBefore(iso: string, years: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const y = Number(m[1]) - years;
  // Feb 29 minus three years is Feb 28, not Mar 1 — Date.UTC would roll it forward, so clamp.
  const day = Math.min(Number(m[3]), new Date(Date.UTC(y, Number(m[2]), 0)).getUTCDate());
  return fromUtc(Date.UTC(y, Number(m[2]) - 1, day));
}

interface Clipped {
  period: EmploymentPeriod;
  from: number;
  to: number;
}

/** Clip to [start, end], drop what misses entirely, sort. */
function clip(periods: readonly EmploymentPeriod[], start: number, end: number): Clipped[] {
  return periods
    .map((p) => ({
      period: p,
      from: Math.max(toUtc(p.startedOn), start),
      to: Math.min(p.endedOn ? toUtc(p.endedOn) : end, end),
    }))
    .filter((r) => Number.isFinite(r.from) && Number.isFinite(r.to) && r.to >= r.from)
    .sort((a, b) => a.from - b.from);
}

/** Merge overlaps — two concurrent jobs cover one stretch of time, not two. */
function merge(clipped: readonly Clipped[]): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  for (const r of clipped) {
    const last = out[out.length - 1];
    // `+ DAY_MS` so a job ending the day before the next begins leaves no one-day phantom gap.
    if (last && r.from <= last.to + DAY_MS) last.to = Math.max(last.to, r.to);
    else out.push({ from: r.from, to: r.to });
  }
  return out;
}

const coveredDays = (merged: ReadonlyArray<{ from: number; to: number }>): number =>
  merged.reduce((sum, m) => sum + Math.round((m.to - m.from) / DAY_MS), 0);

/** §391.21(b)(10) — the 3 years, all employment, gaps meaningful. */
export interface SegmentA {
  start: string;
  end: string;
  gaps: EmploymentGap[];
  coveredDays: number;
  windowDays: number;
  employers: number;
}

/**
 * §391.21(b)(11) — years 3-10, CMV employment only.
 *
 * No `gaps` field, and its absence is the point: the regulation asks only for the CMV jobs, so a
 * stretch with none is a stretch the applicant was not driving, which is not a defect and must not
 * be renderable as one.
 */
export interface SegmentB {
  start: string;
  end: string;
  cmvEmployers: number;
  /** Entries in this window the applicant did NOT mark as CMV operation — listed, not required. */
  otherEmployers: number;
  coveredDays: number;
  windowDays: number;
}

export interface EmploymentCoverage {
  asOf: string;
  segmentA: SegmentA;
  segmentB: SegmentB;
  /** §391.23(a)(2) covers the preceding 3 years — Segment A's employers only. */
  inquiriesOutstanding: EmploymentPeriod[];
  inquiriesAwaitingResponse: EmploymentPeriod[];
  /** No rows at all — "nothing recorded" is not the same finding as "recorded and complete". */
  empty: boolean;
}

/**
 * `asOf` is the date the windows end — the application date when we have one, the hire date
 * otherwise. Passed in rather than read from a clock so the whole calculation is testable, and
 * because §391.21(b) measures from the application: judging a five-year employee against today would
 * manufacture years of gap nobody was ever required to declare.
 */
export function employmentCoverage(
  periods: readonly EmploymentPeriod[],
  asOf: string,
): EmploymentCoverage {
  const end = toUtc(asOf);
  const aStart = toUtc(yearsBefore(asOf, EMPLOYMENT_WINDOW_YEARS));
  const bStart = toUtc(yearsBefore(asOf, CMV_WINDOW_YEARS));

  // ── Segment A: everything, gaps meaningful ────────────────────────────────────────────────────
  const inA = clip(periods, aStart, end);
  const mergedA = merge(inA);

  const gaps: EmploymentGap[] = [];
  let cursor = aStart;
  for (const m of mergedA) {
    const days = Math.round((m.from - cursor) / DAY_MS);
    if (days > GAP_TOLERANCE_DAYS) gaps.push({ from: fromUtc(cursor), to: fromUtc(m.from), days });
    cursor = Math.max(cursor, m.to);
  }
  const tail = Math.round((end - cursor) / DAY_MS);
  if (tail > GAP_TOLERANCE_DAYS) gaps.push({ from: fromUtc(cursor), to: fromUtc(end), days: tail });

  // ── Segment B: CMV only, NO gaps ──────────────────────────────────────────────────────────────
  // Half-open [bStart, aStart): (b)(11) is "the 7-year period PRECEDING the 3 years", so a job that
  // begins on the boundary belongs to (b)(10) and to it alone. Without the filter it also lands here
  // as a zero-day entry and is counted as an eighth-year employer it never was.
  const inB = clip(periods, bStart, aStart).filter((r) => r.from < aStart);
  const cmvInB = inB.filter((r) => r.period.operatedCmv === true);
  const mergedB = merge(cmvInB);

  // §391.23(a)(2) is the preceding 3 years, so the inquiry obligation is Segment A's alone.
  const owed = inA.map((r) => r.period).filter((p) => p.dotRegulated && p.inquiryStatus !== "not_required");

  return {
    asOf,
    segmentA: {
      start: fromUtc(aStart),
      end: fromUtc(end),
      gaps: gaps.reverse(),
      coveredDays: coveredDays(mergedA),
      windowDays: Math.round((end - aStart) / DAY_MS),
      employers: inA.length,
    },
    segmentB: {
      start: fromUtc(bStart),
      end: fromUtc(aStart),
      cmvEmployers: cmvInB.length,
      otherEmployers: inB.length - cmvInB.length,
      coveredDays: coveredDays(mergedB),
      windowDays: Math.round((aStart - bStart) / DAY_MS),
    },
    inquiriesOutstanding: owed.filter((p) => p.inquiryStatus === "pending"),
    // 'no_response' is NOT awaiting anything: §391.23(d) lets a carrier rely on a documented
    // non-response, so listing it as outstanding would nag about a requirement already satisfied.
    inquiriesAwaitingResponse: owed.filter((p) => p.inquiryStatus === "sent"),
    empty: periods.length === 0,
  };
}
