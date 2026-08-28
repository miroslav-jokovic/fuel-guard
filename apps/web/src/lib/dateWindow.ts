/**
 * The date-window contract between a date PICKER and the accounting API.
 *
 * Every accounting reader windows with `.gte(from).lt(to)` — `financialReads.ts` on
 * `accrued_at`/`distribution_date`/`bill_date`/`settled_at`, `financial/reads.ts` and
 * `financial/cpm.ts` on `occurred_at` — so `to` is EXCLUSIVE. `monthsCovered` agrees, breaking
 * on `first >= toIso`. That contract is deliberate and consistent, and it is not the bug.
 *
 * The bug is that a date picker means something else. Pick "Jun 1 – Jun 30" and you mean June,
 * all of it; hand that end date straight to the API and June 30 vanishes. Both accounting pages
 * used to paper over this in their DEFAULTS — CPM defaulted `to` to the 1st of the next month,
 * the ledger to tomorrow — so the shipped defaults were right and every hand-picked range
 * silently lost its last day. That is the worst shape a reporting bug can take: the number stays
 * plausible, no error is raised, and nobody sees the missing day.
 *
 * So the rule is now explicit and lives in one place: page state holds the INCLUSIVE day the
 * user picked, and the query layer calls `exclusiveEnd` on the way to the API. Defaults are
 * written as the inclusive dates a person would say out loud ("June 1 to June 30").
 */

/**
 * A calendar day as the USER's clock sees it — not `toISOString()`.
 *
 * `new Date(2026, 5, 1).toISOString().slice(0, 10)` is local midnight re-expressed in UTC. West
 * of Greenwich that lands on the same day and looks fine, which is exactly why this survived: the
 * carrier is in Chicago. East of Greenwich it lands on the day BEFORE, and every default window
 * on both pages shifts by one. Reading the local parts avoids the round trip entirely.
 */
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Turn the inclusive end date a person picked into the exclusive bound the API windows on.
 *
 * Calendar arithmetic in UTC on purpose: `new Date("2026-06-30")` is parsed as UTC midnight, and
 * adding a day there cannot be knocked into the wrong date by a DST transition the way local-time
 * arithmetic can. Only the Y-M-D parts are ever read back out, so UTC is a pure counting frame
 * here, not a timezone claim.
 */
export function exclusiveEnd(inclusive: string): string {
  const day = inclusive.slice(0, 10);
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day; // malformed input is the caller's problem, not ours to invent
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * The trailing complete calendar month, as INCLUSIVE dates.
 *
 * CPM is a period figure and a part-month window reads low on fixed-cadence costs, so the report
 * defaults to a month that has actually finished. `isMonthAligned` on the API side wants the
 * exclusive form to be the 1st — which `exclusiveEnd` of the last day gives it for free.
 */
export function lastFullMonth(today: Date = new Date()): { from: string; to: string } {
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: ymd(first), to: ymd(last) };
}

/** The trailing `n` days ending today, as INCLUSIVE dates. */
export function trailingDays(n: number, today: Date = new Date()): { from: string; to: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  return { from: ymd(start), to: ymd(today) };
}
