import type { AdPlatform } from "./contracts.js";
import { monthlyCapFor, type AdsSettings } from "./settingsContract.js";

/**
 * The money rules (D-AD3) and the agent's authority (D-AD2), pure. `modules/ads/guard/budgetGuard.ts`
 * (A5) is the only caller that acts on a verdict: it is the only import path to an adapter's spend
 * methods, so every launch and raise passes here first. The database repeats the two fences that are
 * facts about one row (AX020 approval, AX021 kill switch, 0537); this file holds the arithmetic.
 *
 * ── THE MONTHLY CAP IS CHECKED AGAINST A FORECAST, NOT AGAINST TODAY ───────────────────────────────
 * A launch that fits today's spend can still overrun the month: $100/day launched on the 1st under a
 * $2,000 cap spends $3,000 by the 30th. So the check is
 *     month-to-date spend + (every live daily budget on the platform, this one included) × days left
 * ≤ the cap, where "days left" counts today (a launch at 23:00 can still spend today's budget).
 * At the cap is allowed; a cent over is refused (boundary tests at −1/0/+1).
 *
 * ── SPEND SO FAR IS THE LARGER OF OURS AND THE PLATFORM'S, AND THE PLATFORM'S MUST BE READ ──────────
 * Our month-to-date is folded from `ads_spend_hourly`, which nothing writes until B5's monitor; and even
 * then it holds only OUR campaigns, never what someone spent in the platform's own tool on the same
 * account. A forecast from $0 would wave through a launch on an account that is already over the cap
 * (2026-11-03 audit H4). So the guard also reads the account's spend this month from the platform NOW,
 * and the forecast starts from the larger of the two. Unreadable refuses, as the account limit does:
 * a spend fence that cannot see spend is not a fence.
 *
 * ── THE PLATFORM'S OWN ACCOUNT LIMIT IS THE THIRD FENCE ────────────────────────────────────────────
 * The owner sets it by hand in the platform; our token never changes it (D-AD3.3). What counts is the
 * HEADROOM it leaves (Meta's limit is a lifetime total; 2026-11-03 audit M1). A launch is refused while
 * that is unknown or unset, zero (the platform would deliver nothing), or above our monthly cap — room
 * looser than ours means the platform would not stop us if we failed. So each month the owner sets the
 * limit to what the account has spent plus at most the cap.
 */

export type SpendAct = "launch" | "raise_budget";

export interface SpendRequest {
  act: SpendAct;
  platform: AdPlatform;
  /** The daily budget asked for. For a raise, the new value. */
  daily_cents: number;
  /** The lifetime cap the campaign will carry on the platform (D-AD3.2). */
  lifetime_cents: number;
  /** For a raise: the daily budget in force now. */
  current_daily_cents: number | null;
  /** This platform's spend so far this month (Central calendar month), from the spend fold. */
  month_to_date_cents: number;
  /** The ad account's own spend this month as the platform reports it NOW; null when it could not be read. */
  platform_month_to_date_cents: number | null;
  /** Daily budgets of the OTHER live campaigns on this platform. */
  other_live_daily_cents: number;
  /** Days left in the month, today included: 1 on the last day. */
  days_left_in_month: number;
  /**
   * What the platform account's own spending limit still allows (limit less lifetime spend, read now); 0
   * when reached; null when unset or unreadable. Headroom, not the raw limit: Meta's limit is lifetime.
   */
  account_headroom_cents: number | null;
  kill_switch: boolean;
}

export type SpendRefusal =
  | "kill_switch_on"
  | "caps_not_set"
  | "account_limit_unknown"
  | "month_spend_unknown"
  | "account_limit_above_cap"
  | "account_limit_reached"
  | "daily_over_max"
  | "lifetime_over_max"
  | "lifetime_below_daily"
  | "raise_not_a_raise"
  | "raise_over_limit"
  | "monthly_cap_forecast";

export type SpendVerdict =
  | { ok: true; forecast_cents: number; cap_cents: number }
  | { ok: false; refusals: SpendRefusal[]; forecast_cents: number | null; cap_cents: number | null };

