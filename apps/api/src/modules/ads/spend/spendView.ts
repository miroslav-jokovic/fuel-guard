import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AD_PLATFORMS,
  DEFAULT_ORG_TIMEZONE,
  foldCampaignSpend,
  forecastMonthCents,
  monthContext,
  monthlyCapFor,
  wallClockInZone,
  wallClockToUtc,
  type AdPlatform,
  type AdsSpendCampaign,
  type AdsSpendReconcile,
  type AdsSpendView,
  type SpendHourRow,
} from "@silvicom/shared";
import { lastDoneJobByKey } from "../../org/index.js";
import { platformSpend } from "../guard/budgetGuard.js";
import { anthropicTokensThisMonth, higgsfieldCreditsThisMonth } from "../generations/generationLedger.js";
import { ADS_RECONCILE_MS, adsReconcileDedupKey } from "../monitor/reconcileTick.js";
import { settingsInForce } from "../settings/settingsVersions.js";

/**
 * Settings › Ads control's "spend control live" (plan §4b; Track S, E1c): `GET /api/ads/spend`. A read only —
 * no write, no platform call — and every number is one the guard, the monitor or a rail already computes:
 *
 *   per platform   `platformSpend` (the guard's own month and live budgets, B5b's "one fold"), the cap from
 *                  `monthlyCapFor`, the forecast from `forecastMonthCents` (the launch check's formula);
 *   per campaign   `foldCampaignSpend` over the campaign's hourly rows, for today and for its lifetime;
 *   AI             the generation ledger's month folds, the numbers `aiGate` / `creditGate` refuse on;
 *   reconcile      the last finished `ads_reconcile` job per connection, and the `external_change` rows since.
 *
 * Every read is org-filtered here: the service role bypasses RLS.
 */

/** Campaigns that exist at a platform and so may have spent: drafts and ones still in review have not. */
const REACHED_PLATFORM = ["paused", "launching", "live", "pausing", "archived", "failed"];
const PAGE = 1000;

interface CampaignRow { id: string; name: string; state: string; connection_id: string; daily_budget_cents: number | null; lifetime_cap_cents: number | null }

async function hourlyRows(admin: SupabaseClient, orgId: string, campaignId: string): Promise<SpendHourRow[]> {
  const out: SpendHourRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("ads_spend_hourly").select("campaign_id, hour, spend_cents, impressions, clicks, leads")
      .eq("org_id", orgId).eq("campaign_id", campaignId).order("hour").range(from, from + PAGE - 1);
    if (error) throw new Error(`ads_spend_hourly: ${error.message}`);
    const got = (data ?? []) as SpendHourRow[];
    out.push(...got.map((h) => ({ ...h, spend_cents: Number(h.spend_cents) })));
    if (got.length < PAGE) return out;
  }
}

/** The first instant of the carrier's today, in its zone, as `monthContext` reckons the month. */
function startOfToday(now: Date): number {
  const wc = wallClockInZone(now, DEFAULT_ORG_TIMEZONE);
  return wallClockToUtc({ ...wc, hour: 0, minute: 0, second: 0 }, DEFAULT_ORG_TIMEZONE);
}

export async function adsSpendView(admin: SupabaseClient, orgId: string, now: Date): Promise<AdsSpendView> {
  const month = monthContext(now);
  const { settings } = await settingsInForce(admin, orgId);

  const { data: conns, error: cErr } = await admin.from("ads_platform_connections").select("id, provider").eq("org_id", orgId);
  if (cErr) throw new Error(`ads_platform_connections: ${cErr.message}`);
  const connections = (conns ?? []) as Array<{ id: string; provider: string }>;
  const platformOfConn = new Map(connections.filter((c) => (AD_PLATFORMS as readonly string[]).includes(c.provider)).map((c) => [c.id, c.provider as AdPlatform]));
  const connected = AD_PLATFORMS.filter((p) => [...platformOfConn.values()].includes(p));

  const platforms = await Promise.all(connected.map(async (platform) => {
    const s = await platformSpend(admin, orgId, platform, month);
    const live = s.live_daily_by_campaign.reduce((a, [, d]) => a + d, 0);
    return {
      platform, month_to_date_cents: s.month_to_date_cents, cap_cents: monthlyCapFor(settings, platform),
      live_daily_cents: live, forecast_cents: forecastMonthCents(s.month_to_date_cents, live, month.days_left),
    };
  }));

  const { data: camps, error: kErr } = await admin
    .from("ads_campaigns").select("id, name, state, connection_id, daily_budget_cents, lifetime_cap_cents")
    .eq("org_id", orgId).in("state", REACHED_PLATFORM).order("created_at", { ascending: false }).limit(PAGE);
  if (kErr) throw new Error(`ads_campaigns: ${kErr.message}`);
  const todayStart = startOfToday(now);
  const campaigns: AdsSpendCampaign[] = [];
  for (const c of (camps ?? []) as CampaignRow[]) {
    const platform = platformOfConn.get(c.connection_id);
    if (!platform) continue;
    const rows = await hourlyRows(admin, orgId, c.id);
    const life = foldCampaignSpend(rows)[0];
    const today = foldCampaignSpend(rows.filter((r) => Date.parse(r.hour) >= todayStart))[0];
    campaigns.push({
      id: c.id, name: c.name, state: c.state, platform,
      daily_budget_cents: c.daily_budget_cents === null ? null : Number(c.daily_budget_cents),
      lifetime_cap_cents: c.lifetime_cap_cents === null ? null : Number(c.lifetime_cap_cents),
      today_spend_cents: today?.spend_cents ?? 0,
      lifetime_spend_cents: life?.spend_cents ?? 0,
      lifetime_leads: life?.leads ?? 0,
      lifetime_cost_per_lead_cents: life?.cost_per_lead_cents ?? null,
    });
  }

  const [tokens, credits, reconcile] = await Promise.all([
    anthropicTokensThisMonth(admin, orgId, now),
    higgsfieldCreditsThisMonth(admin, orgId, now),
    Promise.all(connections.filter((c) => c.provider === "meta").map((c) => reconcileStatus(admin, orgId, c, now))),
  ]);

  return {
    month: month.month, today: month.today, days_left: month.days_left, platforms, campaigns,
    ai: {
      tokens_used: tokens, tokens_budget: settings.budgets.anthropic_tokens_monthly,
      credits_used: credits, credits_budget: settings.budgets.higgsfield_credits_monthly,
    },
    reconcile,
  };
}

async function reconcileStatus(admin: SupabaseClient, orgId: string, c: { id: string; provider: string }, now: Date): Promise<AdsSpendReconcile> {
  const job = await lastDoneJobByKey(admin, orgId, "ads_reconcile", adsReconcileDedupKey(c.id));
  const ranAt = job?.started_at ?? null;
  let changes = 0;
  if (ranAt) {
    const { count, error } = await admin
      .from("ads_actions").select("id", { count: "exact", head: true })
      .eq("org_id", orgId).eq("connection_id", c.id).eq("kind", "external_change").gte("started_at", ranAt);
    if (error) throw new Error(`ads_actions: ${error.message}`);
    changes = count ?? 0;
  }
  return {
    connection_id: c.id, provider: c.provider, last_run_at: ranAt,
    late: ranAt === null || now.getTime() - Date.parse(ranAt) > 2 * ADS_RECONCILE_MS,
    changes_since: changes,
  };
}
