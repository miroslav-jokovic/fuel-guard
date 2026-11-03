import type { Env } from "../../env.js";

/**
 * The gate an `mvr_report` read passes before it spends (HIRING-WORKFLOW-AUDIT §14, OF6) — wired at the
 * composition root, the `document_read` queue handler, beside the other profiles' gates, because the reader
 * must not depend on its consumers (D-DR1).
 *
 * The operator's switch, `MVR_REPORT_READING`, and no entitlement: a read is queued only by somebody who may
 * record an MVR for this applicant (the `recruitment` section), from the driving-record drawer, one PDF at a
 * time. No monthly budget (null = unlimited, `withinBudget`'s convention): a hire pulls one to a few records,
 * and a re-read of the same bytes is answered from the cache.
 */
export function mvrReportReadGate(env: Pick<Env, "MVR_REPORT_READING">): { open: boolean; monthlyTokenBudget: number | null } {
  return { open: env.MVR_REPORT_READING === "on", monthlyTokenBudget: null };
}
