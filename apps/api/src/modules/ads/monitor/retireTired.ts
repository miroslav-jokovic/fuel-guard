import type { SupabaseClient } from "@supabase/supabase-js";
import { fatigueVerdict, type AdHour, type AdsCreativeRefresh, type FatigueVerdict } from "@silvicom/shared";
import { settingsInForce } from "../settings/settingsVersions.js";
import { completeAction, startAction } from "../actions/actionLedger.js";
import { sendAdsAlert } from "../alerts/adsAlerts.js";
import { adRefsOf, type AdRef } from "./adInsightsPull.js";
import { adapterForConnection, type RegistryDeps } from "../platforms/registry.js";
import type { PlatformCampaignRef } from "../platforms/adapter.js";

/**
 * Retiring a tired ad (ADS-CREATIVE-QUALITY-PLAN CQ9b; D-AD23), run by the hourly `ads_insights` job after the pull
 * and the checks: for every LIVE campaign on the connection, every ad the publisher recorded is judged by
 * `fatigueVerdict` (shared, pure) over its own hours in `ads_ad_spend_hourly` (0577), and a `retire` verdict — with
 * the carrier's `creative_refresh.retire` switch ON — pauses that one ad at the platform through the adapter's safe
 * half (`pauseAd`), ledgers it (`ads_actions` kind `retire_ad`, 0581) and rings `ads_creative_retired`. The campaign
 * and its other ads keep delivering; the frequency pause (B5b) still pauses the whole campaign when the SET is tired.
 *
 * ── ONCE PER AD, AND THE SWITCH DECIDES NOTHING BUT THE CALL ────────────────────────────────────
 * The ledger's unique `idempotency_key` (`retire_ad:<campaign>:<meta ad id>`) is the "once": a second run finds
 * `duplicate` and moves on, so a crash after the pause but before the row's completion is settled by the next run
 * asking Meta again (pausing a paused ad succeeds). With the switch OFF the verdicts are still computed and returned
 * — the daily brief and the drawer can say "P2 would be retired" — and nothing is called or written. That is the
 * alert-only first weeks the owner chose for every other new rule (Q-AD51).
 *
 * ── WHAT ENTERS NEXT ─────────────────────────────────────────────────────────────────────────────
 * Nothing here. Entering the next concept on a live campaign is Q-AD68 (plan §5): compose runs only in `composing`
 * and the publisher makes a whole campaign. The bell says a concept is due; a person acts until Q-AD68 is built.
 */

export interface RetireDeps extends RegistryDeps {
  admin: SupabaseClient;
  now: () => Date;
}

export interface AdVerdict {
  campaign_id: string;
  creative_id: string;
  language: AdRef["language"];
  meta_ad_id: string;
  verdict: FatigueVerdict;
  /** What was done about a `retire`: paused at the platform, already retired (duplicate), refused by the platform, or not asked (switch off). */
  acted: "retired" | "already" | "refused" | "switch_off" | "not_tired";
  error_code?: string;
}

export interface RetireResult {
  campaigns: number;
  ads: number;
  verdicts: AdVerdict[];
  failures: Array<{ campaign_id?: string; reason: string }>;
}

const PAGE = 1000;
const WINDOW_DAYS = 28;

