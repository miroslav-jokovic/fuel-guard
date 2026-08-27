import { projectFinancialWindow } from "../../modules/financial/index.js";
import type { JobHandler } from "../types.js";

/**
 * Financial projection (P3.4/P3.5). Default: the scheduler's trailing window arrives in the
 * payload. `payload.full` is the D-FS3 backfill — 2024-01-01 to tomorrow — dispatched once, by
 * a person, after the agent's --financial sweeps have filled staging back that far. Idempotent
 * either way: the 0257 source-row index makes re-projection converge.
 */
export const financialProjectionHandler: JobHandler = async (ctx, job) => {
  const full = job.payload.full === true;
  const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const from = full
    ? "2024-01-01" // D-FS3: where gl_ledger's live table starts
    : new Date(Date.now() - 50 * 86_400_000).toISOString().slice(0, 10);
  const r = await projectFinancialWindow(ctx.admin, job.org_id, from, to);
  return { from, to, ...r };
};
