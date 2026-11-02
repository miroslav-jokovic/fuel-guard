import type { AdsSettings } from "./settingsContract.js";

/**
 * Settings → Meta Automated Rules (ADS-AGENT-BUILD-WORKFLOW.md B3; plan v3 §2a "our limits are also
 * written as Meta Automated Rules"). Pure: the auto-pause settings in, the rules Meta should hold out.
 * Meta then pauses an ad set itself, every 30 minutes, even while our worker is down: a second
 * enforcer, never the only one (our hourly monitor, B5, stays).
 *
 * ── SHAPES, FROM META'S PAGES (read 2026-11-02) ──────────────────────────────────────────────────
 * https://developers.facebook.com/docs/marketing-api/ad-rules/overview/evaluation-spec and the
 * schedule-based rules guide:
 *   · `evaluation_type: SCHEDULE` + `schedule_spec.schedule_type: SEMI_HOURLY` (on the hour and half hour).
 *   · Money in the currency's base unit: "for USD … a value of 1000 for spent is $10.00" — our cents.
 *   · Insights fields used: `cost_per_lead_fb`, `leadgen`, `spent`, `frequency`, `daily_ratio_spent`
 *     (= today_spent / adset.daily_budget; schedule rules only). One `time_preset` per rule, `EQUAL`.
 *   · `attribution_window: ACCOUNT_DEFAULT` (the only value), so Meta's numbers are the account's.
 *
 * ── ONLY OUR AD SETS ─────────────────────────────────────────────────────────────────────────────
 * Every rule filters `entity_type = ADSET` AND `name CONTAIN "S360|<platform>|adset|"` — our naming
 * taxonomy (`naming.ts`). An ad set someone made in Ads Manager is never paused by our rule (D-AD4:
 * an external object is reported, not touched). The name filter is documented ("Name object, by
 * partial complete match", operators EQUAL / CONTAIN / NOT_CONTAIN).
 *
 * ── WHAT IS NOT A META RULE ──────────────────────────────────────────────────────────────────────
 * `pause_when_filled` depends on OUR data (the opening's headcount), so it stays the monitor's.
 * The spend-with-no-leads rule is the one U2 doubts (error 2703 reported for spend-condition PAUSE
 * rules): it is sent, and if Meta refuses it, the sync records that refusal and our monitor remains
 * the only enforcer for it — the workflow's U2 fallback, said where it happens.
 */

export const AD_RULE_PREFIX = "S360|RULE|";
export const AD_RULE_KEYS = ["cpl_max", "no_lead_spend", "frequency_max", "daily_cap"] as const;
export type AdRuleKey = (typeof AD_RULE_KEYS)[number];

interface Filter {
  field: string;
  value: string | number | string[];
  operator: "EQUAL" | "GREATER_THAN" | "LESS_THAN" | "CONTAIN" | "IN";
}

export interface AdRuleSpec {
  key: AdRuleKey;
  name: string;
  evaluation_spec: { evaluation_type: "SCHEDULE"; filters: Filter[] };
  execution_spec: { execution_type: "PAUSE" };
  schedule_spec: { schedule_type: "SEMI_HOURLY" };
}

export type AdRulePlatformCode = "META" | "SIM";

/** The rule's name: our prefix, the key, the platform — so a sync finds exactly its own rules. */
export const adRuleName = (key: AdRuleKey, code: AdRulePlatformCode): string => `${AD_RULE_PREFIX}${code}|${key}`;

export function rulesSpec(autoPause: AdsSettings["auto_pause"], code: AdRulePlatformCode): AdRuleSpec[] {
  const ours: Filter[] = [
    { field: "entity_type", value: "ADSET", operator: "EQUAL" },
    { field: "name", value: `S360|${code}|adset|`, operator: "CONTAIN" },
    { field: "attribution_window", value: "ACCOUNT_DEFAULT", operator: "EQUAL" },
  ];
  const rule = (key: AdRuleKey, preset: string, conditions: Filter[]): AdRuleSpec => ({
    key,
    name: adRuleName(key, code),
    evaluation_spec: { evaluation_type: "SCHEDULE", filters: [...ours, { field: "time_preset", value: preset, operator: "EQUAL" }, ...conditions] },
    execution_spec: { execution_type: "PAUSE" },
    schedule_spec: { schedule_type: "SEMI_HOURLY" },
  });
  const out: AdRuleSpec[] = [];
  const a = autoPause;
  // A cost per lead is judged only once enough leads exist: "more than min − 1" is "at least min".
  if (a.cpl_max_cents !== null && a.cpl_min_leads !== null) {
    out.push(rule("cpl_max", "LIFETIME", [
      { field: "cost_per_lead_fb", value: a.cpl_max_cents, operator: "GREATER_THAN" },
      { field: "leadgen", value: a.cpl_min_leads - 1, operator: "GREATER_THAN" },
    ]));
  }
  if (a.no_lead_spend_cents !== null) {
    out.push(rule("no_lead_spend", "LIFETIME", [
      { field: "spent", value: a.no_lead_spend_cents, operator: "GREATER_THAN" },
      { field: "leadgen", value: 0, operator: "EQUAL" },
    ]));
  }
  // Fatigue over the last week (7 days including today): the window Meta's own delivery flags use.
  if (a.frequency_max !== null) out.push(rule("frequency_max", "LAST_7_DAYS", [{ field: "frequency", value: a.frequency_max, operator: "GREATER_THAN" }]));
  // Meta may spend up to 75% over a daily budget on a given day; this stops the ad set past 100%. A rule's
  // pause persists into tomorrow — a person resumes it — which is what "pause at the daily cap" asks.
  if (a.pause_at_daily_cap) out.push(rule("daily_cap", "TODAY", [{ field: "daily_ratio_spent", value: 1, operator: "GREATER_THAN" }]));
  return out;
}
