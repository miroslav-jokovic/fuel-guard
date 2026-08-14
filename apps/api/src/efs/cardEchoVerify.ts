import { intentLanded } from "../services/efsCardReconcile.js";
import { getCardV2 } from "../lib/efsCardOps.js";
import type { VerifyPlan } from "./types.js";

/**
 * The verification almost every echo capability wants: re-read the card, ask whether the edits took.
 *
 * Shared rather than repeated because the interesting decisions are already made inside
 * `intentLanded` — it compares only the paths the edits NAMED, and tolerates the vendor answering
 * `HOLD` to a sent `Hold` (the 2026-08-12 casing incident). A capability writing its own comparison
 * would have to re-derive both, and the second one to get it wrong records a successful lock as a
 * failure.
 *
 * `indeterminate` when the re-read produced no document: that is "we could not tell", which is a
 * different fact from "it did not land" and the orchestrator treats it differently.
 */
export const cardEchoVerify = <TBody>(): VerifyPlan<TBody> => ({
  snapshot: async (ctx) => ({ doc: await getCardV2(ctx.env, ctx.creds, ctx.cardNumber, ctx.opts) }),
  judge: (before, after, _body, edits) => {
    if (!before.doc || !after.doc) return "indeterminate";
    return intentLanded(before.doc, after.doc, edits) ? "landed" : "not_landed";
  },
});
