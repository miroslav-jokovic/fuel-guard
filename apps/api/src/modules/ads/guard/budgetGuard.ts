import type { SupabaseClient } from "@supabase/supabase-js";
import { AD_PLATFORMS, checkSpend, monthContext, monthToDateByPlatform, type AdArea, type AdPlatform, type SpendHourRow } from "@silvicom/shared";
import { completeAction, recordFinished, startAction, type ActionRow } from "../actions/actionLedger.js";
import type { PlatformCampaignRef, PlatformOutcome, PlatformSafe, PlatformSpend } from "../platforms/adapter.js";
import { settingsInForce } from "../settings/settingsVersions.js";
import { findCoveringApproval } from "./approvals.js";

/**
 * The budget guard (ADS-AGENT-BUILD-WORKFLOW.md A5; D-AD3): the ONLY path to a platform's spend
 * methods. `budgetGuard.boundary.test.ts` fails if any other file names `PlatformSpend` or calls one
 * of its methods.
 *
 * Before any launch or raise, in one pass, every refusal collected (the screen says all of what is
 * wrong at once): the campaign and its platform; the settings in force (kill switch, caps — unset
 * refuses); this platform's month-to-date spend and the other live campaigns' daily budgets, for the
 * forecast to month end (`checkSpend`); the account's own limit read from the platform NOW; and a
 * standing, unused approval covering the amounts (`approvals.ts`). A refusal is an `ads_actions`
 * row (`refused`) — a cap nobody can see refusing is a cap nobody can trust — and no vendor call.
 *
 * Then `started` before the call, the call, one completion. The idempotency key is the approval's:
 * one yes, one act, so a delivered-twice job finds the first row and does not launch twice.
 *
 * What this does NOT do: move the campaign's state (`launching` → `live`) — that is the orchestrator's
 * (A6), which calls this inside its step; and pause or lower, which need no guard (the safe
 * direction, `isSafeDirection`), and go through `PlatformSafe` (B3).
 */

export interface GuardDeps {
  admin: SupabaseClient;
  now: () => Date;
  safe: PlatformSafe;
  spend: PlatformSpend;
}

export type GuardActor = { kind: "person"; id: string; name: string } | { kind: "agent"; name: string };

export interface SpendAsk {
  orgId: string;
  campaignId: string;
  act: "launch" | "raise_budget";
  daily_cents: number;
  lifetime_cents: number;
  actor: GuardActor;
}

export type GuardRefusal = string;

export type GuardOutcome =
  | { kind: "succeeded"; action_id: string }
  | { kind: "failed"; action_id: string; error_code: string }
  | { kind: "refused"; action_id: string | null; refusals: GuardRefusal[] }
  /** This approval already started an act: the first row answers, nothing is sent again. */
  | { kind: "already_attempted" };

interface CampaignRow {
  id: string;
  connection_id: string;
  state: string;
  daily_budget_cents: number | null;
  platform_refs: Record<string, unknown>;
}

/** Live for spending: anything the platform may still be delivering. */
const SPENDING_STATES = ["launching", "live", "pausing"];

