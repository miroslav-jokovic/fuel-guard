import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CAMPAIGN_STATES_AWAITING_PERSON, OVERVIEW_LEDGER_PAGE, RUNNING_CAMPAIGN_STATES,
  foldConnections, foldNeedsYou, ledgerCursor, ledgerEntry, monthContext, pausedReading,
  type AdsOverviewCampaign, type AdsOverviewView, type CampaignState, type HealthConnectionRow, type LedgerRow, type TransitionRow,
} from "@silvicom/shared";
import { settingsInForce } from "../settings/settingsVersions.js";
import { adsSpendView } from "../spend/spendView.js";

/**
 * `GET /api/ads/overview` (ADS-PLATFORM-V2-PLAN §0.3 step 3; V6 "Overview"): the reads behind `AdsOverviewView`
 * (shared `adsOverview.ts` says what each part is and is not). A read only — no write, no platform call.
 *
 * Spend and leads come from `adsSpendView`, not from a second fold here: the Overview's month spend IS the guard's
 * platform month, so the two pages and the launch check cannot disagree. Every query names the org: the service
 * role bypasses RLS.
 */
const PAGE = 1000;

/** How many succeeded transitions decide a paused campaign: the agent's `paused` and the move that asked for it. */
const PAUSED_ROWS = 2;

interface CampaignRow { id: string; name: string; state: CampaignState; state_changed_at: string; connection_id: string; daily_budget_cents: number | null }

/**
 * The ledger page. `before` is a parsed cursor (`parseLedgerCursor`); its timestamp is quoted into the filter, and it
 * reaches here only after that parser accepted it, so nothing a caller typed is spliced in unchecked.
 */
async function ledgerPage(admin: SupabaseClient, orgId: string, before: { started_at: string; id: string } | null): Promise<LedgerRow[]> {
  let q = admin.from("ads_actions")
    .select("id, kind, status, actor_kind, actor_name, campaign_id, cause, error_code, request, started_at, finished_at")
    .eq("org_id", orgId);
  if (before) q = q.or(`started_at.lt."${before.started_at}",and(started_at.eq."${before.started_at}",id.lt.${before.id})`);
  const { data, error } = await q.order("started_at", { ascending: false }).order("id", { ascending: false }).limit(OVERVIEW_LEDGER_PAGE + 1);
  if (error) throw new Error(`ads_actions: ${error.message}`);
  return (data ?? []) as LedgerRow[];
}

async function pausedTransitions(admin: SupabaseClient, orgId: string, campaignId: string): Promise<TransitionRow[]> {
  const { data, error } = await admin.from("ads_actions")
    .select("request, actor_kind, actor_name, cause, started_at")
    .eq("org_id", orgId).eq("campaign_id", campaignId).eq("kind", "transition").eq("status", "succeeded")
    .order("started_at", { ascending: false }).limit(PAUSED_ROWS);
  if (error) throw new Error(`ads_actions: ${error.message}`);
  return ((data ?? []) as Array<{ request: { event?: unknown } | null; actor_kind: string; actor_name: string; cause: string | null; started_at: string }>)
    .map((r) => ({ event: typeof r.request?.event === "string" ? r.request.event : null, actor_kind: r.actor_kind, actor_name: r.actor_name, cause: r.cause, started_at: r.started_at }));
}

async function readyAds(admin: SupabaseClient, orgId: string, campaignIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const id of campaignIds) {
    const { count, error } = await admin.from("ads_creatives").select("id", { count: "exact", head: true })
      .eq("org_id", orgId).eq("campaign_id", id).eq("state", "ready");
    if (error) throw new Error(`ads_creatives: ${error.message}`);
    out.set(id, count ?? 0);
  }
  return out;
}

