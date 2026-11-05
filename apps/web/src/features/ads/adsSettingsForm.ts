import { AD_AI_AGENTS, AD_PLATFORMS, ADS_ALERT_CATEGORIES, adsSettingsSchema, type AdAiAgent, type AdPlatform, type AdsAlertCategory, type AdsSettings } from "@silvicom/shared";

/**
 * Settings › Ads control's form, as text a person types, to and from the stored settings (Track S, E1a).
 * Pure, so the rules that matter — a blank field is "not set", never zero; dollars are stored as cents;
 * the parts this page does not show pass through untouched — are tested without a browser.
 *
 * ── BLANK IS "NOT SET" ───────────────────────────────────────────────────────────────────────────
 * The contract's money fields are nullable, and null REFUSES (a platform with no monthly cap cannot
 * launch; `settingsContract.ts`). So an emptied field must become null, not 0 — 0 would fail the
 * contract's `positive()` and, worse, read like a decision. The schema then judges the result, so the
 * page's errors are the contract's bounds, not a second copy of them.
 *
 * ── ONE SAVE, ONE VERSION ────────────────────────────────────────────────────────────────────────
 * A save writes the WHOLE settings object as a new version, so `toSettings` starts from the version it
 * was given and replaces the fields this form holds. E1b added the alerts (who hears each one, the
 * uncontacted-lead minutes) to the same form rather than a second save: two saves of one object would
 * each write a version, and the second would undo the first's unsaved half.
 *
 * ── AN EMPTY LIST IS LEFT OUT ────────────────────────────────────────────────────────────────────
 * An alert with nobody chosen goes to its default audience (`ADS_LEAD_CALL_ALERTS`). The contract reads
 * an absent list and an empty one the same, so only lists with somebody on them are written — the
 * agents' switches' rule, for the same reason: a saved version must read back as itself.
 */

export interface AdsSettingsFormValues {
  monthly_cap: Record<AdPlatform, string>;
  daily_max: string;
  lifetime_max: string;
  max_raise_pct: string;
  max_raise: string;
  cpl_max: string;
  cpl_min_leads: string;
  no_lead_spend: string;
  frequency_max: string;
  pause_at_daily_cap: boolean;
  pause_when_filled: boolean;
  second_approver_above: string;
  anthropic_tokens_monthly: string;
  higgsfield_credits_monthly: string;
  max_regenerations: string;
  agents_enabled: Record<AdAiAgent, boolean>;
  /** Member ids per alert, in the order they were added; empty = the alert's default audience. */
  recipients: Record<AdsAlertCategory, string[]>;
  uncontacted_lead_minutes: string;
}

const dollars = (cents: number | null | undefined): string => (cents == null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, ""));
const count = (n: number | null | undefined): string => (n == null ? "" : String(n));

export function toFormValues(s: AdsSettings): AdsSettingsFormValues {
  return {
    monthly_cap: Object.fromEntries(AD_PLATFORMS.map((p) => [p, dollars(s.limits.monthly_cap_cents[p])])) as Record<AdPlatform, string>,
    daily_max: dollars(s.limits.daily_max_cents),
    lifetime_max: dollars(s.limits.lifetime_max_cents),
    max_raise_pct: count(s.limits.max_raise_pct),
    max_raise: dollars(s.limits.max_raise_cents),
    cpl_max: dollars(s.auto_pause.cpl_max_cents),
    cpl_min_leads: count(s.auto_pause.cpl_min_leads),
    no_lead_spend: dollars(s.auto_pause.no_lead_spend_cents),
    frequency_max: count(s.auto_pause.frequency_max),
    pause_at_daily_cap: s.auto_pause.pause_at_daily_cap,
    pause_when_filled: s.auto_pause.pause_when_filled,
    second_approver_above: dollars(s.approvals.second_approver_above_cents),
    anthropic_tokens_monthly: count(s.budgets.anthropic_tokens_monthly),
    higgsfield_credits_monthly: count(s.budgets.higgsfield_credits_monthly),
    max_regenerations: String(s.budgets.max_regenerations),
    agents_enabled: Object.fromEntries(AD_AI_AGENTS.map((a) => [a, s.budgets.agents_enabled[a] === true])) as Record<AdAiAgent, boolean>,
    recipients: Object.fromEntries(ADS_ALERT_CATEGORIES.map((c) => [c, [...(s.alerts.recipients[c] ?? [])]])) as Record<AdsAlertCategory, string[]>,
    uncontacted_lead_minutes: String(s.alerts.uncontacted_lead_minutes),
  };
}