export async function guardedSpend(deps: GuardDeps, ask: SpendAsk): Promise<GuardOutcome> {
  const { admin } = deps;
  const now = deps.now();
  const at = now.toISOString();
  const target = await loadTarget(admin, ask.orgId, ask.campaignId);
  if (!target) return { kind: "refused", action_id: null, refusals: ["campaign_not_found"] };
  const { campaign, platform } = target;

  const inForce = await settingsInForce(admin, ask.orgId);
  const month = monthContext(now);
  const fleet = await platformSpend(admin, ask.orgId, platform, month);
  const verdict = checkSpend(inForce.settings, {
    act: ask.act,
    platform,
    daily_cents: ask.daily_cents,
    lifetime_cents: ask.lifetime_cents,
    current_daily_cents: campaign.daily_budget_cents,
    month_to_date_cents: fleet.month_to_date_cents,
    other_live_daily_cents: fleet.live_daily_by_campaign.filter(([id]) => id !== campaign.id).reduce((s, [, d]) => s + d, 0),
    days_left_in_month: month.days_left,
    account_limit_cents: await deps.safe.readAccountLimitCents(),
    kill_switch: inForce.kill_switch,
  });
  const approval = await findCoveringApproval(admin, ask.orgId, inForce.settings, {
    campaignId: campaign.id, kind: ask.act, daily_cents: ask.daily_cents, lifetime_cents: ask.lifetime_cents,
  });

  const request = { daily_budget_cents: ask.daily_cents, lifetime_cap_cents: ask.lifetime_cents, forecast_cents: verdict.forecast_cents, cap_cents: verdict.cap_cents, settings_version: inForce.version };
  const row: ActionRow = {
    org_id: ask.orgId,
    campaign_id: campaign.id,
    connection_id: campaign.connection_id,
    kind: ask.act,
    ...actorColumns(ask.actor),
    request,
  };
  const refusals = [...(verdict.ok ? [] : verdict.refusals), ...(approval.ok ? [] : [approval.refusal])];
  if (refusals.length > 0 || !approval.ok) return refuse(admin, row, refusals, at);

  const started = await startAction(admin, { ...row, approval_id: approval.approval_id, idempotency_key: `${ask.act}:${approval.approval_id}` }, at);
  if (started === "duplicate") return { kind: "already_attempted" };
  if ("refusedBy" in started) return refuse(admin, row, [started.refusedBy], at);

  const ref: PlatformCampaignRef = { campaign_id: campaign.id, platform, platform_refs: campaign.platform_refs };
  const call = { campaign: ref, daily_budget_cents: ask.daily_cents, lifetime_cap_cents: ask.lifetime_cents, idempotency_key: `${ask.act}:${approval.approval_id}` };
  const outcome = await callPlatform(() => (ask.act === "launch" ? deps.spend.launch(call) : deps.spend.raiseDailyBudget(call)));
  return finish(deps, ask.orgId, started.id, outcome);
}

export interface AreaAsk {
  orgId: string;
  campaignId: string;
  area: AdArea;
  actor: GuardActor;
}

/** Widening who sees an ad needs a standing approval of `change_area`; it moves no budget, so no cap. */
export async function guardedAreaChange(deps: GuardDeps, ask: AreaAsk): Promise<GuardOutcome> {
  const { admin } = deps;
  const at = deps.now().toISOString();
  const target = await loadTarget(admin, ask.orgId, ask.campaignId);
  if (!target) return { kind: "refused", action_id: null, refusals: ["campaign_not_found"] };
  const { campaign, platform } = target;
  const inForce = await settingsInForce(admin, ask.orgId);
  const approval = await findCoveringApproval(admin, ask.orgId, inForce.settings, {
    campaignId: campaign.id, kind: "change_area", daily_cents: null, lifetime_cents: null,
  });
  const row: ActionRow = { org_id: ask.orgId, campaign_id: campaign.id, connection_id: campaign.connection_id, kind: "change_area", ...actorColumns(ask.actor), request: { area: ask.area } };
  if (!approval.ok) return refuse(admin, row, [approval.refusal], at);
  const key = `change_area:${approval.approval_id}`;
  const started = await startAction(admin, { ...row, approval_id: approval.approval_id, idempotency_key: key }, at);
  if (started === "duplicate") return { kind: "already_attempted" };
  if ("refusedBy" in started) return refuse(admin, row, [started.refusedBy], at);
  const ref: PlatformCampaignRef = { campaign_id: campaign.id, platform, platform_refs: campaign.platform_refs };
  return finish(deps, ask.orgId, started.id, await callPlatform(() => deps.spend.changeArea({ campaign: ref, area: ask.area, idempotency_key: key })));
}

// ── the reads ───────────────────────────────────────────────────────────────────────────────────

async function loadTarget(admin: SupabaseClient, orgId: string, campaignId: string): Promise<{ campaign: CampaignRow; platform: AdPlatform } | null> {
  const { data, error } = await admin
    .from("ads_campaigns").select("id, connection_id, state, daily_budget_cents, platform_refs")
    .eq("org_id", orgId).eq("id", campaignId).maybeSingle();
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  const campaign = data as CampaignRow | null;
  if (!campaign) return null;
  // Two reads, not an embed: a composite (org_id, id) FK is ambiguous to PostgREST (PGRST201).
  const { data: conn, error: cErr } = await admin
    .from("ads_platform_connections").select("provider").eq("org_id", orgId).eq("id", campaign.connection_id).maybeSingle();
  if (cErr) throw new Error(`ads_platform_connections: ${cErr.message}`);
  const provider = (conn as { provider: string } | null)?.provider;
  if (!provider || !(AD_PLATFORMS as readonly string[]).includes(provider)) return null;
  return { campaign, platform: provider as AdPlatform };
}

