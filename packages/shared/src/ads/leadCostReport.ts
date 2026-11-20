import { AD_HOOK_FAMILY_LABELS, AD_SCENE_FAMILY_LABELS, type AdHookFamily, type AdSceneFamily } from "./brandKitContract.js";
import type { LeadSourceOutcome } from "./leadOutcomes.js";
import { leadChannelLabel } from "../recruiting/leads/leadDisplay.js";

/**
 * One report: cost per qualified lead and per hire, by source and by angle (ADS-PLATFORM-V2-PLAN V7d). Pure — the
 * api reads, this folds — so the page and any later reader (the Analyst's brief) say the same figures.
 *
 * ── A COHORT, SAID AS ONE ────────────────────────────────────────────────────────────────────────
 * The rows are the leads that ARRIVED in the chosen days, and every stage those leads have reached SO FAR, whenever
 * it happened; the spend is what was spent in the same days. So a recent range shows few hires — they come weeks
 * later — and its cost per hire is high until they do. The page says so; nothing here projects or guesses.
 *
 * ── WHAT COUNTS AS QUALIFIED (Q-APX26 (a), recommended and built around) ─────────────────────────
 * A recruiter's qualify after a reached call (`qualified`, 0578), or any later step the office took with them:
 * made an applicant (`converted`), applied, hired. A lead whose own answers meet every requirement is NOT counted:
 * that is the form's measure, and counting it would let the easiest questions look the cheapest.
 *
 * ── SPEND, AND WHERE THERE IS NONE ───────────────────────────────────────────────────────────────
 * Spend is known only for an ad platform (Meta's hours, `ads_spend_hourly` by campaign and `ads_ad_spend_hourly` by
 * ad). A source with no spend recorded — Tenstreet, a typed-in call — shows its counts and `spend_cents: null`,
 * never a cost of $0, which would read as "free". The by-source row for an ad platform carries its CAMPAIGN spend;
 * the by-angle rows carry AD spend, and the two need not add up to the same cents (an hour Meta reported for the
 * campaign but not yet per ad). `ad_spend_unattributed_cents` says the difference.
 *
 * ── THE ANGLE ─────────────────────────────────────────────────────────────────────────────────────
 * An ad's angle is its creative's concept, the hook and scene pair (`conceptPair`) — the same value a plan's
 * angle is matched by (`angleKind`, `writerAngle`), so angles compare across campaigns. A lead's ad is the one its
 * platform named (`platform_ad_ref`), found in the publisher's record of the campaign (`platform_refs.ads[]`). A
 * lead whose ad cannot be found is counted under "Ad not known", and an ad whose preset names no concept under "No
 * angle named" — never guessed into another row.
 */

export interface AdAngleRef {
  /** The concept pair "hook+scene", or null when the creative's preset names none. */
  angle: string | null;
}

export interface LeadCostInput {
  leads: readonly LeadSourceOutcome[];
  /** Meta ad id → the angle of the creative it shows (the publisher's record joined to the preset). */
  ads: ReadonlyMap<string, AdAngleRef>;
  /** Spend in the range per platform channel (e.g. "meta"), from the campaign hours. */
  platformSpendCents: ReadonlyMap<string, number>;
  /** Spend in the range per angle key (`null` = no angle named), from the ad hours. */
  angleSpendCents: ReadonlyMap<string | null, number>;
}

export interface LeadCostRow {
  key: string;
  label: string;
  leads: number;
  qualified: number;
  hired: number;
  /** Null when no spend is recorded for this row — never 0 standing in for "unknown". */
  spend_cents: number | null;
  cost_per_qualified_cents: number | null;
  cost_per_hire_cents: number | null;
}

export interface LeadCostReport {
  by_source: LeadCostRow[];
  by_angle: LeadCostRow[];
  total: LeadCostRow;
  /** Ad spend whose campaign spend exists but whose ad rows do not add up to it; 0 when they agree. */
  ad_spend_unattributed_cents: number;
}

export const ANGLE_UNKNOWN_AD = "ad_not_known";
export const ANGLE_NOT_NAMED = "no_angle_named";

/** Q-APX26 (a): a recruiter's qualify, or any later step taken with the person. */
export function countsAsQualified(l: Pick<LeadSourceOutcome, "reached">): boolean {
  const r = l.reached;
  return Boolean(r.qualified || r.converted || r.applied || r.hired);
}

