/**
 * What the Fuel Costs page shows, derived from `GET /api/fueling/report` (FS2, D-FSV1/3/4/5/7).
 *
 * Pure, so every word and every comparison on the page is testable without a DOM. It does no fuel
 * arithmetic of its own: every ratio comes from `fuelReportTotals` (shared, D-FSV6), the MPG and the
 * cost per mile from the API (D-MPG1), and the only sums here are the grouping of the API's day ×
 * network × tank rows into days — which `fuelReportTotals` then reads.
 */
import {
  addDays,
  formatDisplayDate,
  formatDisplayDayShort,
  fuelReportTotals,
  type FuelReport,
  type FuelReportDay,
  type FuelReportSummary,
  type FuelReportWindow,
} from "@silvicom/shared";
import { gal, usd, usd3, wholeUsd } from "./format";

/** `09/01–09/30` — the shape D-FSV3 names a range in. */
export const rangeLabel = (w: { from: string; to: string }): string =>
  `${formatDisplayDayShort(w.from)}–${formatDisplayDayShort(w.to)}`;

/**
 * The relative change from `prev` to `cur`, or null when there is nothing honest to compare: either
 * side missing, or a previous range of zero (a change from nothing has no percentage).
 */
export function relativeChange(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

/** Whether a rise is good or bad news on a card. Neutral cards (miles, gallons) take no tone. */
type Better = "lower" | "higher" | null;

export interface CostCard {
  key: string;
  label: string;
  /** The industry term, for the hover (finance reader rule: the plain word leads). */
  term?: string;
  value: string;
  /** "+4.2% vs 08/02–08/31", or why there is no figure. */
  sub: string;
  /** The previous range's own figure, for the hover — the card states both ranges (D-FSV3). */
  previous: string;
  tone: "good" | "bad" | null;
}

const signed = (share: number): string => `${share > 0 ? "+" : share < 0 ? "−" : "±"}${Math.abs(share * 100).toFixed(1)}%`;

function card(
  key: string,
  label: string,
  cur: number | null,
  prev: number | null,
  fmt: (n: number | null) => string,
  better: Better,
  prevRange: string,
  opts: { term?: string; missing?: string } = {},
): CostCard {
  const ch = relativeChange(cur, prev);
  const tone = ch == null || ch === 0 || better == null ? null : (ch < 0) === (better === "lower") ? "good" : "bad";
  const sub = cur == null
    ? opts.missing ?? "no figure for this range"
    : ch == null ? `nothing to compare in ${prevRange}` : `${signed(ch)} vs ${prevRange}`;
  return { key, label, term: opts.term, value: fmt(cur), sub, previous: `${prevRange}: ${fmt(prev)}`, tone };
}

const mpgFmt = (n: number | null) => (n == null ? "—" : n.toFixed(2));
const milesFmt = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));

/**
 * The trend cards, picked range against the previous range of equal length (D-FSV3). Tractor fuel
 * only (D-FSV4); reefer is `reeferLine`. Miles, MPG and cost per mile are absent — not dashed — under a
 * station-side filter, where the page shows the API's sentence instead (D-FSV5).
 */
export function costCards(report: FuelReport): CostCard[] {
  const c = report.current;
  const p = report.previous;
  const prevRange = rangeLabel(p);
  const t = c.totals.tractor;
  const pt = p.totals.tractor;
  const cards = [
    card("spend", "Fuel spend", t.spend, pt.spend, usd, "lower", prevRange),
    card("gallons", "Gallons", t.gallons, pt.gallons, gal, null, prevRange),
    card("price", "Avg price / gal", t.pricePerGal, pt.pricePerGal, usd3, "lower", prevRange),
  ];
  if (c.efficiency != null) {
    const e = c.efficiency;
    const pe = p.efficiency;
    // A withheld MPG carries the API's own sentence; cost per mile is withheld for the same reason.
    const why = e.mpg.reason ?? undefined;
    cards.push(
      card("miles", "Miles", e.mpg.miles > 0 ? e.mpg.miles : null, pe && pe.mpg.miles > 0 ? pe.mpg.miles : null, milesFmt, null, prevRange, {
        term: "Measured odometer distance of the trucks that bought fuel",
      }),
      card("mpg", "MPG", e.mpg.mpg, pe?.mpg.mpg ?? null, mpgFmt, "higher", prevRange, { missing: why }),
      card("cpm", "Cost per mile", e.costPerMile, pe?.costPerMile ?? null, usd3, "lower", prevRange, {
        term: "Avg price / gal ÷ MPG — tractor fuel only",
        missing: why,
      }),
    );
  }
  cards.push(
    card("quote", "Paid vs Pilot quote", t.paidVsQuote, pt.paidVsQuote, wholeUsd, "lower", prevRange, {
      term: "Billed against contract: what we paid minus Pilot's quoted price, on the fills Pilot quoted",
      missing: "no fill in this range had a Pilot quote",
    }),
    card("out", "Out of network", c.totals.byNetwork.out.spend, p.totals.byNetwork.out.spend, usd, "lower", prevRange, {
      term: `Tractor fuel bought anywhere but ${brandList(report.inNetworkBrands)}`,
    }),
  );
  return cards;
}

