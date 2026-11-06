import { z } from "zod";
import { recordId } from "../recordId.js";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "../notificationsContract.js";
import { AD_AI_AGENTS, AD_PLATFORMS, type AdPlatform } from "./contracts.js";

/**
 * Settings › Ads control (ADS-AGENT-PLAN §4b): what one save of the page holds. Stored whole as
 * `ads_settings_versions.settings` (0537), one row per save, the newest in force. The kill switch is
 * a column of that row, not a field here, so the one read that answers "may anything spend?" never
 * parses JSON.
 *
 * ── NULL IS "NOT SET", AND NOT SET REFUSES ─────────────────────────────────────────────────────────
 * Every money value is nullable, and the defaults are all null. G5 (workflow §3): the page ships with
 * the benchmark figures shown beside each field as a suggestion, but nothing is in force until an
 * admin saves a value, and `adsPolicy` refuses a launch while the caps it needs are unset. A default
 * cap in code would be a spending decision nobody made.
 */

const cents = z.number().int().positive().max(100_000_000); // $1,000,000: far past any real cap, short of overflow

export const adsSpendLimitsSchema = z.object({
  /** Per platform; a platform with no cap cannot launch. */
  monthly_cap_cents: z.partialRecord(z.enum(AD_PLATFORMS), cents.nullable()),
  daily_max_cents: cents.nullable(),
  lifetime_max_cents: cents.nullable(),
  /** The largest raise one approval may make, both ways; the smaller wins. */
  max_raise_pct: z.number().int().min(1).max(500).nullable(),
  max_raise_cents: cents.nullable(),
});

export const adsAutoPauseSchema = z.object({
  cpl_max_cents: cents.nullable(),
  cpl_min_leads: z.number().int().min(1).max(1000).nullable(),
  no_lead_spend_cents: cents.nullable(),
  frequency_max: z.number().min(1).max(50).nullable(),
  pause_at_daily_cap: z.boolean(),
  pause_when_filled: z.boolean(),
});

export const adsApprovalsSchema = z.object({
  /** Above this daily amount a launch or raise needs a second, different approver. Null: one is enough. */
  second_approver_above_cents: cents.nullable(),
});

export const adsBudgetsSchema = z.object({
  /** Null refuses every Claude call (`aiRail.ts`), unlike `withinBudget`'s null, which means unlimited. */
  anthropic_tokens_monthly: z.number().int().min(0).max(1_000_000_000).nullable(),
  higgsfield_credits_monthly: z.number().int().min(0).max(10_000_000).nullable(),
  /** 0–5, the same bounds as `ads_creatives.regenerations` (0537). */
  max_regenerations: z.number().int().min(0).max(5),
  /**
   * D-RA9: every model-using worker has its own switch, OFF by default. An agent absent from this
   * record is off, so a worker added to `AD_AI_AGENTS` later starts switched off in every org that
   * saved settings before it existed — the safe direction, with no backfill. `.default({})` lets a
   * version saved before this field existed (none had been saved when it was added, A4) still parse.
   */
  agents_enabled: z.partialRecord(z.enum(AD_AI_AGENTS), z.boolean()).default({}),
});

/**
 * The bell's ads and lead categories, read from the contract rather than restated (0537 added them). The
 * lead ones are here because the carrier picks who hears them on the same screen (D2b): an ad's leads are
 * part of running the ad, and `uncontacted_lead_minutes` below is already this object's.
 */
export type AdsAlertCategory = Extract<NotificationCategory, `ads_${string}` | `lead_${string}`>;
export const ADS_ALERT_CATEGORIES = NOTIFICATION_CATEGORIES.filter(
  (c): c is AdsAlertCategory => c.startsWith("ads_") || c.startsWith("lead_"),
) as [AdsAlertCategory, ...AdsAlertCategory[]];

/**
 * Who hears an alert nobody was chosen for. The alerts that ask a person to CALL a lead fall back to
 * everybody who manages recruitment (`leadNotify.ts`); every other one to the org's admins, the people who
 * can pause an ad in the platform's own tool (`adsAlerts.ts`). Both API paths type their categories from
 * this list, so Settings › Ads control (E1b) can say who the default is without a second copy of the rule.
 */
export const ADS_LEAD_CALL_ALERTS = ["lead_new", "lead_uncontacted"] as const satisfies readonly AdsAlertCategory[];
export type AdsLeadCallAlert = (typeof ADS_LEAD_CALL_ALERTS)[number];
export const isLeadCallAlert = (c: AdsAlertCategory): c is AdsLeadCallAlert => (ADS_LEAD_CALL_ALERTS as readonly string[]).includes(c);

