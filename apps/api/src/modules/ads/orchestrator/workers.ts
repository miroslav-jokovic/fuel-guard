import type { CampaignState } from "@silvicom/shared";
import type { GuardedPlatform } from "../guard/guardedPlatform.js";
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
 */
export function adsWorkers(): CampaignWorkers {
  return { compose: null, createPaused: null, platform: null };
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
