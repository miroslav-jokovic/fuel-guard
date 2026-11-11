/**
 * The Fleet report's URL (`/fleet-report`): its PERIOD, read by the page and — next — by Ask AI's
 * `finance_report` and `income_statement` links (F21 R4b (e), D-AI6; why a query string gets a
 * contract: `fuelCostsLinkContract.ts`).
 *
 * Until 2026-11-11 the period lived only in the page (`ref<ReportPeriod>`), so a month could not be
 * linked or sent to anybody, and "Open in Fleet report" could only open the latest swept month.
 *
 * ── THE FORM ─────────────────────────────────────────────────────────────────────────────────────
 * `from` and `to` are MONTHS (`YYYY-MM`), both inclusive: the report's money is a calendar-month fact
 * (D-FLEET6), so no link can ask for part of a month. `grain` says how the rail steps: `month`,
 * `quarter`, `ytd` or `custom`. It is needed because months alone are ambiguous — January to March is
 * both Q1 and the year to March, and the two step differently. The page keeps the grain only when its
 * own period for that grain covers exactly these months; otherwise it reads the range as `custom`.
 */
export const FLEET_REPORT_QUERY_KEYS = { from: "from", to: "to", grain: "grain" } as const;

export const FLEET_REPORT_GRAINS = ["month", "quarter", "ytd", "custom"] as const;
export type FleetReportGrain = (typeof FLEET_REPORT_GRAINS)[number];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** `"2026-07"` is a month this form accepts; anything else is not. */
export const isFleetReportMonth = (v: unknown): v is string => typeof v === "string" && MONTH.test(v);

/** The page's query for a period given as inclusive DAYS (`2026-07-01` … `2026-09-30`). */
export function fleetReportToQuery(p: { grain: FleetReportGrain; from: string; to: string }): Record<string, string> {
  const K = FLEET_REPORT_QUERY_KEYS;
  return { [K.from]: p.from.slice(0, 7), [K.to]: p.to.slice(0, 7), [K.grain]: p.grain };
}