export const adsAlertsSchema = z.object({
  /** Member ids per alert; an empty list sends to the admins (a lead alert: to who holds recruitment manage). */
  recipients: z.partialRecord(
    z.enum(ADS_ALERT_CATEGORIES),
    z.array(recordId()).max(50),
  ),
  uncontacted_lead_minutes: z.number().int().min(5).max(1440),
});

/**
 * The outcome feed (B6; D-AD14 "disabled per org by a switch"; Q-AD40 (1), ruled by the orchestrator 2026-11-06):
 * whether a carrier's ad leads' stages go back to Meta, and the Conversions API dataset (Events Manager's dataset
 * id, digits) they go to. On only with a dataset: a switch with nowhere to send is refused at the save, not
 * discovered by a failed job.
 *
 * ── OPTIONAL, AND WHY (the replace-whole-object trap) ────────────────────────────────────────────
 * Every version saved before this group existed has no `outcome_feed`, and must still parse. So the group is
 * optional, and `outcomeFeedOf` reads an absent group as OFF. Optional rather than a zod default, so that every
 * `AdsSettings` a screen builds still type-checks. The trap: a save REPLACES the whole settings object
 * (`saveSettingsVersion`), so a form that does not carry this group through saves a version without it, and
 * that turns the feed off. Track S's Settings › Ads control form must round-trip it.
 */
export const adsOutcomeFeedSchema = z.object({
  enabled: z.boolean(),
  dataset_id: z.string().regex(/^\d{1,20}$/, "a Meta dataset id is its digits, from Events Manager").nullable(),
}).refine((f) => !f.enabled || f.dataset_id !== null, { message: "Name the Meta dataset before turning the outcome feed on", path: ["dataset_id"] });
export type AdsOutcomeFeed = z.infer<typeof adsOutcomeFeedSchema>;

export const ADS_OUTCOME_FEED_OFF: AdsOutcomeFeed = { enabled: false, dataset_id: null };

export const adsSettingsSchema = z.object({
  limits: adsSpendLimitsSchema,
  auto_pause: adsAutoPauseSchema,
  approvals: adsApprovalsSchema,
  budgets: adsBudgetsSchema,
  alerts: adsAlertsSchema,
  outcome_feed: adsOutcomeFeedSchema.optional(),
});
export type AdsSettings = z.infer<typeof adsSettingsSchema>;

/** What a carrier has before anyone saves: nothing in force, every money field unset. */
export const ADS_SETTINGS_UNSET: AdsSettings = {
  limits: { monthly_cap_cents: {}, daily_max_cents: null, lifetime_max_cents: null, max_raise_pct: null, max_raise_cents: null },
  auto_pause: {
    cpl_max_cents: null, cpl_min_leads: null, no_lead_spend_cents: null, frequency_max: null,
    pause_at_daily_cap: true, pause_when_filled: true,
  },
  approvals: { second_approver_above_cents: null },
  budgets: { anthropic_tokens_monthly: null, higgsfield_credits_monthly: null, max_regenerations: 1, agents_enabled: {} },
  alerts: { recipients: {}, uncontacted_lead_minutes: 15 },
};

/** The outcome feed a version says, an absent group (any version saved before Q-AD40) being OFF. */
export function outcomeFeedOf(settings: AdsSettings): AdsOutcomeFeed {
  return settings.outcome_feed ?? ADS_OUTCOME_FEED_OFF;
}

export function monthlyCapFor(settings: AdsSettings, platform: AdPlatform): number | null {
  return settings.limits.monthly_cap_cents[platform] ?? null;
}

/**
 * The starting figures Settings › Ads control shows BESIDE the auto-pause fields (plan §2a.7, G5): a
 * suggestion with its source, never a value in force. Nothing here is saved or read by the guard or the
 * monitor; a carrier's own four weeks of data replaces it (plan §8). Boostpoint's 2026 benchmark for CDL
 * drivers on Meta, 891 campaigns: median $26.86 per applicant, middle half $17.00–$42.31 — so "above $42
 * after 5 leads" is the top of the middle half, and $85 spent with no lead is about two of those.
 */
export const ADS_BENCHMARK_SUGGESTIONS = {
  source: "Boostpoint 2026 benchmark, CDL drivers on Meta",
  cpl_max_cents: 4_200,
  cpl_min_leads: 5,
  no_lead_spend_cents: 8_500,
} as const;
