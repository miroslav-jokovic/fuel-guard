import type { CampaignState } from "@silvicom/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { guardPlatform, type GuardedPlatform } from "../guard/guardedPlatform.js";
import { adapterForConnection } from "../platforms/registry.js";
import type { PlatformOutcome } from "../platforms/adapter.js";
import type { CampaignRow } from "./transitions.js";
import { anthropicClient } from "../../../lib/anthropic.js";
import { composeCampaign } from "../compose/composeCampaign.js";
import { readAdAsset, storeAdAsset } from "../creative/brandAssets.js";
import { publishCampaign } from "../platforms/meta/publishCampaign.js";
import { HIGGSFIELD_CREDIT_PRICES } from "../creative/higgsfield/prices.js";
import { renderChoiceFor } from "../creative/higgsfield/simulatedRender.js";
import { renderStatus, type RenderInput, type RenderOutcome } from "../creative/higgsfield/render.js";
import { pgQueueDriver } from "../../../queue/pgDriver.js";
import type { QueueDriver } from "../../../queue/types.js";

/**
 * What the orchestrator hands work to (D-AD16: "small single-job workers under one orchestrator").
 * Each is null until the step that builds it lands, and the runner and the tick both read that null
 * as "no work here yet": a campaign waits in its state, visibly, instead of failing for a worker
 * nobody has written. That is the honest Stage 1 shape, not a stub that pretends.
 *
 * Every call gets `key` = `<campaign id>:<the stint's state_changed_at>`. A worker must be idempotent
 * on it: the queue is at-least-once (a lease can expire on a slow, alive job), so the same step can
 * run twice, and the second run must find the first one's work rather than redo it (§4R, the
 * Orchestrator's L2 row: "0 duplicate vendor creates across all crash points").
 */
export interface CampaignWorkers {
  /** C1–C5: copy, art direction, render and checks, one creative per preset. */
  compose: ((campaign: CampaignRow, key: string) => Promise<WorkerResult>) | null;
  /** B2 (the publisher): put the campaign on its platform, paused. Returns the platform's ids. */
  createPaused: ((campaign: CampaignRow, key: string) => Promise<PlatformOutcome>) | null;
  /** B1: the connection's platform, its spend half bound to the guard. Null for a connection that cannot be used. */
  platform: ((orgId: string, connectionId: string) => Promise<GuardedPlatform | null>) | null;
}

/**
 * `pending` (C5b): the work is under way and not finished — a render Higgsfield is still drawing. The
 * runner moves nothing and records nothing; the campaign stays in its state, and the next tick queues
 * the step again (its dedup slot only holds while a job is active). The worker must therefore be
 * idempotent on `key`: the re-run replays what is done and polls what is not, never asks again.
 */
export type WorkerResult = { ok: true } | { ok: false; error: string } | { ok: false; pending: true; why: string };

/**
 * The workers this build has. A6 (2026-11-02): none — the adapters arrive in B1–B2 (and the simulator
 * platform in step 7, on non-production hosts only), the creative workers in C1–C5. Each of those
 * steps fills its line here. With `ADS_ENABLED` off everywhere until then, the tick finds nothing.
 *
 * B3 (2026-11-02) fills `platform`: pause reaches Meta (or the simulator), and launch goes through the
 * guard.
 *
 * C5b2 (2026-11-04) fills `compose` (`compose/composeCampaign.ts`).
 *
 * B2a (2026-11-02) built the publisher's first half and left `createPaused` null: `created` moves a
 * campaign to `paused`, where a person presses Launch, and half a publisher would show a state that is
 * not true. B2c1 completed the chain (forms per language, an ad per approved creative and language);
 * B2c2 (2026-11-04) taught lead intake every form id, then filled `createPaused`.
 */