/**
 * This platform's month: spend so far, and the daily budget of every campaign that may still spend.
 * One spend read per campaign — at most one row per hour, so ≤ 745 rows a month, under PostgREST's
 * 1,000-row cap by construction (a page cap would under-count spend, and under-counted spend is the
 * one error this file exists to prevent, so a full page throws instead of being trusted).
 */
async function platformSpend(admin: SupabaseClient, orgId: string, platform: AdPlatform, month: { start: string; end: string }) {
  const { data: conns, error: cErr } = await admin.from("ads_platform_connections").select("id").eq("org_id", orgId).eq("provider", platform);
  if (cErr) throw new Error(`ads_platform_connections: ${cErr.message}`);
  const connIds = ((conns ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (connIds.length === 0) return { month_to_date_cents: 0, live_daily_by_campaign: [] as Array<[string, number]> };
  const { data: camps, error: kErr } = await admin
    .from("ads_campaigns").select("id, state, daily_budget_cents").eq("org_id", orgId).in("connection_id", connIds);
  if (kErr) throw new Error(`ads_campaigns: ${kErr.message}`);
  const campaigns = (camps ?? []) as Array<{ id: string; state: string; daily_budget_cents: number | null }>;
  const rows: SpendHourRow[] = [];
  for (const c of campaigns) {
    const { data: hours, error: hErr } = await admin
      .from("ads_spend_hourly").select("campaign_id, hour, spend_cents, impressions, clicks, leads")
      .eq("org_id", orgId).eq("campaign_id", c.id).gte("hour", month.start).lt("hour", month.end).limit(1000);
    if (hErr) throw new Error(`ads_spend_hourly: ${hErr.message}`);
    const got = (hours ?? []) as SpendHourRow[];
    if (got.length >= 1000) throw new Error(`ads_spend_hourly: campaign ${c.id} returned a full page for one month`);
    rows.push(...got.map((h) => ({ ...h, spend_cents: Number(h.spend_cents) })));
  }
  const platformOf = new Map(campaigns.map((c) => [c.id, platform] as const));
  const mtd = monthToDateByPlatform(rows, platformOf, month).by_platform[platform] ?? 0;
  const live = campaigns
    .filter((c) => SPENDING_STATES.includes(c.state) && c.daily_budget_cents !== null)
    .map((c) => [c.id, Number(c.daily_budget_cents)] as [string, number]);
  return { month_to_date_cents: mtd, live_daily_by_campaign: live };
}

// ── the writes ──────────────────────────────────────────────────────────────────────────────────

function actorColumns(actor: GuardActor) {
  return actor.kind === "person"
    ? { actor_kind: "person" as const, actor_id: actor.id, actor_name: actor.name }
    : { actor_kind: "agent" as const, actor_id: null, actor_name: actor.name };
}

async function refuse(admin: SupabaseClient, row: ActionRow, refusals: GuardRefusal[], at: string): Promise<GuardOutcome> {
  const { id } = await recordFinished(admin, row, { status: "refused", error_code: refusals[0] ?? "refused", response: { refusals }, at });
  return { kind: "refused", action_id: id, refusals };
}

/** A thrown adapter error is a failed act, recorded — never a `started` row left behind by this code. */
async function callPlatform(call: () => Promise<PlatformOutcome>): Promise<PlatformOutcome> {
  try {
    return await call();
  } catch (err) {
    return { ok: false, error_code: "platform_error", response: { message: err instanceof Error ? err.message : String(err) } };
  }
}

async function finish(deps: GuardDeps, orgId: string, actionId: string, outcome: PlatformOutcome): Promise<GuardOutcome> {
  const at = deps.now().toISOString();
  if (outcome.ok) {
    await completeAction(deps.admin, orgId, actionId, { status: "succeeded", response: outcome.response ?? null, platform_refs: outcome.platform_refs ?? null, at });
    return { kind: "succeeded", action_id: actionId };
  }
  await completeAction(deps.admin, orgId, actionId, { status: "failed", response: outcome.response ?? null, error_code: outcome.error_code, at });
  return { kind: "failed", action_id: actionId, error_code: outcome.error_code };
}
