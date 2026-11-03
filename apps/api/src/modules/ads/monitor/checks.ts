import type { SupabaseClient } from "@supabase/supabase-js";
import { monitorChecks, monthContext, type AdPlatform, type LearningStage, type MonitorBreach, type MonitorCampaignFacts } from "@silvicom/shared";
import { sendAdsAlert } from "../alerts/adsAlerts.js";
import { platformSpend } from "../guard/budgetGuard.js";
import { applyCampaignEvent, CAMPAIGN_COLUMNS, type CampaignRow } from "../orchestrator/transitions.js";
import type { MetaGraph } from "../platforms/meta/graphClient.js";
import { metaAdapter } from "../platforms/meta/metaAdapter.js";
import { graphForConnection, type RegistryDeps } from "../platforms/registry.js";
import { settingsInForce } from "../settings/settingsVersions.js";
import { localOf, windowDays } from "./localHours.js";

/**
 * The monitor's checks (ADS-AGENT-BUILD-WORKFLOW.md B5b), run by the `ads_insights` job right after its pull.
 * Gathers what `monitorChecks` (packages/shared, pure) needs, asks it, and applies its answer — nothing here
 * decides a threshold.
 *
 * ── A PAUSE GOES THROUGH THE MACHINE, NEVER TO THE PLATFORM FROM HERE ────────────────────────────
 * A breach is the campaign event `pause` by the agent (`applyCampaignEvent`, the one writer of a campaign's
 * state), ledgered in `ads_actions` with the rule, what was measured and the setting it passed (plan §4b:
 * "each pause ledgered with its rule"). The campaign is then `pausing`, and the orchestrator's next tick runs
 * the pause at Meta through the adapter's safe half — the same path as Pause and the kill switch, with its
 * retries and its stuck-pause alert (`pauseAlerts.ts`). This file never calls an adapter's write.
 *
 * ── WHAT IS READ, AND FROM WHERE ─────────────────────────────────────────────────────────────────
 *   · today and lifetime spend and leads: our `ads_spend_hourly` (the pull just refreshed it), today being
 *     the ACCOUNT's local day — Meta's daily budget is spent on the account's clock;
 *   · the month: the guard's own fold (`platformSpend`) and the account's figure from Meta, larger wins,
 *     on the carrier's month (`monthContext`), as the guard reads it;
 *   · learning stage and 7-day frequency: Meta, per ad set, NOW (`learning_stage_info`; ad-set insights).
 * A read that fails is reported and the job fails; the checks still run on what was read, with a stage
 * that could not be read held as `unknown` (caps only). A failed check never un-pauses anything.
 *
 * ── NOT HERE ─────────────────────────────────────────────────────────────────────────────────────
 * `pause_when_filled` needs the opening's headcount, which is recruiting's (D-AD17): it joins with the seam
 * that brings it, not by reading recruiting's tables from ads. Meta's "Creative fatigue" delivery flag is not
 * in any Marketing API page we found (2026-11-03); the 7-day frequency is the fatigue signal the settings
 * hold, and the plan's "CPL rising 2× its concept's history" waits for F1's per-concept fold.
 */

const DELIVERING = ["launching", "live"] as const;
const AGENT = { kind: "agent" as const, name: "monitor" };
const FATIGUE_DAYS = 7;

export interface ChecksDeps extends RegistryDeps {
  admin: SupabaseClient;
  now: () => Date;
}

export interface ChecksResult {
  checked: number;
  paused: Array<{ campaign_id: string; rule: MonitorBreach["rule"] }>;
  failures: Array<{ campaign_id?: string; reason: string }>;
}

interface Totals { today: number; lifetime: number; leads: number }

/** One campaign's spend from our table: today on the account's clock, and lifetime. Paged, never capped. */
async function totals(admin: SupabaseClient, orgId: string, campaignId: string, zone: string, today: string): Promise<Totals> {
  const t: Totals = { today: 0, lifetime: 0, leads: 0 };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("ads_spend_hourly").select("hour, spend_cents, leads")
      .eq("org_id", orgId).eq("campaign_id", campaignId).order("hour").range(from, from + 999);
    if (error) throw new Error(`ads_spend_hourly: ${error.message}`);
    const rows = (data ?? []) as Array<{ hour: string; spend_cents: number; leads: number }>;
    for (const r of rows) {
      const cents = Number(r.spend_cents);
      t.lifetime += cents;
      t.leads += Number(r.leads);
      if (localOf(new Date(r.hour), zone).day === today) t.today += cents;
    }
    if (rows.length < 1000) return t;
  }
}

/** The ad set's learning stage and 7-day frequency, as Meta says now. */
async function delivery(graph: MetaGraph, adsetId: string, days: string[]): Promise<{ learning: LearningStage; frequency: number | null; failed: string | null }> {
  const stage = await graph.get<{ learning_stage_info?: { status?: unknown } }>(adsetId, { fields: "learning_stage_info" });
  const learning: LearningStage = !stage.ok ? "unknown" : stage.data.learning_stage_info?.status === "LEARNING" ? "learning" : "not_learning";
  const ins = await graph.get<{ data?: Array<{ frequency?: unknown }> }>(`${adsetId}/insights`, {
    fields: "frequency,reach,impressions", time_range: JSON.stringify({ since: days[0], until: days[days.length - 1] }),
  });
  const raw = ins.ok ? ins.data.data?.[0]?.frequency : undefined;
  const frequency = raw === undefined ? null : Number(raw);
  const failed = !stage.ok ? `stage:${stage.error.error_code}` : !ins.ok ? `frequency:${ins.error.error_code}` : null;
  return { learning, frequency: frequency !== null && Number.isFinite(frequency) ? frequency : null, failed };
}