export function adsWorkers(deps: WorkerDeps): CampaignWorkers {
  return {
    // C5b2: the presets drawn, one creative per preset in the batch, each through copy → art → render →
    // overlay → the three checks (`compose/`). The render itself is NOT done here: see `queuedRender`.
    // Which model draws it follows the campaign's connection: a simulator campaign draws in the simulator.
    compose: async (campaign) => {
      const choice = await renderChoiceFor(deps.admin, campaign.org_id, campaign.connection_id);
      return composeCampaign({
        admin: deps.admin, now: deps.now, client: anthropicClient(deps.env),
        renderModel: choice.model,
        render: queuedRender(deps.admin, undefined, choice.prices),
        readAsset: (orgId, ref) => readAdAsset(deps.admin, orgId, ref),
        storeAsset: (orgId, bytes) => storeAdAsset(deps.admin, orgId, bytes),
      }, campaign);
    },
    // B2c2: the campaign, its ad set, a form per language and an ad per approved creative and language,
    // all PAUSED (`platforms/meta/publishCampaign.ts`). Its `meta_ad_ids` are what launch turns on.
    createPaused: (campaign, key) => publishCampaign({
      admin: deps.admin, env: deps.env, now: deps.now,
      readAsset: (orgId, ref) => readAdAsset(deps.admin, orgId, ref),
    }, campaign, key),
    // B3: the connection's Meta adapter (or the simulator's, off production), its spend half closed
    // inside the guard. With it, a pausing campaign — the kill switch's second half — reaches Meta.
    platform: async (orgId, connectionId) => {
      const found = await adapterForConnection({ admin: deps.admin, env: deps.env, now: deps.now }, orgId, connectionId);
      return found ? guardPlatform(deps.admin, deps.now, found.platform, found.adapter) : null;
    },
  };
}

/**
 * Compose's render: read where it stands, and if it is not finished, make sure an `ads_render` job is
 * queued for it, then answer `pending`. The job, not this step, calls Higgsfield, because the job runs ONE
 * AT A TIME (`KIND_CAPS.ads_render` 1) and `creditGate` counts renders in flight: two submitted at once
 * could both pass the month's budget and overspend it by one render. `ads_step` runs two at a time, so a
 * render called from here would reopen that race. The job's dedup key holds one job per creative and
 * attempt; a job whose retries ran out leaves its row `started`, and the next step queues it again.
 * The job goes in as a queue row (`pgQueueDriver`), never `dispatchJob`, which in production's in-process
 * mode would run the render inline, inside this step (B4b's trap).
 */
export function queuedRender(admin: SupabaseClient, driver: QueueDriver = pgQueueDriver(admin), prices: Readonly<Record<string, number>> = HIGGSFIELD_CREDIT_PRICES): (input: RenderInput) => Promise<RenderOutcome> {
  return async (input) => {
    const status = await renderStatus(admin, prices, input);
    if (status.kind !== "absent" && status.kind !== "pending") return status;
    const r = await driver.enqueue("ads_render", { orgId: input.orgId, payload: { ...input }, dedupKey: `ads_render:${input.creativeId}:${input.attempt}` });
    return { kind: "pending", generationId: status.kind === "pending" ? status.generationId : "", retryAfterSeconds: null, why: "conflict" in r ? "render queued" : "render job queued" };
  };
}

export interface WorkerDeps {
  admin: SupabaseClient;
  env: Env;
  now: () => Date;
}

/**
 * The runner's own plan: in which states the agent has something to do, given the workers it has and
 * the kill switch. The tick enqueues exactly these, and the runner idles in every other — one
 * definition read by both, so the tick cannot enqueue a step the runner would skip, or skip one it
 * would take. Which MOVE is legal stays `stepCampaign`'s; this says only where to look.
 */
export function agentHasWork(state: CampaignState, workers: CampaignWorkers, killSwitch: boolean): boolean {
  switch (state) {
    case "draft":
    case "composing":
      return workers.compose !== null;
    case "approved":
    case "creating":
      return workers.createPaused !== null;
    // The kill moves launching/live to pausing with no platform call, so it needs no adapter.
    case "launching":
      return killSwitch || workers.platform !== null;
    case "live":
      return killSwitch;
    case "pausing":
      return workers.platform !== null;
    // A person's turn (review, paused, failed) or the end (archived).
    default:
      return false;
  }
}
