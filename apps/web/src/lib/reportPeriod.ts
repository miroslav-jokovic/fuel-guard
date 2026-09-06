import { ymd } from "./dateWindow";

/**
 * The reporting period of a month-grained report, as the reader chooses it (D-FRUI1).
 *
 * The fleet report's money is a calendar-month fact — McLeod's ledger is swept and tied by whole
 * month (D-FLEET6, G11) — so the period a reader can ask for is built from whole months: one, a
 * quarter, the year to the end of one, or any run of them. `from` and `to` are INCLUSIVE calendar
 * days, the way the rest of the page states a period ("Jul 1 to Jul 31"); the query layer turns
 * `to` into the API's exclusive bound (`dateWindow.ts` has the reason). A custom range is snapped to
 * whole months on the way in, so no period ever asks the API for part of a month.
 *
 * Every function here is pure and takes its inputs as strings, so it can be tested without a clock.
 */
export type PeriodGrain = "month" | "quarter" | "ytd" | "custom";

export interface ReportPeriod {
  grain: PeriodGrain;
  /** Inclusive first day, `YYYY-MM-DD`. Always the 1st of a month. */
  from: string;
  /** Inclusive last day, `YYYY-MM-DD`. Always the last day of a month. */
  to: string;
}

/** `"2026-07"` from any `YYYY-MM…` string. */
export const monthKey = (day: string): string => day.slice(0, 7);

const parts = (key: string): { y: number; m: number } => {
  const [y, m] = key.split("-").map(Number);
  return { y: y ?? 0, m: m ?? 1 };
};

/** Calendar arithmetic on a month key: `shiftMonth("2026-01", -1)` is `"2025-12"`. */
export function shiftMonth(key: string, by: number): string {
  const { y, m } = parts(key);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const firstDay = (key: string): string => `${key}-01`;
const lastDay = (key: string): string => {
  const { y, m } = parts(key);
  return ymd(new Date(y, m, 0));
};

export const periodForMonth = (key: string): ReportPeriod => ({ grain: "month", from: firstDay(key), to: lastDay(key) });

/** The calendar quarter holding `key`: Q3 for any of July, August, September. */
export function periodForQuarter(key: string): ReportPeriod {
  const { y, m } = parts(key);
  const startMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const start = `${y}-${String(startMonth).padStart(2, "0")}`;
  return { grain: "quarter", from: firstDay(start), to: lastDay(shiftMonth(start, 2)) };
}

/** January 1st to the end of `key`'s month — "2026 to July". */
export const periodForYtd = (key: string): ReportPeriod => ({ grain: "ytd", from: firstDay(`${parts(key).y}-01`), to: lastDay(key) });

/**
 * A hand-picked range, widened to the whole months it touches. The ledger is month-grained and the
 * API widens a part-month window anyway (`getIncomeStatement`); doing it here means the page never
 * shows a period the figures do not actually cover. Reversed ends are put the right way round.
 */
export function periodForCustom(from: string, to: string): ReportPeriod {
  let a = monthKey(from);
  let b = monthKey(to);
  if (a > b) [a, b] = [b, a];
  return { grain: "custom", from: firstDay(a), to: lastDay(b) };
}

/**
 * The same grain, one step earlier (`-1`) or later (`+1`). A month steps by a month, a quarter by
 * a quarter, and the year to date moves its END month by one — "2026 to July" steps back to "2026
 * to June", which is how a reader compares the year's shape month by month. A custom range does
 * not step; it is re-picked.
 */
export function stepPeriod(period: ReportPeriod, by: -1 | 1): ReportPeriod {
  const endKey = monthKey(period.to);
  switch (period.grain) {
    case "month":
      return periodForMonth(shiftMonth(endKey, by));
    case "quarter":
      return periodForQuarter(shiftMonth(monthKey(period.from), by * 3));
    case "ytd":
      return periodForYtd(shiftMonth(endKey, by));
    case "custom":
      return period;
  }
}

/** Whether the period could step forward without its end passing `capKey` (a month key). */
export const canStepForward = (period: ReportPeriod, capKey: string): boolean =>
  period.grain !== "custom" && monthKey(stepPeriod(period, 1).to) <= capKey;

/** Re-express a period at another grain, anchored on the month it currently ends in. */
export function periodAtGrain(period: ReportPeriod, grain: PeriodGrain): ReportPeriod {
  const endKey = monthKey(period.to);
  switch (grain) {
    case "month":
      return periodForMonth(endKey);
    case "quarter":
      return periodForQuarter(endKey);
    case "ytd":
      return periodForYtd(endKey);
    case "custom":
      return { ...period, grain: "custom" };
  }
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = MONTHS_LONG.map((m) => m.slice(0, 3));
const monthName = (key: string, long: boolean): string => (long ? MONTHS_LONG : MONTHS_SHORT)[parts(key).m - 1] ?? key;

/**
 * What the period is called on the rail: "July 2026", "Q3 2026", "2026 to July", "Mar – Jul 2026".
 * Long month names where there is one month, short where there are two, because "March 2026 –
 * July 2026" is a sentence and the rail is a control.
 */
export function periodLabel(period: ReportPeriod): string {
  const a = monthKey(period.from);
  const b = monthKey(period.to);
  switch (period.grain) {
    case "month":
      return `${monthName(b, true)} ${parts(b).y}`;
    case "quarter":
      return `Q${Math.floor((parts(a).m - 1) / 3) + 1} ${parts(a).y}`;
    case "ytd":
      return `${parts(b).y} to ${monthName(b, true)}`;
    case "custom":
      if (a === b) return `${monthName(b, true)} ${parts(b).y}`;
      return parts(a).y === parts(b).y
        ? `${monthName(a, false)} – ${monthName(b, false)} ${parts(b).y}`
        : `${monthName(a, false)} ${parts(a).y} – ${monthName(b, false)} ${parts(b).y}`;
  }
}

/**
 * The month the report should open on: the latest month the McLeod sweep has finished, read from
 * the trend the page fetches anyway (D-FRUI1). A month in `missing` — never swept, or swept before
 * it ended (G11) — is not a month the report can open on, however recent it is; measured
 * 2026-09-03, "the last full calendar month" was August, swept on the 28th with eleven lines, and
 * the page opened on nothing. Null when no month in the span was reportable, and the caller falls
 * back to the calendar.
 */
export function latestReportableMonth(trend: { points: { month: string }[]; missing: string[] }): string | null {
  const missing = new Set(trend.missing);
  const months = trend.points.map((p) => p.month).filter((m) => !missing.has(m)).sort();
  return months.length ? months[months.length - 1]! : null;
}
