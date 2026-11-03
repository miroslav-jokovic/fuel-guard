import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignEvent, CampaignState } from "@silvicom/shared";
import { completeAction, startAction } from "../actions/actionLedger.js";
import type { GuardedPlatform } from "../guard/guardedPlatform.js";
import { NOT_ON_PLATFORM } from "../platforms/adapter.js";
import { brakeWorkers, killReason } from "./brake.js";
import { applyCampaignEvent, loadCampaign, type CampaignRow, type TransitionAsk, type TransitionResult } from "./transitions.js";
import { agentHasWork, type CampaignWorkers } from "./workers.js";

/**
 * The orchestrator's runner (A6; D-AD16 — the orchestrator is code, not a model). One `ads_step` job =
 * one campaign, one step: load it, do the side effect its state calls for, then move it with one
 * `ads_actions` row (`transitions.ts`). It decides nothing a table does not: the event it sends is
 * asked of `stepCampaign`, and an illegal one is refused and recorded, never forced.
 *
 *   draft      → compose                          (once C-phase's workers exist)
 *   composing  → the workers write + check        → creatives_ready | compose_failed
 *   approved   → create_paused                    (once B2's publisher exists)
 *   creating   → the publisher, paused            → created | create_failed
 *   launching  → `GuardedPlatform.launch` (every fence of A5's guard; never an adapter) → launched | launch_failed
 *   pausing    → the platform's pause             → paused | pause_failed (stays, retried next tick)
 *   launching, live + kill switch on → kill       → pausing
 *
 * ⚠ THE KILL SWITCH'S SECOND HALF. A5 stops new spending the moment it is pressed (the guard and AX021);
 * this file stops DELIVERY: the next tick moves every launching or live campaign to `pausing`, and the
 * pausing step asks the platform to pause. Checked before anything else in those states, so a launch
 * caught by the switch is never attempted.
 *
 * ⚠ A LAUNCH WHOSE OUTCOME IS UNKNOWN IS PAUSED. A crash between the guard's `started` row and its
 * completion leaves us not knowing whether the platform is delivering. The approval is spent either way
 * (one yes, one act), so asking the guard again would only be refused — and moving to `paused` on that
 * refusal would mark a possibly-live ad as stopped. Instead the step sends `pause`: the safe direction,
 * legal from `launching`, and true whatever the platform did. A person then launches again with a new
 * approval. Found before it could happen, by reading `approvals.ts`'s single-use rule against a retry.
 */

export interface RunnerDeps {
  admin: SupabaseClient;
  now: () => Date;
  workers: CampaignWorkers;
  /** Set when every org must stop whatever its own switch says (`brake.ts`: `ADS_ENABLED` off). */
  brake?: string | null;
}

export type StepOutcome =
  | { kind: "not_found" }
  /** Nothing for the agent here: a person's turn, a worker not built yet, or the job's state already left. */
  | { kind: "idle"; state: CampaignState; reason: string }
  | ({ kind: "stepped"; event: CampaignEvent } & { result: TransitionResult });

export const ORCHESTRATOR = { kind: "agent" as const, name: "Ads orchestrator" };

export async function runCampaignStep(deps: RunnerDeps, orgId: string, campaignId: string, expectedState?: CampaignState): Promise<StepOutcome> {
  const campaign = await loadCampaign(deps.admin, orgId, campaignId);
  if (!campaign) return { kind: "not_found" };
  // The tick queued this job for one state; if a person or an earlier delivery has moved it since, the
  // tick will queue the new state's job itself. Acting here would be acting on a stale read.
  if (expectedState && campaign.state !== expectedState) return { kind: "idle", state: campaign.state, reason: "state_moved" };

  const brake = deps.brake ?? null;
  const kill = await killReason(deps.admin, orgId, brake);
  const run = brake ? { ...deps, workers: brakeWorkers(deps.workers) } : deps;
  if (!agentHasWork(campaign.state, run.workers, kill !== null)) return { kind: "idle", state: campaign.state, reason: "no_agent_work" };

  const ask = await decide(run, campaign, kill);
  if (!ask) return { kind: "idle", state: campaign.state, reason: "no_platform" };
  const result = await applyCampaignEvent(deps.admin, campaign, { actor: ORCHESTRATOR, ...ask }, deps.now().toISOString());
  return { kind: "stepped", event: ask.event, result };
}