function alertText(b: MonitorBreach): { title: string; body: string } {
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  if (b.rule === "monthly_cap") return { title: "Ads paused: the monthly cap was passed", body: `This month's spend on the channel is ${usd(b.measured)}, past its ${usd(b.threshold)} cap. Every running ad on it is being paused.` };
  if (b.rule === "daily_cap") return { title: "An ad was paused at its daily cap", body: `Today it spent ${usd(b.measured)} against a ${usd(b.threshold)} daily budget. It stays paused until a person resumes it.` };
  return { title: "An ad was paused: spend with no leads", body: `It has spent ${usd(b.measured)} without a lead, past the ${usd(b.threshold)} set on Settings › Ads control.` };
}

export async function checkConnection(deps: ChecksDeps, orgId: string, connectionId: string, zone: string): Promise<ChecksResult> {
  const result: ChecksResult = { checked: 0, paused: [], failures: [] };
  const { data: conn, error: cErr } = await deps.admin
    .from("ads_platform_connections").select("id, org_id, provider, is_sandbox, token_sealed, account_ref, status")
    .eq("org_id", orgId).eq("id", connectionId).maybeSingle();
  if (cErr) throw new Error(`ads_platform_connections: ${cErr.message}`);
  const c = conn as { id: string; org_id: string; provider: string; is_sandbox: boolean; token_sealed: string | null; account_ref: string | null } | null;
  if (!c || (c.provider !== "meta" && c.provider !== "simulator") || !c.account_ref) return result;
  const platform: AdPlatform = c.provider === "simulator" ? "simulator" : "meta";

  const { data: camps, error: kErr } = await deps.admin
    .from("ads_campaigns").select(CAMPAIGN_COLUMNS).eq("org_id", orgId).eq("connection_id", connectionId).in("state", [...DELIVERING]);
  if (kErr) throw new Error(`ads_campaigns: ${kErr.message}`);
  const campaigns = (camps ?? []) as CampaignRow[];
  if (campaigns.length === 0) return result;

  const opened = await graphForConnection(deps, c);
  const graph = opened.ok ? opened.graph : null;
  if (!opened.ok) result.failures.push({ reason: `graph:${opened.error_code}` });
  const now = deps.now();
  const month = monthContext(now);
  const inForce = await settingsInForce(deps.admin, orgId);
  const fold = await platformSpend(deps.admin, orgId, platform, month);
  const platformMonth = graph ? await metaAdapter({ graph, accountId: c.account_ref }).safe.readSpendCents({ since: month.since_day, until: month.today }) : null;
  if (graph && platformMonth === null) result.failures.push({ reason: "month_spend_unknown" });

  const days = windowDays(now, zone, FATIGUE_DAYS);
  const today = days[days.length - 1]!;
  const facts: MonitorCampaignFacts[] = [];
  for (const k of campaigns) {
    const t = await totals(deps.admin, orgId, k.id, zone, today);
    const adset = typeof k.platform_refs?.meta_adset_id === "string" ? k.platform_refs.meta_adset_id : null;
    const d = graph && adset ? await delivery(graph, adset, days) : { learning: "unknown" as const, frequency: null, failed: adset ? null : "no_adset" };
    if (d.failed) result.failures.push({ campaign_id: k.id, reason: `delivery:${d.failed}` });
    facts.push({
      campaign_id: k.id, state: k.state, daily_budget_cents: k.daily_budget_cents === null ? null : Number(k.daily_budget_cents),
      today_spend_cents: t.today, lifetime_spend_cents: t.lifetime, lifetime_leads: t.leads, learning: d.learning, frequency_7d: d.frequency,
    });
  }
  result.checked = facts.length;

  const byId = new Map(campaigns.map((k) => [k.id, k]));
  for (const b of monitorChecks(inForce.settings, { platform, month_spend_cents: fold.month_to_date_cents, platform_month_spend_cents: platformMonth, campaigns: facts })) {
    const moved = await applyCampaignEvent(deps.admin, byId.get(b.campaign_id)!, {
      event: "pause", actor: AGENT, cause: `auto-pause ${b.rule}: measured ${b.measured} > ${b.threshold} (settings v${inForce.version ?? "unset"})`,
    }, now.toISOString());
    if (moved.kind !== "moved") continue;
    result.paused.push({ campaign_id: b.campaign_id, rule: b.rule });
    if (!b.alert) continue;
    await sendAdsAlert(deps.admin, orgId, {
      category: b.alert, ...alertText(b), severity: b.alert === "ads_overspend" ? "critical" : "warning",
      entityType: "ads_campaign", entityId: b.campaign_id, dedupeKey: `${b.alert}:${b.campaign_id}:${b.rule}:${today}`,
    });
  }
  return result;
}
