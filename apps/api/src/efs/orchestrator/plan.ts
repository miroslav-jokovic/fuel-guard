import { ActionRefusalError, CardControlError } from "../../services/efsCardControlErrors.js";
import { cardOpOptions } from "../../services/efsCardOperationOptions.js";
import { updateMirror } from "../../services/efsCardReconcile.js";
import type { ReadCtx, Snapshot } from "../types.js";
import type { LedgerAdapter } from "./ledger.js";
import { firstStep } from "./steps.js";
import type { CardMutationContext, CardMutationPlan, ResolvedCapability } from "./types.js";

/**
 * Read the target as it is RIGHT NOW, check nothing has moved under the operator, and write the
 * intention down before anything is dispatched.
 *
 * The fresh read is not an optimisation and cannot be served from the mirror: `setCardV2` echoes the
 * document back, so echoing one from ten minutes ago would silently undo whatever changed in the WEX
 * portal since. That is also what makes `expectedVersion` meaningful — it compares the version the
 * operator's screen was drawn from against a document read moments ago, and refuses on any difference.
 *
 * ── What the capability supplies, and what it must not ───────────────────────────────────────────
 * The read is `verify.snapshot`, so a capability that writes state outside the card document names
 * the extra op it needs to see (docs/27 §3.3). Everything with a side effect stays here: the ledger
 * row, the mirror refresh, the refusals. A capability has no database handle, which is what makes
 * "a ledger row exists before any dispatch" an invariant rather than a habit.
 */
export async function planCardMutation<TBody>(
  ctx: CardMutationContext,
  capability: ResolvedCapability<TBody>,
  ledger: LedgerAdapter,
): Promise<CardMutationPlan<TBody>> {
  // FIRST, and before a single round trip: `cardLedger` is the only adapter that exists and it can
  // only key a row on a card (docs/27 §5.2). Refusing here rather than at the insert is the same
  // answer for the caller and one fewer paced vendor call spent proving it.
  if (capability.target.kind !== "card") {
    throw new CardControlError(
      "That operation is not supported yet.",
      "unsupported_target",
      501,
      { targetKind: capability.target.kind },
    );
  }

  await ledger.assertOrgCapacity(ctx);
  await ledger.assertNoneInFlight(ctx);

  const read: ReadCtx = { env: ctx.env, creds: ctx.creds, cardNumber: ctx.cardNumber, opts: cardOpOptions(ctx) };
  const before = await capability.verify.snapshot(read);

  const doc = await assertUnmoved(ctx, capability, before);

  // AFTER the fresh read, and with the snapshot in hand: the mirror-based prompt a route gives early
  // is a courtesy, and this is the decision that counts. A card flagged Fraud since the last sweep
  // must not unlock without step-up because our copy was stale (audit P1-7).
  const planStepUp = capability.governance.planStepUp?.(
    { env: ctx.env, stepUp: ctx.stepUp === true }, before, capability.body,
  );
  if (planStepUp) throw new ActionRefusalError(planStepUp, "step_up_required");
  capability.governance.precondition?.(
    { env: ctx.env, stepUp: ctx.stepUp === true }, before, capability.body,
  );

  // Only the FIRST step's edits are built here, because only they can be judged before the ledger row
  // exists — a refusal thrown from `buildEdits` leaves no row and dispatches nothing. Later steps of a
  // sequence build theirs at dispatch time against the document the previous step left behind, which
  // is the only document that can be right by then.
  const step = firstStep(capability);
  const edits = step.mutation.kind === "echo" ? step.mutation.buildEdits(doc, capability.body) : [];

  const { id } = await ledger.insertPending(ctx, {
    intent: capability.intent,
    capabilityKey: capability.capabilityKey,
    requestBody: capability.requestBody,
    target: capability.target,
    before: doc,
    edits,
  });

  return {
    mutationId: id,
    capability,
    before: doc,
    beforeSnapshot: before,
    edits,
    auditMeta: capability.governance.auditMeta?.(before, capability.body) ?? {},
  };
}

/**
 * The optimistic-concurrency check, and the document every later phase is compared against.
 *
 * Runs only for a card target, because `expectedVersion` is a property of the TARGET, not of every
 * write (docs/27 §3.1): a location group has no document and no version. Today the caller has already
 * refused every other kind, so this reads as an assertion — which is the honest shape. When the
 * second `LedgerAdapter` arrives, the branch that skips the check is a change to the CALLER, not a
 * loosening of this one.
 */
async function assertUnmoved<TBody>(
  ctx: CardMutationContext,
  capability: ResolvedCapability<TBody>,
  before: Snapshot,
) {
  const doc = before.doc;
  if (!doc) {
    // `getCardV2` throws rather than returning null, so this means a capability declared a card
    // target and then supplied a snapshot that does not read the card. Refuse: everything downstream
    // — the version check, the ledger row, drift classification — is a function of that document.
    throw new Error(`capability ${capability.capabilityKey ?? capability.intent} named a card target with no document`);
  }

  // The roster-only card (`card_version: ""`) never reaches this comparison — `cardVersionSchema` is
  // `min(16)`, so an empty expectation is refused by `accept()` before the vendor is dialled at all.
  // That refusal is `refuseRosterOnlyVersion` in `efs/router.ts`; see Step 7.5's note there.
  if (doc.version !== ctx.expectedVersion) {
    // Nothing is sent. The operator gets the fresh card and decides again — the only defence
    // available, since the guide offers no ETag and no row version.
    await updateMirror(ctx, doc);
    throw new CardControlError(
      "This card changed in EFS since the screen was drawn.",
      "card_state_changed",
      409,
      { currentVersion: doc.version, card: doc.card },
    );
  }
  return doc;
}
