import type { AdPlatform } from "./contracts.js";

/**
 * `GET /api/ads/spend` — Settings › Ads control's "spend control live" (ADS-AGENT-PLAN §4b; Track S, E1c).
 * Every figure here is computed by the code the guard and the rails already gate on: the D-AD5 fold
 * (`adsReport.ts`), the guard's platform month (`platformSpend`), `forecastMonthCents`, and the generation
 * ledger's month folds. The page adds nothing up itself, so it cannot disagree with what a launch is checked
 * against.
 *
 * ── WHAT "SPENT" MEANS HERE ────────────────────────────────────────────────────────────────────────
 * Our own hourly pull (`ads_spend_hourly`). A launch also reads what the platform reports for the account
 * and takes the larger of the two (`checkSpend`); that read costs a platform call per platform, so the page
 * does not make it. The page says so beside the forecast.
 */

export interface AdsSpendPlatform {
  platform: AdPlatform;
  month_to_date_cents: number;
  /** Null when no cap is saved: that platform cannot launch. */
  cap_cents: number | null;
  /** The daily budgets of every campaign that may still spend this month. */
  live_daily_cents: number;
  /** `forecastMonthCents(month_to_date, live_daily, days_left)`. */
  forecast_cents: number;
}

export interface AdsSpendCampaign {
  id: string;
  name: string;
  state: string;
  platform: AdPlatform;
  daily_budget_cents: number | null;
  lifetime_cap_cents: number | null;
  today_spend_cents: number;
  lifetime_spend_cents: number;
  lifetime_leads: number;
  /** Null with no lead, as the fold gives it. */
  lifetime_cost_per_lead_cents: number | null;
}

export interface AdsSpendReconcile {
  connection_id: string;
  provider: string;
  /** The last reconcile run that finished, or null if none ever has. */
  last_run_at: string | null;
  /** True when that run is older than two reconcile periods (or there is none): the daily check is not running. */
  late: boolean;
  /** Differences Meta reported since that run began, each recorded once (`external_change`). */
  changes_since: number;
}

export interface AdsSpendView {
  month: string;
  today: string;
  days_left: number;
  platforms: AdsSpendPlatform[];
  campaigns: AdsSpendCampaign[];
  ai: {
    tokens_used: number;
    tokens_budget: number | null;
    credits_used: number;
    credits_budget: number | null;
  };
  reconcile: AdsSpendReconcile[];
}
