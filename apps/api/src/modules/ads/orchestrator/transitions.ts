import type { SupabaseClient } from "@supabase/supabase-js";
import { stepCampaign, type CampaignActor, type CampaignEvent, type CampaignState } from "@silvicom/shared";
import { completeAction, recordFinished, startAction, type ActionRow } from "../actions/actionLedger.js";

/**
 * `ads_campaigns.state` (0537) — the ONLY writer of a campaign's state, and the one place a move is
 * asked of the machine (`stepCampaign`, D-AD16). The orchestrator's runner calls it, and so will the
 * screens' doors (E-phase: approve, launch, archive), so a person's move and an agent's are recorded
 * the same way and race each other safely.
 *
 * ── A MOVE AND ITS RECORD, WITHOUT A TRANSACTION ───────────────────────────────────────────────────
 * 0537's header: every state transition is written to `ads_actions` BEFORE it happens (`started`) and
 * completed after. That is the shape here, the same one a vendor call has:
 *
 *   1. `started` row, kind `transition`, keyed `transition:<campaign>:<from's state_changed_at>:<event>`
 *      — leaving one stint of a state by one event happens at most once, so a delivered-twice job
 *      finds the first row (`duplicate`) instead of writing a second;
 *   2. compare-and-set: UPDATE … WHERE state = from AND state_changed_at = the stint we read. Zero
 *      rows = somebody else moved it first (a person paused while the runner composed). Nothing is
 *      overwritten; the row completes `failed` / `state_moved`;
 *   3. the row completes `succeeded`.
 *
 * A crash between 2 and 3 leaves a `started` row and a campaign that did move. `settleOpenTransitions`
 * (run before every move) closes it from the campaign itself: the move stamped `state_changed_at`
 * with the row's own `to_changed_at`, so "is the campaign in `to`, stamped at that instant?" answers
 * whether this row's move is the one that happened. Nothing is guessed and nothing is left open.
 *
 * Why not one RPC doing both in a transaction: it would need a migration and, by the deploy-window
 * rule, a second merge for its first caller — for a guarantee the ledger's started/completed shape
 * already gives (a move is never unrecorded; a record never claims a move that did not happen once
 * settled). Measured trade-off, said here so the next reader does not redo it.
 */

export interface CampaignRow {
  id: string;
  org_id: string;
  connection_id: string;
  state: CampaignState;
  state_changed_at: string;
  daily_budget_cents: number | null;
  lifetime_cap_cents: number | null;
  platform_refs: Record<string, unknown>;
}

export const CAMPAIGN_COLUMNS = "id, org_id, connection_id, state, state_changed_at, daily_budget_cents, lifetime_cap_cents, platform_refs";

export type TransitionActor =
  | { kind: "person" | "approver"; id: string; name: string }
  | { kind: "agent"; name: string }
  | { kind: "platform"; name: string };

export interface TransitionAsk {
  event: CampaignEvent;
  actor: TransitionActor;
  /** Why — the worker's error, the kill reason, the guard's refusals. Shown on the campaign (E5). */
  cause?: string | null;
  /** Kept on the campaign as `last_error`; any move without one clears it. */
  error?: string | null;
  /** Merged into `platform_refs` with the move (what `created` / `launched` learned). */
  platform_refs?: Record<string, unknown> | null;
}

export type TransitionResult =
  | { kind: "moved"; from: CampaignState; to: CampaignState }
  /** Legal and changes nothing (the kill switch in a state with nothing delivering): no row, no write. */
  | { kind: "no_op"; state: CampaignState }
  | { kind: "refused"; reason: "illegal_transition" | "actor_not_allowed" }
  /** Another writer moved the campaign first; this move did not happen and its row says so. */
  | { kind: "state_moved" }
  /** This exact move was already recorded finished by an earlier delivery of the same job. */
  | { kind: "already_recorded"; status: string };

export async function loadCampaign(admin: SupabaseClient, orgId: string, campaignId: string): Promise<CampaignRow | null> {
  const { data, error } = await admin.from("ads_campaigns").select(CAMPAIGN_COLUMNS).eq("org_id", orgId).eq("id", campaignId).maybeSingle();
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  return (data as CampaignRow | null) ?? null;
}

function actorColumns(actor: TransitionActor): Pick<ActionRow, "actor_kind" | "actor_id" | "actor_name"> {
  // `approver` is the machine's word for a person whose approval the act cites; the ledger's is person.
  if (actor.kind === "person" || actor.kind === "approver") return { actor_kind: "person", actor_id: actor.id, actor_name: actor.name };
  return { actor_kind: actor.kind, actor_id: null, actor_name: actor.name };
}