/** Every refusal that applies, not just the first: the screen says all of what is wrong at once. */
export function checkSpend(settings: AdsSettings, r: SpendRequest): SpendVerdict {
  const refusals: SpendRefusal[] = [];
  const cap = monthlyCapFor(settings, r.platform);
  const { daily_max_cents: dailyMax, lifetime_max_cents: lifetimeMax } = settings.limits;

  if (r.kill_switch) refusals.push("kill_switch_on");
  if (cap === null || dailyMax === null || lifetimeMax === null) refusals.push("caps_not_set");
  if (r.account_headroom_cents === null) refusals.push("account_limit_unknown");
  else if (r.account_headroom_cents === 0) refusals.push("account_limit_reached");
  else if (cap !== null && r.account_headroom_cents > cap) refusals.push("account_limit_above_cap");
  if (r.platform_month_to_date_cents === null) refusals.push("month_spend_unknown");
  if (dailyMax !== null && r.daily_cents > dailyMax) refusals.push("daily_over_max");
  if (lifetimeMax !== null && r.lifetime_cents > lifetimeMax) refusals.push("lifetime_over_max");
  if (r.lifetime_cents < r.daily_cents) refusals.push("lifetime_below_daily");

  if (r.act === "raise_budget") {
    const current = r.current_daily_cents;
    if (current === null || r.daily_cents <= current) refusals.push("raise_not_a_raise");
    else if (raiseOverLimit(settings, current, r.daily_cents)) refusals.push("raise_over_limit");
  }

  const spent = Math.max(r.month_to_date_cents, r.platform_month_to_date_cents ?? 0);
  const forecast = forecastMonthCents(spent, r.other_live_daily_cents + r.daily_cents, r.days_left_in_month);
  if (cap !== null && forecast > cap) refusals.push("monthly_cap_forecast");

  if (refusals.length === 0 && cap !== null) return { ok: true, forecast_cents: forecast, cap_cents: cap };
  return { ok: false, refusals, forecast_cents: forecast, cap_cents: cap };
}

/**
 * The month's spend if every live daily budget runs to the end of the month, today included (D-AD3). One
 * definition, read by the launch check above and by Settings › Ads control's "spend control live" (E1c),
 * so the page's forecast is the number the guard would refuse on.
 */
export function forecastMonthCents(spentCents: number, liveDailyCents: number, daysLeft: number): number {
  return spentCents + liveDailyCents * Math.max(1, Math.floor(daysLeft));
}

/**
 * A raise is over the limit when it exceeds EITHER configured bound (% or $), whichever is smaller.
 * With neither set, no raise is allowed: an unset limit is not "unlimited" (settingsContract header).
 */
function raiseOverLimit(settings: AdsSettings, current: number, next: number): boolean {
  const { max_raise_pct: pct, max_raise_cents: abs } = settings.limits;
  if (pct === null && abs === null) return true;
  const delta = next - current;
  if (abs !== null && delta > abs) return true;
  // Integer arithmetic: delta / current > pct / 100  ⇔  delta × 100 > pct × current.
  if (pct !== null && delta * 100 > pct * current) return true;
  return false;
}

/** Lowering spend never needs a check: the safe direction is always open (plan §5). */
export function isSafeDirection(current_daily_cents: number, next_daily_cents: number): boolean {
  return next_daily_cents <= current_daily_cents;
}

/** True when a second, different approver is required for this daily amount (§4b "Approvals"). */
export function needsSecondApprover(settings: AdsSettings, daily_cents: number): boolean {
  const above = settings.approvals.second_approver_above_cents;
  return above !== null && daily_cents > above;
}

// ── the authority table (D-AD2, plan §5) ────────────────────────────────────────────────────────
/**
 * Every act the ads module can perform, and who may perform it. `agent` acts unattended; `person`
 * is any member allowed on the brief's section; `approver` is a person holding the named capability
 * `ads.spend` whose approval row the act cites; `admin` holds `ads.connection` or edits settings;
 * `never` has no code path at all — the request builders have no field for it.
 */
export type AdsAuthority = "agent" | "person" | "approver" | "admin" | "never";

export const ADS_AUTHORITY = {
  draft_copy: ["agent"],
  check_claims: ["agent"],
  pick_presets_compose_render_check: ["agent"],
  regenerate_once: ["agent"],
  create_paused: ["agent", "person"],
  read_insights: ["agent", "person"],
  pause: ["agent", "person"],
  lower_budget: ["agent", "person"],
  pause_on_rule: ["agent"],
  archive: ["agent", "person"],
  report: ["agent"],
  recommend: ["agent"],
  approve_creative: ["person"],
  launch: ["approver"],
  raise_budget: ["approver"],
  change_area: ["approver"],
  edit_live_copy: ["approver"],
  edit_settings_brand_kit_presets: ["admin"],
  connect_platform: ["admin"],
  // Pressing it only pauses — the safe direction, open to anyone on the campaign (plan §5). Clearing it
  // lets spending start again, which is an admin's act.
  kill_switch_on: ["person"],
  kill_switch_off: ["admin"],
  message_a_lead: ["never"],
  delete_anything: ["never"],
  target_by_age_gender_or_zip: ["never"],
  change_billing_or_account_limit: ["never"],
} as const satisfies Record<string, readonly AdsAuthority[]>;
export type AdsAct = keyof typeof ADS_AUTHORITY;

export function mayAct(act: AdsAct, who: Exclude<AdsAuthority, "never">): boolean {
  return (ADS_AUTHORITY[act] as readonly AdsAuthority[]).includes(who);
}
