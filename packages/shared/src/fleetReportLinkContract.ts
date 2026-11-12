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
export const FLEET_REPORT_QUERY_KEYS = { from: "from", to: "to", grain: "grain", tab: "tab" } as const;

/** The page's tabs, in its order. `overview` is the default and is left out of a link. */
export const FLEET_REPORT_TABS = ["overview", "activity", "dispatchers", "trucks", "contractors", "statement"] as const;
export type FleetReportTab = (typeof FLEET_REPORT_TABS)[number];

export const FLEET_REPORT_GRAINS = ["month", "quarter", "ytd", "custom"] as const;
export type FleetReportGrain = (typeof FLEET_REPORT_GRAINS)[number];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** `"2026-07"` is a month this form accepts; anything else is not. */
export const isFleetReportMonth = (v: unknown): v is string => typeof v === "string" && MONTH.test(v);

/** The page's query for a period given as inclusive DAYS (`2026-07-01` … `2026-09-30`), and a tab. */
export function fleetReportToQuery(p: { grain: FleetReportGrain; from: string; to: string; tab?: FleetReportTab }): Record<string, string> {
  const K = FLEET_REPORT_QUERY_KEYS;
  return { [K.from]: p.from.slice(0, 7), [K.to]: p.to.slice(0, 7), [K.grain]: p.grain, ...(p.tab && p.tab !== "overview" ? { [K.tab]: p.tab } : {}) };
}

/**
 * The grain whole months from `from` to `to` (inclusive days) step as, for a link that only knows the
 * months — Ask AI's finance tools. One month is `month`; a calendar quarter is `quarter`; January to
 * any month is `ytd`; anything else is `custom`. January–March is both a quarter and a year to March:
 * it is `quarter` unless the question was about the year (`preferYtd`). The page checks the grain
 * against the months anyway (`periodFromLink`), so a wrong guess can only cost the rail's stepping.
 */
export function fleetReportGrainOf(from: string, to: string, preferYtd = false): FleetReportGrain {
  const [fy, fm] = from.slice(0, 7).split("-").map(Number) as [number, number];
  const [ty, tm] = to.slice(0, 7).split("-").map(Number) as [number, number];
  const months = (ty - fy) * 12 + (tm - fm) + 1;
  const ytd = fm === 1 && fy === ty;
  if (preferYtd && ytd) return "ytd";
  if (months === 1) return "month";
  if (months === 3 && fy === ty && (fm - 1) % 3 === 0) return "quarter";
  return ytd ? "ytd" : "custom";
}
