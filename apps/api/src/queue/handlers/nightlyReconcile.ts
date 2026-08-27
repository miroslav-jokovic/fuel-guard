import { runNightlyReconcile } from "../../services/nightlyReconcile.js";
import type { JobHandler } from "../types.js";

/**
 * Nightly self-heal: repair the fuel-event store from the EFS source, re-score, rules-only rebuild.
 * Split out of handlers/samsara.ts 2026-08-27 (program step P1.4b) — it is the cross-module
 * orchestration the plan's P1.8 gives a proper home; this file just names it honestly until then.
 */
export const nightlyReconcileHandler: JobHandler = async (ctx, job) => {
  return runNightlyReconcile(ctx.admin, ctx.env, job.org_id);
};
