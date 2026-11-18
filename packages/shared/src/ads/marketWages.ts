import { JURISDICTIONS } from "../jurisdictions.js";
import type { EvidenceItem } from "./campaignPlan.js";

/**
 * Market pay as evidence for a campaign's plan (ADS-PLATFORM-V2-PLAN V2r, D-AD35): what heavy and tractor-trailer
 * truck drivers earn, in the nation and in the state an ad's area is centred in, from the Bureau of Labor
 * Statistics' Occupational Employment and Wage Statistics (OEWS). Pure: the API reader is the api's
 * (`plan/marketWages.ts`); this file names the series and turns their values into sentences.
 *
 * ── WHY THE API AND NOT A PAGE, AND WHY NO MODEL ──────────────────────────────────────────────────────
 * Measured 2026-11-18: `bls.gov`'s occupation pages answer 403 to a server, and the public data API answers the
 * series. A wage is a number in a published series; a model reading a wage page can misread it, an API row
 * cannot. So no model touches these figures — code reads them and code writes the sentence.
 *
 * ── THE SERIES ─────────────────────────────────────────────────────────────────────────────────────────
 * An OEWS series id is `OEU` + area type (`N` nation, `S` state) + a seven-digit area code (`0000000` for the
 * nation, the state's FIPS code and five zeros for a state) + a six-digit industry (`000000`, all industries) +
 * the six-digit SOC code + a two-digit measure. The four measures were confirmed 2026-11-18 by matching the API's
 * 2025 answers for the nation with O*NET's local-wages page, which states BLS as its source: 13 the annual
 * median ($58,640), 08 the hourly median ($28.19), 11 the 10th percentile ($40,140), 15 the 90th ($79,380).
 *
 * ── AN ITEM IS WHOLE OR ABSENT ─────────────────────────────────────────────────────────────────────────
 * A sentence is written for an area only when all four measures are known for the SAME year. Three of four, or
 * a median of one year beside a percentile of another, would be a sentence that is partly older than it says.
 * BLS withholds a figure it cannot publish (the API answers no data for that series); then the area has no item,
 * which says nothing rather than something untrue — the pack's rule that a missing count is not evidence.
 */

/** Heavy and tractor-trailer truck drivers. */
export const OEWS_SOC = "533032";
export const OEWS_OCCUPATION = "heavy and tractor-trailer truck drivers";

export const OEWS_MEASURES = { annual_median: "13", hourly_median: "08", annual_p10: "11", annual_p90: "15" } as const;
export type OewsMeasure = keyof typeof OEWS_MEASURES;
const MEASURE_KEYS = Object.keys(OEWS_MEASURES) as OewsMeasure[];

/** The nation, or one state by its two-letter code. */
export type OewsArea = { kind: "nation" } | { kind: "state"; code: string };

/** The FIPS code of a US state on the jurisdictions catalogue; null for a code it has none for (Canada, a typo). */
export function stateFips(code: string): string | null {
  return JURISDICTIONS.find((j) => j.code === code && j.country === "US")?.fips ?? null;
}

export function oewsSeriesId(area: OewsArea, measure: OewsMeasure): string | null {
  if (area.kind === "nation") return `OEUN0000000000000${OEWS_SOC}${OEWS_MEASURES[measure]}`;
  const fips = stateFips(area.code);
  return fips ? `OEUS${fips}00000000000${OEWS_SOC}${OEWS_MEASURES[measure]}` : null;
}

/** Every series an area needs, by measure; null when the area cannot be named (a state with no FIPS code). */
export function oewsSeriesFor(area: OewsArea): Record<OewsMeasure, string> | null {
  const out = {} as Record<OewsMeasure, string>;
  for (const m of MEASURE_KEYS) {
    const id = oewsSeriesId(area, m);
    if (!id) return null;
    out[m] = id;
  }
  return out;
}

/** One series' latest published value. `value` null = BLS answered and holds no figure for it. */
export interface MarketWageFact {
  series_id: string;
  year: number;
  value: number | null;
}

const dollars = (n: number, cents: boolean) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;

/** Where a person can see the series on BLS's own site (a browser is served; a server is refused). */
export const oewsSourceUrl = (seriesId: string) => `https://data.bls.gov/timeseries/${seriesId}`;

/**
 * The market items for one campaign: the nation always (when known), and the state of the area's centre when it
 * is a US state. `state` is the two-letter code the caller found for the centre, or null.
 */
export function marketEvidence(state: string | null, facts: readonly MarketWageFact[]): EvidenceItem[] {
  const byId = new Map(facts.map((f) => [f.series_id, f]));
  const areas: Array<{ area: OewsArea; slug: string; where: string }> = [];
  if (state && stateFips(state)) {
    const name = JURISDICTIONS.find((j) => j.code === state)!.name;
    areas.push({ area: { kind: "state", code: state }, slug: `oews_${state.toLowerCase()}`, where: `in ${name}, the state this ad's area is centred in,` });
  }
  areas.push({ area: { kind: "nation" }, slug: "oews_us", where: "across the United States" });

  const items: EvidenceItem[] = [];
  for (const a of areas) {
    const series = oewsSeriesFor(a.area);
    if (!series) continue;
    const got = MEASURE_KEYS.map((m) => byId.get(series[m]));
    if (got.some((f) => !f || f.value === null)) continue;
    const years = new Set(got.map((f) => f!.year));
    if (years.size !== 1) continue;
    const v = Object.fromEntries(MEASURE_KEYS.map((m, i) => [m, got[i]!.value!])) as Record<OewsMeasure, number>;
    items.push({
      id: `market:${a.slug}`, kind: "market", source: oewsSourceUrl(series.annual_median),
      text: `BLS wage survey, ${[...years][0]}: ${OEWS_OCCUPATION} ${a.where} earned a median of ${dollars(v.annual_median, false)} a year (${dollars(v.hourly_median, true)} an hour); a tenth earned ${dollars(v.annual_p10, false)} or less and a tenth ${dollars(v.annual_p90, false)} or more.`,
    });
  }
  return items;
}