export async function retireTiredAds(deps: RetireDeps, orgId: string, connectionId: string, override?: AdsCreativeRefresh): Promise<RetireResult> {
  const result: RetireResult = { campaigns: 0, ads: 0, verdicts: [], failures: [] };
  // The carrier's settings in force now (a test may hand the group in directly).
  const settings = override ?? (await settingsInForce(deps.admin, orgId)).settings.creative_refresh;
  const { data, error } = await deps.admin
    .from("ads_campaigns").select("id, platform_refs, connection_id, state, state_changed_at, org_id, daily_budget_cents, lifetime_cap_cents")
    .eq("org_id", orgId).eq("connection_id", connectionId).eq("state", "live").order("id").limit(PAGE);
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  const campaigns = (data ?? []) as Array<{ id: string; platform_refs: Record<string, unknown> | null }>;
  if (campaigns.length === 0) return result;

  const now = deps.now();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  let adapter: Awaited<ReturnType<typeof adapterForConnection>> | undefined;

  for (const c of campaigns) {
    const ads = adRefsOf(c.platform_refs);
    if (ads.length === 0) continue;
    result.campaigns += 1;
    const hoursByAd = await adHours(deps.admin, orgId, c.id, since);
    for (const ad of ads) {
      result.ads += 1;
      const verdict = fatigueVerdict(settings, { hours: hoursByAd.get(ad.meta_ad_id) ?? [], now });
      const line: AdVerdict = { campaign_id: c.id, creative_id: ad.creative_id, language: ad.language, meta_ad_id: ad.meta_ad_id, verdict, acted: "not_tired" };
      result.verdicts.push(line);
      if (verdict.kind !== "retire") continue;
      if (!settings.retire) { line.acted = "switch_off"; continue; }

      // The ledger row first: a duplicate means an earlier run already retired this ad (or is doing so now).
      const at = now.toISOString();
      const started = await startAction(deps.admin, {
        org_id: orgId, campaign_id: c.id, creative_id: ad.creative_id, connection_id: connectionId, kind: "retire_ad", actor_kind: "agent", actor_id: null, actor_name: "monitor",
        cause: `click-through fell ${verdict.drop_pct} % against the ad's first week (${verdict.age_days} days old)`,
        idempotency_key: `retire_ad:${c.id}:${ad.meta_ad_id}`,
        request: { ad: ad.meta_ad_id, first_ctr: verdict.first_ctr, last_ctr: verdict.last_ctr, drop_pct: verdict.drop_pct, threshold_pct: settings.ctr_drop_pct },
      }, at);
      if (started === "duplicate") { line.acted = "already"; continue; }
      if (!("id" in started)) { line.acted = "refused"; line.error_code = `fence:${started.refusedBy}`; result.failures.push({ campaign_id: c.id, reason: `retire:${started.refusedBy}` }); continue; }

      adapter ??= await adapterForConnection(deps, orgId, connectionId);
      if (!adapter) {
        await completeAction(deps.admin, orgId, started.id, { status: "failed", error_code: "no_adapter", at: deps.now().toISOString() });
        line.acted = "refused"; line.error_code = "no_adapter"; result.failures.push({ campaign_id: c.id, reason: "retire:no_adapter" });
        continue;
      }
      const ref: PlatformCampaignRef = { campaign_id: c.id, platform: adapter.platform, platform_refs: c.platform_refs ?? {} };
      const out = await adapter.adapter.safe.pauseAd({ campaign: ref, ad: ad.meta_ad_id, idempotency_key: `retire_ad:${c.id}:${ad.meta_ad_id}` });
      await completeAction(deps.admin, orgId, started.id, { status: out.ok ? "succeeded" : "failed", response: out.ok ? out.response : out.response, error_code: out.ok ? null : out.error_code, at: deps.now().toISOString() });
      if (!out.ok) { line.acted = "refused"; line.error_code = out.error_code; result.failures.push({ campaign_id: c.id, reason: `retire:${out.error_code}` }); continue; }
      line.acted = "retired";
      await markRetired(deps.admin, orgId, ad.creative_id, at);
      await sendAdsAlert(deps.admin, orgId, {
        category: "ads_creative_retired", severity: "warning", entityType: "ads_creative", entityId: ad.creative_id,
        title: "An ad was retired: it had tired",
        body: `Its click-through fell ${verdict.drop_pct} % against its own first week (${(verdict.first_ctr * 100).toFixed(2)} % → ${(verdict.last_ctr * 100).toFixed(2)} %), so the ${ad.language.toUpperCase()} ad was paused at the platform. The campaign keeps running; the next concept is due.`,
        dedupeKey: `ads_creative_retired:${c.id}:${ad.meta_ad_id}`,
      });
    }
  }
  return result;
}

/** The campaign's per-ad hours in the window, grouped by Meta ad id, paged. */
async function adHours(admin: SupabaseClient, orgId: string, campaignId: string, since: string): Promise<Map<string, AdHour[]>> {
  const out = new Map<string, AdHour[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("ads_ad_spend_hourly").select("meta_ad_id, hour, impressions, clicks")
      .eq("org_id", orgId).eq("campaign_id", campaignId).gte("hour", since)
      .order("meta_ad_id").order("hour").range(from, from + PAGE - 1);
    if (error) throw new Error(`ads_ad_spend_hourly: ${error.message}`);
    const rows = (data ?? []) as Array<{ meta_ad_id: string; hour: string; impressions: unknown; clicks: unknown }>;
    for (const r of rows) {
      const list = out.get(r.meta_ad_id) ?? [];
      list.push({ hour: r.hour, impressions: Number(r.impressions), clicks: Number(r.clicks) });
      out.set(r.meta_ad_id, list);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * The creative's `platform_status` says what the platform is doing with it: `retired` here. Its `state` (the review
 * lifecycle, 0537) is untouched — a retired ad was approved and is still the record of what ran.
 */
async function markRetired(admin: SupabaseClient, orgId: string, creativeId: string, at: string): Promise<void> {
  const { error } = await admin.from("ads_creatives").update({ platform_status: "retired", updated_at: at }).eq("org_id", orgId).eq("id", creativeId);
  if (error) throw new Error(`ads_creatives ${creativeId}: ${error.message}`);
}
