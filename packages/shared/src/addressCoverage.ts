import { yearsBefore } from "./employmentCoverage.js";

/**
 * §391.21(b)(3) residence-history arithmetic — do the applicant's addresses cover the three years?
 *
 * The regulation, read at source (docs/plans/recruitment/cfr-391-21/, eCFR as of 2026-09-24): the
 * application must contain "(3) The addresses at which the applicant has resided during the 3 years
 * preceding the date on which the application is submitted". Plan §4 measured the gap: the contract asks
 * for `.min(1)` address and nothing checked the three years, so an applicant could list today's
 * address alone and file.
 *
 * ── MONTHS, NOT DAYS, AND NO TOLERANCE ────────────────────────────────────────────────────────
 * The form keeps an address as a month range ("YYYY-MM", `applicationAddressSchema`), because nobody
 * remembers the day they moved. So coverage is counted in whole months: moving out in March and in
 * elsewhere in March or April is continuous; a whole month with no address listed is a gap. Unlike
 * employment (`GAP_TOLERANCE_DAYS`, carrier practice) there is no allowance — a person lived somewhere
 * every month, and (b)(3) asks where.
 *
 * ⚠ The window starts in the MONTH three years before `asOf`, and that month must be covered: someone
 * who moved into their first listed home the month after it has one month nobody accounted for.
 * `asOf` is the carrier's calendar day (the application's date), passed in for `employmentCoverage`'s
 * reason — a rule that read a clock would judge a draft against a day nobody chose.
 */

/** One address, as far as the arithmetic reads it. `to` empty or null = where they live now. */
export interface ResidencePeriod {
  from: string;
  to?: string | null;
}

/** Months with no address, inclusive at both ends, as "YYYY-MM". */
export interface ResidenceGap {
  from: string;
  to: string;
}

export interface AddressCoverage {
  /** The first and last month of the window, inclusive. */
  start: string;
  end: string;
  gaps: ResidenceGap[];
  covered: boolean;
}

/** §391.21(b)(3): the 3 years preceding the application. */
export const RESIDENCE_WINDOW_YEARS = 3;

const monthIndex = (ym: string): number => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? Number(m[1]) * 12 + (Number(m[2]) - 1) : Number.NaN;
};

const monthOf = (index: number): string =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

export function addressCoverage(addresses: readonly ResidencePeriod[], asOf: string): AddressCoverage {
  const end = monthIndex(asOf.slice(0, 7));
  const start = monthIndex(yearsBefore(asOf, RESIDENCE_WINDOW_YEARS).slice(0, 7));

  const spans = addresses
    .map((a) => ({
      from: Math.max(monthIndex(a.from), start),
      // No end month = the current address: it runs to the application.
      to: Math.min(a.to && a.to.trim() !== "" ? monthIndex(a.to) : end, end),
    }))
    .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to) && s.to >= s.from)
    .sort((a, b) => a.from - b.from);

  const gaps: ResidenceGap[] = [];
  let next = start;
  for (const s of spans) {
    if (s.from > next) gaps.push({ from: monthOf(next), to: monthOf(s.from - 1) });
    next = Math.max(next, s.to + 1);
  }
  if (next <= end) gaps.push({ from: monthOf(next), to: monthOf(end) });

  return { start: monthOf(start), end: monthOf(end), gaps, covered: gaps.length === 0 };
}

/**
 * How much of the three years the addresses cover, in whole months out of 36 — the meter beside the
 * address walk ("2 years 4 months of 3 covered", SCREEN-MAP 2.6a).
 *
 * ⚠ The window is 37 months long (the month three years back through this one, both counted), so the
 * meter counts what is still MISSING against 36 rather than what is covered against 37: one uncovered
 * month reads "2 years 11 months", never "3 years" beside a refusal. Complete is `coverage.covered`.
 */
export const RESIDENCE_WINDOW_MONTHS = RESIDENCE_WINDOW_YEARS * 12;

export function residenceMonthsCovered(coverage: AddressCoverage): number {
  const missing = coverage.gaps.reduce((n, g) => n + (monthIndex(g.to) - monthIndex(g.from) + 1), 0);
  return coverage.covered ? RESIDENCE_WINDOW_MONTHS : Math.max(0, Math.min(RESIDENCE_WINDOW_MONTHS - 1, RESIDENCE_WINDOW_MONTHS - missing));
}

/** The month before the earliest one any address starts in — where the next earlier home's "until" begins. */
export function earliestResidenceMonth(addresses: readonly ResidencePeriod[]): string | null {
  const starts = addresses.map((a) => monthIndex(a.from)).filter(Number.isFinite);
  return starts.length === 0 ? null : monthOf(Math.min(...starts));
}
