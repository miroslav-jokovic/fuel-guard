import { z } from "zod";
import { recordId } from "../recordId.js";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "../notificationsContract.js";
import { AD_PLATFORMS, type AdPlatform } from "./contracts.js";

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
  anthropic_tokens_monthly: z.number().int().min(0).max(1_000_000_000).nullable(),
  higgsfield_credits_monthly: z.number().int().min(0).max(10_000_000).nullable(),
  /** 0–5, the same bounds as `ads_creatives.regenerations` (0537). */
  max_regenerations: z.number().int().min(0).max(5),
});

/** The bell's ads categories, read from the contract rather than restated (0537 added them). */
type AdsAlertCategory = Extract<NotificationCategory, `ads_${string}`>;
export const ADS_ALERT_CATEGORIES = NOTIFICATION_CATEGORIES.filter(
  (c): c is AdsAlertCategory => c.startsWith("ads_"),
) as [AdsAlertCategory, ...AdsAlertCategory[]];

export const adsAlertsSchema = z.object({
  /** Member ids per alert; an empty list sends to the admins. */
  recipients: z.partialRecord(
    z.enum(ADS_ALERT_CATEGORIES),
    z.array(recordId()).max(50),
  ),
  uncontacted_lead_minutes: z.number().int().min(5).max(1440),
});

export const adsSettingsSchema = z.object({
  limits: adsSpendLimitsSchema,
  auto_pause: adsAutoPauseSchema,
  approvals: adsApprovalsSchema,
  budgets: adsBudgetsSchema,
  alerts: adsAlertsSchema,
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
  budgets: { anthropic_tokens_monthly: null, higgsfield_credits_monthly: null, max_regenerations: 1 },
  alerts: { recipients: {}, uncontacted_lead_minutes: 15 },
};

export function monthlyCapFor(settings: AdsSettings, platform: AdPlatform): number | null {
  return settings.limits.monthly_cap_cents[platform] ?? null;
}
