import type { Env } from "../../env.js";

/**
 * The gate a `compliance_paper` read passes before it spends (UNIT-FILES-PLAN UF7b2; DOCUMENT-READER-PLAN
 * Step 1.6's "the consumer's gate"). Wired at the composition root, the `document_read` queue handler,
 * beside the shipping document's and the roadside report's, because the reader must not depend on its
 * consumers (D-DR1).
 *
 * No entitlement, for the roadside report's reason: driver and unit files are not an `org_modules` key,
 * they are gated by the `roster` and `equipment` SECTIONS, and a read is queued only by somebody who
 * manages the file the papers go into (UF7b3). So the gate is the operator's switch, `FILE_PAPER_READING`.
 *
 * No monthly budget yet (null = unlimited, `withinBudget`'s convention). The largest known run is the
 * McLeod import's 1,359 papers re-read once for their dates (Q-UF13 (b)) — each a page or two, and the
 * cache answers a re-read of the same bytes. A budget is a number the owner sets from a measured month;
 * the first month of reads is that measurement.
 */
export function compliancePaperReadGate(env: Pick<Env, "FILE_PAPER_READING">): { open: boolean; monthlyTokenBudget: number | null } {
  return { open: env.FILE_PAPER_READING === "on", monthlyTokenBudget: null };
}
