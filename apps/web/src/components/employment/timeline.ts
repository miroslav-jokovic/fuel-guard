import { employmentCoverage, type EmploymentGap, type EmploymentPeriod } from "@silvicom/shared";

/**
 * The employment timeline's arithmetic, pure (HW5b, EM-9).
 *
 * ⚠ Nothing here is a second opinion about coverage. The gaps, the 3-year mark and the 10-year mark are
 * `employmentCoverage`'s — the function `applicationEmploymentGaps` (the filing) and the office's
 * coverage summaries already read — so the timeline draws exactly the gaps the filing asks about, at
 * the boundaries the filing uses. EM-9 was that this computation existed and nobody could see it.
 */

/** One job as the timeline draws it — every surface maps its own rows to this. */
export interface TimelineJob {
  key: string;
  name: string;
  /** "" when the job has no start date yet (an unfinished one). */
  startedOn: string;
  /** null = still there. */
  endedOn: string | null;
  operatedCmv: boolean | null;
  dotRegulated: boolean | null;
  /** How many answers the surface's own rules still want — 0 is "Complete". */
  missing: number;
  /** No name or no start date: the applicant's "Unfinished — finish or remove" (§9 P8, AF-4). */
  unfinished: boolean;
}

export type TimelineEntry =
  | { kind: "job"; at: string; job: TimelineJob }
  | { kind: "gap"; at: string; gap: EmploymentGap }
  | { kind: "mark"; at: string; years: 3 | 10; date: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function timelinePeriods(jobs: readonly TimelineJob[]): EmploymentPeriod[] {
  return jobs
    .filter((j) => ISO.test(j.startedOn))
    .map((j) => ({
      id: j.key,
      employerName: j.name,
      startedOn: j.startedOn,
      endedOn: j.endedOn && ISO.test(j.endedOn) ? j.endedOn : null,
      dotRegulated: j.dotRegulated ?? true,
      operatedCmv: j.operatedCmv,
      inquiryStatus: "not_required",
    }));
}

export interface Timeline {
  entries: TimelineEntry[];
  gaps: EmploymentGap[];
  /** (b)(11)'s driving jobs between the two marks — the 10-year coverage nobody was shown. */
  cmvBetween: number;
}

/** Order on a tie: a job that touches a boundary belongs to the later window, so it sits above the mark. */
const RANK = { job: 0, gap: 1, mark: 2 } as const;

/**
 * Newest first. A job sits at its end (today for a current one), a gap at its end, a mark at its day;
 * a job with no dates yet sits at the very top, where the person who has to finish it sees it first.
 */
export function buildTimeline(jobs: readonly TimelineJob[], asOf: string, withGaps: boolean): Timeline {
  const coverage = employmentCoverage(timelinePeriods(jobs), asOf);
  const gaps = withGaps ? coverage.segmentA.gaps : [];
  const entries: TimelineEntry[] = [
    ...jobs.map((job): TimelineEntry => ({
      kind: "job",
      at: !ISO.test(job.startedOn) ? "9999-12-31" : job.endedOn && ISO.test(job.endedOn) ? job.endedOn : asOf,
      job,
    })),
    ...gaps.map((gap): TimelineEntry => ({ kind: "gap", at: gap.to, gap })),
    { kind: "mark", at: coverage.segmentA.start, years: 3, date: coverage.segmentA.start },
    { kind: "mark", at: coverage.segmentB.start, years: 10, date: coverage.segmentB.start },
  ];
  entries.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    if (a.kind !== b.kind) return RANK[a.kind] - RANK[b.kind];
    if (a.kind === "job" && b.kind === "job") return a.job.startedOn < b.job.startedOn ? 1 : -1;
    return 0;
  });
  return { entries, gaps, cmvBetween: coverage.segmentB.cmvEmployers };
}
