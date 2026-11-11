/**
 * The Idling page's URL (`/idling`), ONE definition read by the page and by Ask AI's `idle_report`
 * link (F21 R4b, D-AI6). See `fuelCostsLinkContract.ts` for why a query string gets a contract.
 *
 * The page keeps its window as two calendar days, `from=YYYY-MM-DD&to=YYYY-MM-DD`, both inclusive,
 * on the carrier's calendar: `useIdleBreakdown` reads `from`/`to` as days, the same days
 * `readFleetIdleVerdict` reads for the tool, so the page's headline for a linked window is the
 * answer's `total`. A day that is not a calendar day reads as unset (the default last-30-days
 * window) — a link built by hand with `to=Oct 31` or an instant would open thirty other days beside
 * an answer about October, without a word. So the keys and the writer live here.
 *
 * The answer's `previous_period` and `by_week`/`by_month` are not on the page; the link opens the
 * answer's whole period, the figure the page shows.
 */
export const IDLING_QUERY_KEYS = { from: "from", to: "to" } as const;

/** The page's query for an inclusive window of calendar days (`2026-10-01` … `2026-10-31`). */
export const idlingToQuery = (w: { from: string; to: string }): Record<string, string> => ({
  [IDLING_QUERY_KEYS.from]: w.from.slice(0, 10),
  [IDLING_QUERY_KEYS.to]: w.to.slice(0, 10),
});
