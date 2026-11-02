import type { CampaignState } from "@silvicom/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { guardPlatform, type GuardedPlatform } from "../guard/guardedPlatform.js";
import { adapterForConnection } from "../platforms/registry.js";
import type { PlatformOutcome } from "../platforms/adapter.js";
import type { CampaignRow } from "./transitions.js";

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

export type WorkerResult = { ok: true } | { ok: false; error: string };

/**
 * The workers this build has. A6 (2026-11-02): none — the adapters arrive in B1–B2 (and the simulator
 * platform in step 7, on non-production hosts only), the creative workers in C1–C5. Each of those
 * steps fills its line here. With `ADS_ENABLED` off everywhere until then, the tick finds nothing.
 *
 * B3 (2026-11-02) fills `platform`: pause reaches Meta (or the simulator), and launch goes through the
 * guard. `createPaused` is still null, so nothing reaches `paused` by the agent yet, and so no launch.
 *
 * B2a (2026-11-02) built the publisher's first half (`platforms/meta/publisher.ts`: campaign + ad set,
 * paused) and deliberately leaves `createPaused` null. `created` moves a campaign to `paused`, where a
 * person presses Launch; a campaign with no ad yet has nothing to launch, so wiring half a publisher
 * would show a state that is not true. B2c fills it once the form and the ad complete the chain.
 */
export function adsWorkers(deps: WorkerDeps): CampaignWorkers {
  return {
    compose: null,
    createPaused: null,
    // B3: the connection's Meta adapter (or the simulator's, off production), its spend half closed
    // inside the guard. With it, a pausing campaign — the kill switch's second half — reaches Meta.
    platform: async (orgId, connectionId) => {
      const found = await adapterForConnection({ admin: deps.admin, env: deps.env, now: deps.now }, orgId, connectionId);
      return found ? guardPlatform(deps.admin, deps.now, found.platform, found.adapter) : null;
    },
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
