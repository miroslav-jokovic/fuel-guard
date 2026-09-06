/**
 * Calendar-day arithmetic that both layers need, defined once.
 *
 * `exclusiveEnd` lived in `apps/web/src/lib/dateWindow.ts`, where its own header explains the rule it
 * exists for: page state holds the INCLUSIVE day a person picked, and the query layer converts it on
 * the way to an API that windows `.gte(from).lt(to)`. That rule has not changed and that file still
 * states it.
 *
 * What changed is that the API now needs the same step. FUEL-P2's decline export windows
 * `declined_transactions` exactly as the Declines tab does — through `efsRejectDayWindow`, which turns
 * a picked day into the Central-time instant that bounds it — and a second implementation of "the day
 * after this one" is a copy of a rule, which is a workaround with a delay fuse (CLAUDE.md). So the
 * arithmetic moves here and `lib/dateWindow.ts` keeps its name for its existing callers.
 */

/**
 * Turn the inclusive end date a person picked into the exclusive bound a window is built on.
 *
 * Calendar arithmetic in UTC on purpose: `new Date("2026-06-30")` is parsed as UTC midnight, and adding
 * a day there cannot be knocked into the wrong date by a DST transition the way local-time arithmetic
 * can. Only the Y-M-D parts are ever read back out, so UTC is a pure counting frame here, not a
 * timezone claim.
 *
 * Malformed input comes back unchanged rather than becoming a guess — the caller's problem, not this
 * function's to invent.
 */
export function exclusiveEndYmd(inclusive: string): string {
  const day = inclusive.slice(0, 10);
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}