type Ask = Omit<TransitionAsk, "actor">;

/** The side effect of one state, and the event it ends in. Null = nothing to do after all. */
async function decide(deps: RunnerDeps, c: CampaignRow, killReason: string | null): Promise<Ask | null> {
  const key = `${c.id}:${c.state_changed_at}`;
  const { workers } = deps;
  if (killReason && (c.state === "launching" || c.state === "live")) return { event: "kill", cause: `kill switch: ${killReason}` };
  switch (c.state) {
    case "draft":
      return { event: "compose" };
    case "composing": {
      const r = await attempt(() => workers.compose!(c, key));
      return r.ok ? { event: "creatives_ready" } : { event: "compose_failed", cause: r.error, error: r.error };
    }
    case "approved":
      return { event: "create_paused" };
    case "creating": {
      const r = await attempt(() => workers.createPaused!(c, key));
      return r.ok ? { event: "created", platform_refs: r.platform_refs ?? null } : { event: "create_failed", cause: r.error_code, error: r.error_code };
    }
    case "launching": {
      const platform = await workers.platform!(c.org_id, c.connection_id);
      if (!platform) return { event: "launch_failed", cause: "no usable platform connection", error: "no_platform" };
      return launchStep(deps, c, platform);
    }
    case "pausing": {
      const platform = await workers.platform!(c.org_id, c.connection_id);
      if (!platform) return { event: "pause_failed", cause: "no usable platform connection", error: "no_platform" };
      return pauseStep(deps, c, platform, key);
    }
    default:
      return null;
  }
}

/** What a worker that THREW becomes: a failure carrying its message — never a step that silently retries. */
type Thrown = { ok: false; error: string; error_code: string; response?: undefined; platform_refs?: undefined };

async function attempt<T extends { ok: boolean }>(run: () => Promise<T>): Promise<T | Thrown> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, error_code: message };
  }
}

interface LaunchRow { id: string; status: string; error_code: string | null; response: unknown; platform_refs: Record<string, unknown> | null }

/**
 * The newest launch attempted in THIS stint of `launching`, if any (refusals are re-asked; they cost
 * nothing). "This stint" is `started_at >= state_changed_at`: both stamps come from the app's clock
 * (`applyCampaignEvent`'s and the guard's `now`), and the launch cannot start before the move into
 * `launching` committed, so only clock skew between two of our hosts could misplace one — NTP-bounded
 * milliseconds against a tick measured in seconds.
 */
async function launchThisStint(admin: SupabaseClient, c: CampaignRow): Promise<LaunchRow | null> {
  const { data, error } = await admin
    .from("ads_actions")
    .select("id, status, error_code, response, platform_refs")
    .eq("org_id", c.org_id)
    .eq("campaign_id", c.id)
    .eq("kind", "launch")
    .neq("status", "refused")
    .gte("started_at", c.state_changed_at)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`ads_actions: ${error.message}`);
  return ((data ?? []) as LaunchRow[])[0] ?? null;
}

/**
 * ⚠ A LAUNCH THAT FAILED AT THE PLATFORM IS PAUSED, NOT MARKED STOPPED (2026-11-03 audit H1). A failed
 * row says only that the adapter did not see the campaign come back ACTIVE — not that it is inactive:
 * the `campaign_active` write can succeed and its read-back then be throttled or time out, and Meta
 * delivers. `launch_failed` would record that campaign as `paused`, where nothing pauses it and the
 * kill switch passes it by (it acts on `launching` and `live` only). So it goes the way an unknown
 * outcome goes: `pause`, then a pause the platform confirms. A pause of a campaign that never went
 * ACTIVE costs one idempotent call. The one failure that skips it is `NOT_ON_PLATFORM`: nothing was
 * written, and with no platform ids a pause could never succeed either.
 */