const BRAND_NAMES: Record<string, string> = { pilot: "Pilot", flying_j: "Flying J", one9: "ONE9", loves: "Love's", ta: "TA", petro: "Petro" };
/** The carrier's network brands in words: "Pilot / Flying J". */
export const brandList = (brands: readonly string[]): string =>
  brands.length === 0 ? "no brand" : brands.map((b) => BRAND_NAMES[b] ?? b).join(" / ");

/** One sentence of where the tractor money went, by network side. Null when nothing was bought. */
export function networkLine(report: FuelReport): string | null {
  const n = report.current.totals.byNetwork;
  const total = report.current.totals.tractor.spend;
  if (!(total > 0)) return null;
  const share = (s: FuelReportSummary) => `${Math.round((s.spend / total) * 100)}%`;
  const parts = [
    `${usd(n.in.spend)} in network (${share(n.in)})`,
    `${usd(n.out.spend)} out of network (${share(n.out)})`,
  ];
  if (n.unknown.fills > 0) parts.push(`${usd(n.unknown.spend)} at a station we couldn't identify (${share(n.unknown)})`);
  return `Tractor fuel: ${parts.join(" · ")}.`;
}

/** Reefer fuel beside the tractor figures, never inside them (D-FSV4). Null when none was bought. */
export function reeferLine(w: FuelReportWindow): string | null {
  const r = w.totals.reefer;
  if (r.fills === 0) return null;
  return `Reefer fuel, not in the figures above: ${usd(r.spend)} for ${gal(r.gallons)} gal at ${usd3(r.pricePerGal)} / gal.`;
}

export interface CostDayRow {
  id: string;
  day: string;
  fills: number;
  gallons: number;
  spend: number;
  pricePerGal: number | null;
  outOfNetwork: number;
  paidVsQuote: number | null;
  reefer: number;
  /** Trailing-7-day MPG (D-FSV5); null under a station filter or when withheld (see `mpgReason`). */
  mpg: number | null;
  mpgReason: string | null;
}

/**
 * One row per day of the range, NEWEST first, days with no fuel included — a day the fleet bought
 * nothing is a fact the reader should see, not a gap in the list.
 */
export function costDayRows(report: FuelReport): CostDayRow[] {
  const byDay = new Map<string, FuelReportDay[]>();
  for (const d of report.current.days) {
    const list = byDay.get(d.day);
    if (list) list.push(d);
    else byDay.set(d.day, [d]);
  }
  const trailing = new Map((report.trailingMpg ?? []).map((t) => [t.day, t]));
  const rows: CostDayRow[] = [];
  for (let day = report.current.to; day >= report.current.from; day = addDays(day, -1)) {
    const totals = fuelReportTotals(byDay.get(day) ?? []);
    const t = trailing.get(day);
    rows.push({
      id: day,
      day,
      fills: totals.tractor.fills,
      gallons: totals.tractor.gallons,
      spend: totals.tractor.spend,
      pricePerGal: totals.tractor.pricePerGal,
      outOfNetwork: totals.byNetwork.out.spend,
      paidVsQuote: totals.tractor.paidVsQuote,
      reefer: totals.reefer.spend,
      mpg: t?.mpg ?? null,
      mpgReason: t == null ? null : t.reason,
    });
  }
  return rows;
}

/** The day table as a spreadsheet: same rows, same words, raw numbers. */
export function costDaysCsv(
  rows: readonly CostDayRow[],
  withMpg: boolean,
): { headers: string[]; rows: (string | number | null)[][] } {
  const headers = ["Day", "Fills", "Gallons", "Fuel spend", "Avg price / gal", "Out of network", "Paid vs Pilot quote", "Reefer"];
  if (withMpg) headers.push("MPG — previous 7 days");
  return {
    headers,
    rows: rows.map((r) => {
      const line: (string | number | null)[] = [
        formatDisplayDate(r.day), r.fills, r.gallons, r.spend, r.pricePerGal, r.outOfNetwork, r.paidVsQuote, r.reefer,
      ];
      if (withMpg) line.push(r.mpg);
      return line;
    }),
  };
}