export async function adsOverviewView(
  admin: SupabaseClient, orgId: string, now: Date, before: { started_at: string; id: string } | null = null,
): Promise<AdsOverviewView> {
  const month = monthContext(now);
  const [settings, spend, conns, camps, ledgerRows] = await Promise.all([
    settingsInForce(admin, orgId),
    adsSpendView(admin, orgId, now),
    admin.from("ads_platform_connections").select("id, provider, is_sandbox, status, last_test_at, last_error, last_test").eq("org_id", orgId).order("created_at"),
    admin.from("ads_campaigns").select("id, name, state, state_changed_at, connection_id, daily_budget_cents")
      .eq("org_id", orgId).neq("state", "archived").order("created_at", { ascending: false }).limit(PAGE),
    ledgerPage(admin, orgId, before),
  ]);
  if (conns.error) throw new Error(`ads_platform_connections: ${conns.error.message}`);
  if (camps.error) throw new Error(`ads_campaigns: ${camps.error.message}`);
  const rows = (camps.data ?? []) as CampaignRow[];
  // A full page would hide a campaign from "Needs you" without a word; refuse rather than show a short list.
  if (rows.length >= PAGE) throw new Error(`ads_campaigns: ${PAGE}+ open campaigns — the Overview reads them in one page`);

  const spendOf = new Map(spend.campaigns.map((c) => [c.id, c]));
  const awaiting = new Set<CampaignState>(CAMPAIGN_STATES_AWAITING_PERSON);
  const paused = rows.filter((c) => c.state === "paused" && awaiting.has("paused"));
  const [pausedReads, ready] = await Promise.all([
    Promise.all(paused.map(async (c) => [c.id, pausedReading(await pausedTransitions(admin, orgId, c.id))] as const)),
    readyAds(admin, orgId, rows.filter((c) => c.state === "review").map((c) => c.id)),
  ]);

  const campaigns: AdsOverviewCampaign[] = rows.map((c) => {
    const s = spendOf.get(c.id);
    return {
      id: c.id, name: c.name, state: c.state, state_changed_at: c.state_changed_at, platform: s?.platform ?? null,
      daily_budget_cents: c.daily_budget_cents === null ? null : Number(c.daily_budget_cents),
      month_spend_cents: s?.month_spend_cents ?? 0, month_leads: s?.month_leads ?? 0,
    };
  });
  const monthSpend = spend.platforms.reduce((n, p) => n + p.month_to_date_cents, 0);
  // Leads from every campaign with hours this month, archived ones included (`spend.campaigns` lists them).
  const monthLeads = spend.campaigns.reduce((n, c) => n + c.month_leads, 0);
  const kill = { on: settings.kill_switch, reason: settings.kill_reason };

  const page = ledgerRows.slice(0, OVERVIEW_LEDGER_PAGE);
  const names = new Map(rows.map((c) => [c.id, c.name]));
  for (const c of spend.campaigns) names.set(c.id, c.name);
  const missing = [...new Set(page.map((r) => r.campaign_id).filter((id): id is string => id !== null && !names.has(id)))];
  if (missing.length > 0) {
    const { data, error } = await admin.from("ads_campaigns").select("id, name").eq("org_id", orgId).in("id", missing);
    if (error) throw new Error(`ads_campaigns: ${error.message}`);
    for (const c of (data ?? []) as Array<{ id: string; name: string }>) names.set(c.id, c.name);
  }
  const entries = page.map((r) => ledgerEntry(r, names));

  return {
    checked_at: now.toISOString(),
    month: month.month,
    kill_switch: kill,
    totals: {
      running: rows.filter((c) => RUNNING_CAMPAIGN_STATES.includes(c.state)).length,
      month_spend_cents: monthSpend,
      month_leads: monthLeads,
      month_cost_per_lead_cents: monthLeads === 0 ? null : Math.round(monthSpend / monthLeads),
    },
    campaigns,
    needs_you: foldNeedsYou({
      kill_switch: kill,
      caps: spend.platforms.map((p) => ({ platform: p.platform, cap_cents: p.cap_cents })),
      connections: foldConnections((conns.data ?? []) as HealthConnectionRow[], now),
      campaigns: rows,
      ready_ads: ready,
      paused: new Map(pausedReads),
    }),
    ledger: { entries, next_before: ledgerRows.length > OVERVIEW_LEDGER_PAGE ? ledgerCursor(page.at(-1)!) : null },
  };
}
