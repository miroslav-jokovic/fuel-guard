import { applyCardMutation } from "../orchestrator/dispatch.js";
import { cardLedger, type LedgerAdapter } from "../orchestrator/ledger.js";
import { planCardMutation } from "../orchestrator/plan.js";
import type { CardMutationContext, CardMutationOutcome, ResolvedCapability } from "../orchestrator/types.js";
import { withEfsCardWriteDeadline } from "./efsCardWriteDeadline.js";
import { signalCardMutationSettled } from "../../../lib/cardControlSignals.js";

export { CardControlError } from "./efsCardControlErrors.js";
export { CardMutationReplay } from "../orchestrator/types.js";
export type {
  CardMutationContext,
  CardMutationOutcome,
  CardMutationPlan,
  ResolvedCapability,
} from "../orchestrator/types.js";
export { applyCardMutation } from "../orchestrator/dispatch.js";
export { planCardMutation } from "../orchestrator/plan.js";
export { resolveCapability } from "../orchestrator/resolve.js";

/**
 * Changing a fuel card in EFS: one path, one ledger row, one recorded outcome for every branch.
 *
 * ── The shape of every mutation ──────────────────────────────────────────────────────────────────
 *
 *   plan:   capacity checks → verify.snapshot → expectedVersion → governance → edits → ledger 'pending'
 *   apply:  per step: dispatch → verify.snapshot → verify.judge → settle + audit + mirror
 *
 * Split into two exported functions even though Phase 1 calls them back to back in one request. That
 * seam is what makes maker-checker a route and a UI rather than a schema migration later: `apply`
 * re-validates the version it was planned against, so a stale approval is refused instead of applied
 * blind, and `approved_by` already exists on the ledger.
 *
 * ── Where the code went (Step 3.4) ───────────────────────────────────────────────────────────────
 * This file was the whole orchestrator and is now its door. The five phases of docs/27 §5 each have
 * a module under `../efs/orchestrator/`: `plan.ts` decides, `dispatch.ts` sends and verifies,
 * `ledger.ts` is the only writer of `efs_card_mutations`, `steps.ts` normalises a capability into
 * steps, `resolve.ts` translates the pre-capability specs, and `efsCardReconcile.ts` classifies and
 * records. Splitting it was not tidying: `lint:funcsize` caps a function at 200 lines and the step
 * loop does not fit beside the phase it dispatches.
 *
 * What is deliberately NOT here: the request-shaped half of `prepare()` — kill switch, idempotency
 * key, access, credentials, target resolution, `preflightStepUp`, the write limiter — which lives in
 * `routes/fuelCards/controlPrepare.ts` and is called by the generated router.
 */

/**
 * Run one capability end to end, on the operation-wide write deadline.
 *
 * The ledger adapter is constructed HERE, once, and threaded down. A capability never receives it —
 * that is what makes "a ledger row exists before any dispatch" and "the audit row is written once, by
 * one place" invariants of the orchestrator rather than of each capability's good behaviour
 * (docs/27 §4).
 */
export async function executeCapability<TBody>(
  ctx: CardMutationContext,
  capability: ResolvedCapability<TBody>,
  ledger: LedgerAdapter = cardLedger(),
): Promise<CardMutationOutcome> {
  const outcome = await withEfsCardWriteDeadline(ctx.env, async (signal) => {
    const scoped = { ...ctx, signal };
    return applyCardMutation(scoped, await planCardMutation(scoped, capability, ledger), ledger);
  });

  /**
   * Step 5.1's mutation-outcome signal, emitted HERE and nowhere else.
   *
   * The five `finalize*` functions in `efsCardReconcile.ts` each settle the ledger, so instrumenting
   * settlement would have meant five call sites and five chances to add a sixth without one. This is
   * the single point where an operation is over AND both facts the signal needs are in scope: the
   * intent and the capability key live on the descriptor, and neither reaches the reconciler.
   *
   * After the deadline wrapper, so a mutation killed by the write deadline throws and is NOT reported
   * as a settled outcome — it did not settle, and inventing a fifth outcome for it here would put a
   * number in the dashboard that no ledger row backs.
   */
  signalCardMutationSettled({
    orgId: ctx.orgId,
    intent: capability.intent,
    capability: capability.capabilityKey,
    outcome: outcome.status,
  });
  return outcome;
}