export function angleLabel(key: string): string {
  if (key === ANGLE_UNKNOWN_AD) return "Ad not known";
  if (key === ANGLE_NOT_NAMED) return "No angle named";
  const [hook, scene] = key.split("+") as [AdHookFamily, AdSceneFamily];
  const h = AD_HOOK_FAMILY_LABELS[hook], s = AD_SCENE_FAMILY_LABELS[scene];
  return h && s ? `${h}, ${s}` : key;
}

const per = (spend: number | null, n: number): number | null => (spend === null || n === 0 ? null : Math.round(spend / n));

function row(key: string, label: string, leads: readonly LeadSourceOutcome[], spend: number | null): LeadCostRow {
  const qualified = leads.filter(countsAsQualified).length;
  const hired = leads.filter((l) => l.reached.hired).length;
  return { key, label, leads: leads.length, qualified, hired, spend_cents: spend, cost_per_qualified_cents: per(spend, qualified), cost_per_hire_cents: per(spend, hired) };
}

function groupBy<K>(items: readonly LeadSourceOutcome[], keyOf: (l: LeadSourceOutcome) => K): Map<K, LeadSourceOutcome[]> {
  const out = new Map<K, LeadSourceOutcome[]>();
  for (const l of items) {
    const k = keyOf(l);
    out.set(k, [...(out.get(k) ?? []), l]);
  }
  return out;
}

const byLeadsThenKey = (a: LeadCostRow, b: LeadCostRow) => b.leads - a.leads || a.key.localeCompare(b.key);

export function foldLeadCostReport(input: LeadCostInput): LeadCostReport {
  // By source: every channel with a lead, and every platform with spend but no lead (money spent for nothing shows).
  const bySource = groupBy(input.leads, (l) => l.channel);
  for (const ch of input.platformSpendCents.keys()) if (!bySource.has(ch)) bySource.set(ch, []);
  const by_source = [...bySource].map(([ch, ls]) => row(ch, leadChannelLabel(ch), ls, input.platformSpendCents.get(ch) ?? null)).sort(byLeadsThenKey);

  // By angle: ad leads only (a lead with a campaign). Its ad found → its angle; not found → "Ad not known".
  const adLeads = input.leads.filter((l) => l.campaign_id !== null);
  const angleOf = (l: LeadSourceOutcome): string => {
    const ad = l.platform_ad_ref === null ? undefined : input.ads.get(l.platform_ad_ref);
    if (!ad) return ANGLE_UNKNOWN_AD;
    return ad.angle ?? ANGLE_NOT_NAMED;
  };
  const byAngle = groupBy(adLeads, angleOf);
  for (const k of input.angleSpendCents.keys()) {
    const key = k ?? ANGLE_NOT_NAMED;
    if (!byAngle.has(key)) byAngle.set(key, []);
  }
  // "Ad not known" is never a key of the ad spend (those are concepts or null), so it reads as no spend recorded.
  const spendOfAngle = (key: string): number | null => {
    const v = input.angleSpendCents.get(key === ANGLE_NOT_NAMED ? null : key);
    return v === undefined ? null : v;
  };
  const by_angle = [...byAngle].map(([k, ls]) => row(k, angleLabel(k), ls, spendOfAngle(k))).sort(byLeadsThenKey);

  const platformTotal = [...input.platformSpendCents.values()].reduce((a, b) => a + b, 0);
  const angleTotal = [...input.angleSpendCents.values()].reduce((a, b) => a + b, 0);
  const anySpend = input.platformSpendCents.size > 0;
  // The total's cost per qualified lead and per hire is only said when every source with leads has its spend
  // recorded: dividing Meta's spend by Meta's AND Tenstreet's qualified leads would make the ads look cheaper than
  // they are. The spend itself is still shown.
  const total = row("all", "All sources", input.leads, anySpend ? platformTotal : null);
  const everySourceCosted = by_source.every((r) => r.leads === 0 || r.spend_cents !== null);
  if (!everySourceCosted) Object.assign(total, { cost_per_qualified_cents: null, cost_per_hire_cents: null });
  return {
    by_source,
    by_angle,
    total,
    ad_spend_unattributed_cents: Math.max(0, platformTotal - angleTotal),
  };
}

/** What `GET /api/ads/report/leads` answers: the report for the days asked, inclusive, in the carrier's zone. */
export interface AdsLeadCostView extends LeadCostReport {
  from: string;
  to: string;
  zone: string;
  /** The spend's currency, or null when nothing was spent in the range. */
  currency: string | null;
  checked_at: string;
}

/** The longest range the report reads in one ask: a year and a day, so a leap year's whole year fits. */
export const LEAD_COST_RANGE_MAX_DAYS = 366;
