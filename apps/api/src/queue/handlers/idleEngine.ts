import { syncIdleEngine } from "../../modules/idle/index.js";
import { NoSamsaraTokenError } from "../../modules/samsara/index.js";
import type { JobHandler } from "../types.js";

/**
 * The idle engine's collector (kind `idle_engine`, FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md IE2). The run
 * decides its own window — the trailing three hours, or the nightly two-day recompute when that is
 * due — so a queued run and an in-process tick do the same thing from an empty payload. Its stats
 * carry `mode`, which is how the next run knows whether tonight's recompute has happened.
 */
export const idleEngineHandler: JobHandler = async (ctx, job) => {
  try {
    return { ...(await syncIdleEngine(ctx.admin, ctx.env, job.org_id)) };
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) return { skipped: "no_samsara_token" };
    throw e;
  }
};
