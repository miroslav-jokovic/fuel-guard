import { wallClockInZone, wallClockToUtc, DEFAULT_ORG_TIMEZONE } from "../calendarDay.js";
import type { AdPlatform, OutcomeStage } from "./contracts.js";

/**
 * D-AD5: numbers come from a fold; the model only narrates. Every figure the settings page, the ads
 * page and the daily brief show is computed here, from stored rows, so the three can never disagree
 * and the analyst's prose can be checked against exactly this output (F1). Pure: "now" is an argument.
 *
 * ── THE MONTH IS THE CARRIER'S, IN CENTRAL TIME ────────────────────────────────────────────────────
 * Caps are monthly, and a month that started at UTC midnight would hand the last six hours of the
 * 31st to the next month's cap. Month bounds use the org's zone (default America/Chicago, the same
 * constant every other day bucket in shared reads), through `wallClockToUtc` so DST lands correctly.
 */

export interface MonthContext {
  /** The month's first instant, UTC ISO. */
  start: string;
  /** The next month's first instant, UTC ISO (exclusive end). */
  end: string;
  /** "2026-11" */
  month: string;
  /** Days left in the month, today included: 1 on the last day. The `adsPolicy` forecast's multiplier. */
  days_left: number;
}

export function monthContext(now: Date, zone: string = DEFAULT_ORG_TIMEZONE): MonthContext {
  const wc = wallClockInZone(now, zone);
  const nextY = wc.month === 12 ? wc.year + 1 : wc.year;
  const nextM = wc.month === 12 ? 1 : wc.month + 1;
  const start = wallClockToUtc({ year: wc.year, month: wc.month, day: 1, hour: 0, minute: 0, second: 0 }, zone);
  const end = wallClockToUtc({ year: nextY, month: nextM, day: 1, hour: 0, minute: 0, second: 0 }, zone);
  const daysInMonth = new Date(Date.UTC(wc.year, wc.month, 0)).getUTCDate();
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    month: `${wc.year}-${String(wc.month).padStart(2, "0")}`,
    days_left: daysInMonth - wc.day + 1,
  };
}

// ── spend ───────────────────────────────────────────────────────────────────────────────────────
export interface SpendHourRow {
  campaign_id: string;
  hour: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
}

export interface CampaignTotals {
  campaign_id: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
  /** Null with no lead: a cost per lead of "spend / 0" is not a number to show. */
  cost_per_lead_cents: number | null;
  /** Clicks per impression, 0–1; null with no impression. */
  ctr: number | null;
}

/** Totals per campaign over the rows given (the caller picks the window). Sorted by campaign id. */
export function foldCampaignSpend(rows: readonly SpendHourRow[]): CampaignTotals[] {
  const by = new Map<string, CampaignTotals>();
  for (const r of rows) {
    const t = by.get(r.campaign_id) ?? {
      campaign_id: r.campaign_id, spend_cents: 0, impressions: 0, clicks: 0, leads: 0, cost_per_lead_cents: null, ctr: null,
    };
    t.spend_cents += r.spend_cents;
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    t.leads += r.leads;
    by.set(r.campaign_id, t);
  }
  return [...by.values()]
    .map((t) => ({
      ...t,
      cost_per_lead_cents: t.leads > 0 ? Math.round(t.spend_cents / t.leads) : null,
      ctr: t.impressions > 0 ? t.clicks / t.impressions : null,
    }))
    .sort((a, b) => (a.campaign_id < b.campaign_id ? -1 : a.campaign_id > b.campaign_id ? 1 : 0));
}

/**
 * Month-to-date spend per platform — `SpendRequest.month_to_date_cents`. Rows outside [start, end)
 * are ignored, so the caller may pass a wider read safely. A campaign with no known platform is
 * counted under none and reported, never guessed into one.
 */
export function monthToDateByPlatform(
  rows: readonly SpendHourRow[],
  platformOf: ReadonlyMap<string, AdPlatform>,
  month: Pick<MonthContext, "start" | "end">,
): { by_platform: Partial<Record<AdPlatform, number>>; unattributed_campaigns: string[] } {
  const start = Date.parse(month.start);
  const end = Date.parse(month.end);
  const by_platform: Partial<Record<AdPlatform, number>> = {};
  const unattributed = new Set<string>();
  for (const r of rows) {
    const t = Date.parse(r.hour);
    if (!(t >= start && t < end)) continue;
    const p = platformOf.get(r.campaign_id);
    if (!p) { unattributed.add(r.campaign_id); continue; }
    by_platform[p] = (by_platform[p] ?? 0) + r.spend_cents;
  }
  return { by_platform, unattributed_campaigns: [...unattributed].sort() };
}

// ── lead cohorts (D-RA10's outcome report) ──────────────────────────────────────────────────────
export interface LeadOutcomeRow {
  lead_id: string;
  campaign_id: string | null;
  created_at: string;
  /** Every stage the lead reached, any order. */
  stages: readonly OutcomeStage[];
}

export interface Cohort {
  /** The Monday (zone-local) the cohort's week starts. */
  week: string;
  leads: number;
  reached: Record<OutcomeStage, number>;
  /**
   * False while the cohort is younger than `matureAfterDays` from its week's end: its hire rate is
   * still climbing, and showing it beside an old cohort's would read as a decline. The screens grey an
   * immature cohort's rates; the analyst may not compare them (F1).
   */
  mature: boolean;
}

const STAGES: readonly OutcomeStage[] = ["contacted", "qualified", "applied", "hired", "lost"];

/** The zone-local Monday of an instant's week, "YYYY-MM-DD". */
function mondayOf(at: Date, zone: string): string {
  const wc = wallClockInZone(at, zone);
  const d = new Date(Date.UTC(wc.year, wc.month - 1, wc.day));
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function foldLeadCohorts(
  leads: readonly LeadOutcomeRow[],
  now: Date,
  matureAfterDays = 28,
  zone: string = DEFAULT_ORG_TIMEZONE,
): Cohort[] {
  const by = new Map<string, Cohort>();
  for (const l of leads) {
    const week = mondayOf(new Date(l.created_at), zone);
    const c = by.get(week) ?? {
      week, leads: 0, mature: false,
      reached: { contacted: 0, qualified: 0, applied: 0, hired: 0, lost: 0 },
    };
    c.leads += 1;
    for (const s of new Set(l.stages)) if (STAGES.includes(s)) c.reached[s] += 1;
    by.set(week, c);
  }
  // Whole zone-local days, compared as UTC dates so a DST night is not an hour short of a day.
  const wc = wallClockInZone(now, zone);
  const todayUtc = Date.UTC(wc.year, wc.month - 1, wc.day);
  for (const c of by.values()) {
    const weekEnd = Date.parse(`${c.week}T00:00:00Z`) + 7 * 86_400_000;
    c.mature = todayUtc - weekEnd >= matureAfterDays * 86_400_000;
  }
  return [...by.values()].sort((a, b) => (a.week < b.week ? -1 : 1));
}