/** A typed number, or null for blank; NaN for anything else, which the schema then refuses. */
function num(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (t === "") return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}
function cents(text: string): number | null {
  const n = num(text);
  return n === null || Number.isNaN(n) ? n : Math.round(n * 100);
}

export type FormResult = { ok: true; settings: AdsSettings } | { ok: false; field: string; message: string };

/** The settings to save, from the version in force and what the person typed; or the first field the contract refuses. */
export function toSettings(base: AdsSettings, v: AdsSettingsFormValues): FormResult {
  const candidate: AdsSettings = {
    ...base,
    limits: {
      // A blank platform cap is left out, not stored as null: `monthlyCapFor` reads both as "no cap".
      monthly_cap_cents: Object.fromEntries(AD_PLATFORMS.flatMap((p) => {
        const c = cents(v.monthly_cap[p]);
        return c === null ? [] : [[p, c]];
      })),
      daily_max_cents: cents(v.daily_max),
      lifetime_max_cents: cents(v.lifetime_max),
      max_raise_pct: num(v.max_raise_pct),
      max_raise_cents: cents(v.max_raise),
    },
    auto_pause: {
      cpl_max_cents: cents(v.cpl_max),
      cpl_min_leads: num(v.cpl_min_leads),
      no_lead_spend_cents: cents(v.no_lead_spend),
      frequency_max: num(v.frequency_max),
      pause_at_daily_cap: v.pause_at_daily_cap,
      pause_when_filled: v.pause_when_filled,
    },
    approvals: { second_approver_above_cents: cents(v.second_approver_above) },
    budgets: {
      ...base.budgets,
      anthropic_tokens_monthly: num(v.anthropic_tokens_monthly),
      higgsfield_credits_monthly: num(v.higgsfield_credits_monthly),
      max_regenerations: num(v.max_regenerations) ?? Number.NaN,
      // Only the agents switched on: the contract reads an absent agent as off, so writing every `false` would
      // store a different object for the same choice, and a saved version would not read back as itself.
      agents_enabled: Object.fromEntries(AD_AI_AGENTS.filter((a) => v.agents_enabled[a]).map((a) => [a, true])),
    },
    alerts: {
      recipients: Object.fromEntries(ADS_ALERT_CATEGORIES.flatMap((c) => (v.recipients[c].length > 0 ? [[c, [...v.recipients[c]]]] : []))),
      uncontacted_lead_minutes: num(v.uncontacted_lead_minutes) ?? Number.NaN,
    },
  };
  const parsed = adsSettingsSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, settings: parsed.data };
  const issue = parsed.error.issues[0]!;
  return { ok: false, field: issue.path.join("."), message: FIELD_LABELS[issue.path.slice(0, 2).join(".")] ?? "Check the values on this page." };
}

/** What a refused field is called on the page, by its contract path. */
const FIELD_LABELS: Record<string, string> = {
  "limits.monthly_cap_cents": "A monthly cap must be a dollar amount above zero.",
  "limits.daily_max_cents": "The daily maximum must be a dollar amount above zero.",
  "limits.lifetime_max_cents": "The lifetime maximum must be a dollar amount above zero.",
  "limits.max_raise_pct": "The largest raise must be a whole percent from 1 to 500.",
  "limits.max_raise_cents": "The largest raise must be a dollar amount above zero.",
  "auto_pause.cpl_max_cents": "The cost per lead must be a dollar amount above zero.",
  "auto_pause.cpl_min_leads": "The number of leads must be a whole number from 1 to 1,000.",
  "auto_pause.no_lead_spend_cents": "The spend with no lead must be a dollar amount above zero.",
  "auto_pause.frequency_max": "The frequency must be a number from 1 to 50.",
  "approvals.second_approver_above_cents": "The second-approver amount must be a dollar amount above zero.",
  "budgets.anthropic_tokens_monthly": "AI tokens a month must be a whole number.",
  "budgets.higgsfield_credits_monthly": "Image credits a month must be a whole number.",
  "budgets.max_regenerations": "Tries per ad must be a whole number from 0 to 5.",
  "alerts.recipients": "One alert can go to at most 50 people.",
  "alerts.uncontacted_lead_minutes": "The minutes must be a whole number from 5 to 1,440 (a day).",
};