/** Ask the machine, then move with one `ads_actions` row. A refusal is recorded too (`refused`). */
export async function applyCampaignEvent(admin: SupabaseClient, campaign: CampaignRow, ask: TransitionAsk, at: string): Promise<TransitionResult> {
  const step = stepCampaign(campaign.state, ask.event, ask.actor.kind as CampaignActor);
  const base: ActionRow = {
    org_id: campaign.org_id,
    campaign_id: campaign.id,
    connection_id: campaign.connection_id,
    kind: "transition",
    ...actorColumns(ask.actor),
    cause: clip(ask.cause ?? null),
    request: { from: campaign.state, event: ask.event, from_changed_at: campaign.state_changed_at },
  };
  if (!step.ok) {
    await recordFinished(admin, base, { status: "refused", error_code: step.reason, at });
    return { kind: "refused", reason: step.reason };
  }
  const { to } = step.transition;
  if (to === campaign.state && ask.event === "kill") return { kind: "no_op", state: to };

  await settleOpenTransitions(admin, campaign);
  const key = `transition:${campaign.id}:${campaign.state_changed_at}:${ask.event}`;
  const row: ActionRow = { ...base, idempotency_key: key, request: { ...base.request, to, to_changed_at: at } };
  const started = await startAction(admin, row, at);
  if (started !== "duplicate" && "refusedBy" in started) throw new Error(`ads_actions: a transition met fence ${started.refusedBy}`);
  let actionId: string;
  let toAt = at;
  if (started === "duplicate") {
    const prior = await actionByKey(admin, campaign.org_id, key);
    if (prior.status !== "started") return { kind: "already_recorded", status: prior.status };
    actionId = prior.id;
    toAt = String(prior.request.to_changed_at ?? at);
  } else {
    actionId = started.id;
  }

  const patch: Record<string, unknown> = { state: to, state_changed_at: toAt, last_error: clip(ask.error ?? null) };
  if (ask.platform_refs) patch.platform_refs = { ...campaign.platform_refs, ...ask.platform_refs };
  const { data, error } = await admin
    .from("ads_campaigns")
    .update(patch)
    .eq("org_id", campaign.org_id)
    .eq("id", campaign.id)
    .eq("state", campaign.state)
    .eq("state_changed_at", campaign.state_changed_at)
    .select("id");
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  const moved = ((data ?? []) as unknown[]).length > 0;
  await completeAction(admin, campaign.org_id, actionId, moved
    ? { status: "succeeded", at: toAt }
    : { status: "failed", error_code: "state_moved", at: toAt });
  return moved ? { kind: "moved", from: campaign.state, to } : { kind: "state_moved" };
}

interface OpenTransition {
  id: string;
  status: string;
  request: { from_changed_at?: string; to?: string; to_changed_at?: string };
}

async function actionByKey(admin: SupabaseClient, orgId: string, key: string): Promise<OpenTransition> {
  const { data, error } = await admin.from("ads_actions").select("id, status, request").eq("org_id", orgId).eq("idempotency_key", key).maybeSingle();
  if (error) throw new Error(`ads_actions: ${error.message}`);
  if (!data) throw new Error(`ads_actions: ${key} reported duplicate and cannot be read`);
  return data as OpenTransition;
}

/**
 * Close every `started` transition of this campaign that belongs to a stint the campaign has left:
 * succeeded if the campaign carries that row's own stamp, failed (`not_applied`) otherwise. A row of
 * the CURRENT stint is left alone — it is either this move's own (the duplicate path finishes it) or a
 * concurrent writer's, mid-flight.
 */
export async function settleOpenTransitions(admin: SupabaseClient, campaign: CampaignRow): Promise<number> {
  const { data, error } = await admin
    .from("ads_actions")
    .select("id, status, request")
    .eq("org_id", campaign.org_id)
    .eq("campaign_id", campaign.id)
    .eq("kind", "transition")
    .eq("status", "started")
    .limit(100);
  if (error) throw new Error(`ads_actions: ${error.message}`);
  let settled = 0;
  for (const row of (data ?? []) as OpenTransition[]) {
    const r = row.request;
    if (r.from_changed_at === campaign.state_changed_at) continue;
    const happened = r.to === campaign.state && r.to_changed_at !== undefined && sameInstant(r.to_changed_at, campaign.state_changed_at);
    await completeAction(admin, campaign.org_id, row.id, happened
      ? { status: "succeeded", at: r.to_changed_at! }
      : { status: "failed", error_code: "not_applied", at: campaign.state_changed_at });
    settled += 1;
  }
  return settled;
}

/** PostgREST renders a timestamptz in its own format; compare instants, not strings. */
const sameInstant = (a: string, b: string): boolean => Date.parse(a) === Date.parse(b);

const clip = (s: string | null): string | null => (s === null ? null : s.length > 1000 ? `${s.slice(0, 997)}…` : s);
