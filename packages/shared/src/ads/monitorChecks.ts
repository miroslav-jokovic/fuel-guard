import type { AdPlatform, CampaignState } from "./contracts.js";
import { monthlyCapFor, type AdsSettings } from "./settingsContract.js";

/**
 * The monitor's auto-pause checks (ADS-AGENT-BUILD-WORKFLOW.md B5b; plan §4b "Auto-pause rules … written to
 * Meta as Automated Rules AND checked by our hourly pull; each pause ledgered with its rule"). Pure: the
 * settings in force and what the hourly pull measured in, the campaigns to pause and why out. The job
 * (`apps/api/src/modules/ads/monitor/checks.ts`) gathers the facts and applies the answer; it decides nothing.
 *
 * ── THE SAME SETTINGS AND THE SAME COMPARISONS AS META'S RULES ───────────────────────────────────
 * Each threshold is read from `settings.auto_pause` (and the monthly cap from `limits`), never restated, and
 * compared the way `adsRulesSpec.ts` tells Meta to compare it, so the two enforcers agree on the boundary:
 *   · cpl_max        cost per lead > `cpl_max_cents`, once leads ≥ `cpl_min_leads` (lifetime)
 *   · no_lead_spend  spend > `no_lead_spend_cents` with 0 leads (lifetime)
 *   · frequency_max  frequency > `frequency_max` over the last 7 days, today included
 *   · daily_cap      today's spend > the campaign's daily budget, when `pause_at_daily_cap`
 * plus one Meta cannot hold, because it is a sum across campaigns:
 *   · monthly_cap    the platform's month-to-date > `limits.monthly_cap_cents[platform]` — every delivering
 *                    campaign on that platform. Month-to-date is the larger of our fold and the platform's own
 *                    account figure, as the guard forecasts (adsPolicy header, audit H4).
 * "Exactly at" the threshold does not fire; a cent over does (§4R L3: "fires exactly at its threshold").
 *
 * ── CAPS ALWAYS; PERFORMANCE RULES NEVER WHILE META IS STILL LEARNING ─────────────────────────────
 * Plan §2a: "never act on an ad set Meta marks as learning, except for the spend caps". Meta's
 * `learning_stage_info.status` is LEARNING, SUCCESS or FAIL, and is returned only for some active ad sets
 * on some accounts. So:
 *   · `learning`  → only the caps are checked;
 *   · `unknown`   → Meta did not say (the read failed this run): only the caps, and the job reports the read;
 *   · `not_learning` (SUCCESS, FAIL, or Meta returns no stage for this ad set) → every rule.
 * A missing stage is read as not learning on purpose: on an account Meta never reports stages for, the
 * other reading would switch the performance rules off for good, and silently.
 *
 * ── ONE REASON PER CAMPAIGN, THE MOST SERIOUS ────────────────────────────────────────────────────
 * A campaign breaching several rules is paused once, for the first in `MONITOR_RULES` order (caps first).
 * Only campaigns that can be delivering (`launching`, `live` — the machine's pause rows) are judged.
 */

export const MONITOR_RULES = ["monthly_cap", "daily_cap", "no_lead_spend", "cpl_max", "frequency_max"] as const;
export type MonitorRule = (typeof MONITOR_RULES)[number];
/** The rules that hold even while Meta is learning: they are about money, not performance. */
export const CAP_RULES: readonly MonitorRule[] = ["monthly_cap", "daily_cap"];

/**
 * Who hears a pause (plan §4b Alerts: overspend, rejected, no leads, external change, budget nearly used).
 * A cost-per-lead or frequency pause has no bell category in the plan: it is ledgered with its rule and
 * read in the daily brief (F1). Null = no bell.
 */
export const MONITOR_RULE_ALERT: Record<MonitorRule, "ads_overspend" | "ads_no_leads" | null> = {
  monthly_cap: "ads_overspend",
  daily_cap: "ads_overspend",
  no_lead_spend: "ads_no_leads",
  cpl_max: null,
  frequency_max: null,
};

export type LearningStage = "learning" | "not_learning" | "unknown";

export interface MonitorCampaignFacts {
  campaign_id: string;
  state: CampaignState;
  daily_budget_cents: number | null;
  /** The account's local day so far, from `ads_spend_hourly`. */
  today_spend_cents: number;
  lifetime_spend_cents: number;
  /** Meta's attributed on-Meta leads, lifetime (B5a header: counted at the impression's hour). */
  lifetime_leads: number;
  learning: LearningStage;
  /** Meta's frequency over the last 7 days, today included; null when unread or nothing delivered. */
  frequency_7d: number | null;
}

export interface MonitorFacts {
  platform: AdPlatform;
  /** This platform's month-to-date from our fold. */
  month_spend_cents: number;
  /** The platform's own account figure for the month; null when it could not be read. */
  platform_month_spend_cents: number | null;
  campaigns: MonitorCampaignFacts[];
}

export interface MonitorBreach {
  campaign_id: string;
  rule: MonitorRule;
  alert: "ads_overspend" | "ads_no_leads" | null;
  /** What was measured and the setting it passed, in the rule's own unit (cents, or a frequency). */
  measured: number;
  threshold: number;
}

const DELIVERING: readonly CampaignState[] = ["launching", "live"];

/** The first rule this campaign breaches, in `MONITOR_RULES` order, or null. */
function firstBreach(settings: AdsSettings, month: { spend: number; cap: number | null }, c: MonitorCampaignFacts): Omit<MonitorBreach, "campaign_id" | "alert"> | null {
  const a = settings.auto_pause;
  if (month.cap !== null && month.spend > month.cap) return { rule: "monthly_cap", measured: month.spend, threshold: month.cap };
  if (a.pause_at_daily_cap && c.daily_budget_cents !== null && c.today_spend_cents > c.daily_budget_cents) {
    return { rule: "daily_cap", measured: c.today_spend_cents, threshold: c.daily_budget_cents };
  }
  if (c.learning !== "not_learning") return null;
  if (a.no_lead_spend_cents !== null && c.lifetime_leads === 0 && c.lifetime_spend_cents > a.no_lead_spend_cents) {
    return { rule: "no_lead_spend", measured: c.lifetime_spend_cents, threshold: a.no_lead_spend_cents };
  }
  if (a.cpl_max_cents !== null && a.cpl_min_leads !== null && c.lifetime_leads >= a.cpl_min_leads) {
    const cpl = c.lifetime_spend_cents / c.lifetime_leads;
    if (cpl > a.cpl_max_cents) return { rule: "cpl_max", measured: Math.round(cpl), threshold: a.cpl_max_cents };
  }
  if (a.frequency_max !== null && c.frequency_7d !== null && c.frequency_7d > a.frequency_max) {
    return { rule: "frequency_max", measured: c.frequency_7d, threshold: a.frequency_max };
  }
  return null;
}

export function monitorChecks(settings: AdsSettings, facts: MonitorFacts): MonitorBreach[] {
  const month = {
    spend: Math.max(facts.month_spend_cents, facts.platform_month_spend_cents ?? 0),
    cap: monthlyCapFor(settings, facts.platform),
  };
  const out: MonitorBreach[] = [];
  for (const c of facts.campaigns) {
    if (!DELIVERING.includes(c.state)) continue;
    const b = firstBreach(settings, month, c);
    if (b) out.push({ campaign_id: c.campaign_id, alert: MONITOR_RULE_ALERT[b.rule], ...b });
  }
  return out;
}
