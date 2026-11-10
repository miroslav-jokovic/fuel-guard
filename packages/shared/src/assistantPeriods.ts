import { isCalendarDay } from "./calendarDay.js";
import { addDays, windowDays } from "./fuelSpend/spendWindow.js";

/**
 * The calendar an assistant report is asked in (F21 R1, lifted here at R6a, 2026-11-10).
 *
 * R1 wrote this inside `fuel-spend/assistantFuelReport.ts`, because the Fuel Costs report was the
 * first page the assistant could ask in words. R6a's finance tools need the same answer to "what is
 * last quarter, on this carrier's clock", and a second copy in `financial` would let two tools in
 * one answer disagree about which days October has. That is the disagreement R1 removed. So the
 * rule lives here, once, and both modules ask it.
 *
 * Pure: `today` is the carrier's calendar day (`todayInZone(now, orgZone)`), never
 * `new Date().toISOString()`. That one is UTC and runs a Central-time evening into tomorrow (D-PREC6).
 */

export const ASSISTANT_REPORT_PERIODS = [
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "year_to_date",
  "last_year",
  "last_n_days",
] as const;
export type AssistantReportPeriod = (typeof ASSISTANT_REPORT_PERIODS)[number];

/** A year plus a leap day: the Fuel Costs route's own bound (`routes/report.ts` MAX_WINDOW_DAYS). */
export const ASSISTANT_MAX_WINDOW_DAYS = 366;

export interface AssistantRangeInput {
  period?: unknown;
  days?: unknown;
  from?: unknown;
  to?: unknown;
}

/** Both ends INCLUSIVE calendar days, as a reader says them ("Oct 1 to Oct 31"). */
export type AssistantRange = { ok: true; from: string; to: string; label: string } | { ok: false; error: string };

const pad = (n: number) => String(n).padStart(2, "0");
const monthStart = (y: number, m: number) => `${y}-${pad(m)}-01`;
/** Last day of month `m` (1–12) of year `y`. */
const monthEnd = (y: number, m: number) => addDays(m === 12 ? monthStart(y + 1, 1) : monthStart(y, m + 1), -1);

/**
 * The window in calendar days. Explicit `from`/`to` win over a preset; with neither, the last 30
 * days, as every other tool. A "this …" period ends today; a past one is whole.
 */
export function resolveAssistantRange(input: AssistantRangeInput, today: string): AssistantRange {
  const from = typeof input.from === "string" ? input.from.trim() : "";
  const to = typeof input.to === "string" ? input.to.trim() : "";
  if (from || to) {
    if (!isCalendarDay(from) || !isCalendarDay(to)) return { ok: false, error: "from and to must both be YYYY-MM-DD dates." };
    if (to < from) return { ok: false, error: "to is before from." };
    if (windowDays(from, to) > ASSISTANT_MAX_WINDOW_DAYS) return { ok: false, error: `Pick a range of at most ${ASSISTANT_MAX_WINDOW_DAYS} days.` };
    return { ok: true, from, to, label: `${from} to ${to}` };
  }
  const [y, m] = today.split("-").map(Number) as [number, number];
  const q = Math.floor((m - 1) / 3); // 0-based quarter
  const period = (ASSISTANT_REPORT_PERIODS as readonly string[]).includes(String(input.period))
    ? (input.period as AssistantReportPeriod)
    : "last_n_days";
  switch (period) {
    case "this_month":
      return { ok: true, from: monthStart(y, m), to: today, label: "this month so far" };
    case "last_month": {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { ok: true, from: monthStart(py, pm), to: monthEnd(py, pm), label: "last month" };
    }
    case "this_quarter":
      return { ok: true, from: monthStart(y, q * 3 + 1), to: today, label: `Q${q + 1} ${y} so far` };
    case "last_quarter": {
      const [py, pq] = q === 0 ? [y - 1, 3] : [y, q - 1];
      return { ok: true, from: monthStart(py, pq * 3 + 1), to: monthEnd(py, pq * 3 + 3), label: `Q${pq + 1} ${py}` };
    }
    case "year_to_date":
      return { ok: true, from: monthStart(y, 1), to: today, label: `${y} so far` };
    case "last_year":
      return { ok: true, from: monthStart(y - 1, 1), to: monthEnd(y - 1, 12), label: String(y - 1) };
    case "last_n_days": {
      const n = Math.min(Math.max(Math.trunc(Number(input.days)) || 30, 1), ASSISTANT_MAX_WINDOW_DAYS);
      return { ok: true, from: addDays(today, -(n - 1)), to: today, label: `last ${n} days` };
    }
  }
}

/** The calendar months `[from, to]` touches, each clipped to the range. */
export function assistantMonthsIn(from: string, to: string): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  for (;;) {
    const start = monthStart(y, m);
    if (start > to) break;
    const end = monthEnd(y, m);
    out.push({ from: start < from ? from : start, to: end > to ? to : end });
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

/**
 * The range widened to the whole calendar months it touches: the first of its first month to the
 * last day of its last. The finance section's money is month-grained (McLeod's ledger is swept and
 * tied a whole month at a time, D-FLEET6), so its page only ever asks for whole months
 * (`apps/web/src/lib/reportPeriod.ts`), and a finance tool asks the same way.
 */
export function assistantWholeMonths(from: string, to: string): { from: string; to: string } {
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return { from: `${from.slice(0, 7)}-01`, to: monthEnd(ty, tm) };
}

/** "748", " #748 ", "Unit 748" → "748". Case and surrounding words only; never a fuzzy match. */
export const assistantUnitKey = (u: string): string =>
  u.trim().toLowerCase().replace(/^(unit|truck)\s+/, "").replace(/^#/, "").trim();
