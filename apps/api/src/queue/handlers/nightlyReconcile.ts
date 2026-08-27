import { runNightlyReconcile } from "../../orchestration/nightlyReconcile.js";
import type { JobHandler } from "../types.js";

/**
 * Nightly self-heal: repair the fuel-event store from the EFS source, re-score, rules-only rebuild.
 * Split out of handlers/samsara.ts 2026-08-27 (program step P1.4b); the orchestration itself lives at
 * src/orchestration/nightlyReconcile.ts since P1.8 — the one sanctioned home for cross-module chains.
 */
export const nightlyReconcileHandler: JobHandler = async (ctx, job) => {
  return runNightlyReconcile(ctx.admin, ctx.env, job.org_id);
};
