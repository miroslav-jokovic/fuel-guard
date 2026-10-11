import { projectFinancialWindow, projectionWindow } from "../../modules/financial/index.js";
import type { JobHandler } from "../types.js";

/**
 * Financial projection (P3.4/P3.5). Default: the nightly scheduler's trailing window
 * (`projectionWindow`, 75 days under D-FIN7). `payload.full` is the D-FS3 backfill — 2024-01-01 to
 * tomorrow — dispatched once, by a person, after the agent's --financial sweeps have filled staging
 * back that far. Idempotent either way: the 0257 source-row index makes re-projection converge.
 */
export const financialProjectionHandler: JobHandler = async (ctx, job) => {
  const { from, to } = projectionWindow(new Date(), job.payload.full === true);
  const r = await projectFinancialWindow(ctx.admin, job.org_id, from, to);
  return { from, to, ...r };
};