function fromLaunchRow(row: LaunchRow): Ask {
  if (row.status === "succeeded") return { event: "launched", platform_refs: row.platform_refs };
  const code = row.error_code ?? "launch_failed";
  if (row.status === "failed" && code === NOT_ON_PLATFORM) return { event: "launch_failed", cause: code, error: code };
  if (row.status === "failed") {
    return { event: "pause", cause: `launch failed at the platform (${code}) — paused and confirmed to be safe; launching again needs a new approval`, error: code };
  }
  return { event: "pause", cause: "launch outcome unknown after a restart — paused to be safe; launching again needs a new approval" };
}

async function launchStep(deps: RunnerDeps, c: CampaignRow, platform: GuardedPlatform): Promise<Ask> {
  const prior = await launchThisStint(deps.admin, c);
  if (prior) return fromLaunchRow(prior);
  if (c.daily_budget_cents === null || c.lifetime_cap_cents === null) {
    return { event: "launch_failed", cause: "the campaign has no daily budget or lifetime cap", error: "budget_unset" };
  }
  const outcome = await platform.guardedLaunch({
    orgId: c.org_id, campaignId: c.id, daily_cents: Number(c.daily_budget_cents), lifetime_cents: Number(c.lifetime_cap_cents), actor: ORCHESTRATOR,
  });
  if (outcome.kind === "refused") {
    const why = outcome.refusals.join(", ");
    return { event: "launch_failed", cause: `refused: ${why}`, error: outcome.refusals[0] ?? "refused" };
  }
  // succeeded, failed, or already_attempted: the row the guard wrote is the answer, read back once.
  const row = await launchThisStint(deps.admin, c);
  if (!row) throw new Error(`ads launch for campaign ${c.id}: the guard answered ${outcome.kind} but no launch row exists`);
  return fromLaunchRow(row);
}

/**
 * One pause act per stint of `pausing`, recorded like any act that moves delivery. A `pause_failed`
 * stamps a new stint, so the next tick's attempt gets a new key — a stuck pause is retried every tick
 * and every attempt is a row, which is loud on purpose: a pause that will not take while the kill
 * switch is on is the one failure an owner must see.
 */
async function pauseStep(deps: RunnerDeps, c: CampaignRow, platform: GuardedPlatform, key: string): Promise<Ask> {
  const at = deps.now().toISOString();
  const idempotency_key = `pause:${key}`;
  const started = await startAction(deps.admin, {
    org_id: c.org_id, campaign_id: c.id, connection_id: c.connection_id, kind: "pause",
    actor_kind: "agent", actor_id: null, actor_name: ORCHESTRATOR.name, idempotency_key, request: { reason: "pausing" },
  }, at);
  if (started === "duplicate") {
    const { data, error } = await deps.admin.from("ads_actions").select("status, error_code").eq("org_id", c.org_id).eq("idempotency_key", idempotency_key).maybeSingle();
    if (error) throw new Error(`ads_actions: ${error.message}`);
    const prior = data as { status: string; error_code: string | null } | null;
    if (prior?.status === "succeeded") return { event: "paused" };
    return { event: "pause_failed", cause: prior?.status === "failed" ? (prior.error_code ?? "pause failed") : "pause outcome unknown after a restart — asking again", error: prior?.error_code ?? "pause_unknown" };
  }
  if ("refusedBy" in started) throw new Error(`ads_actions: a pause met fence ${started.refusedBy}`);
  const ref = { campaign_id: c.id, platform: platform.platform, platform_refs: c.platform_refs };
  const outcome = await attempt(() => platform.safe.pause({ campaign: ref, idempotency_key }));
  const done = deps.now().toISOString();
  if (outcome.ok) {
    await completeAction(deps.admin, c.org_id, started.id, { status: "succeeded", response: outcome.response ?? null, at: done });
    return { event: "paused" };
  }
  const code = "error_code" in outcome ? outcome.error_code : "pause_failed";
  await completeAction(deps.admin, c.org_id, started.id, { status: "failed", error_code: code, response: outcome.response ?? null, at: done });
  return { event: "pause_failed", cause: code, error: code };
}
