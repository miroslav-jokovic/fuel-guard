import type { CardEdit } from "../../lib/efsCardEcho.js";
import type { CardDocument } from "../../lib/efsCardXml.js";
import { setCardV2, type SetCardResult } from "../../lib/efsCardWrite.js";
import { EfsSoapError } from "../../lib/efsSoapSession.js";
import { cardOpOptions } from "../../services/efsCardOperationOptions.js";
import {
  finalizeFailed,
  finalizeLanded,
  finalizePartial,
  finalizeUnsent,
  finalizeUnverified,
  updateMirror,
} from "../../services/efsCardReconcile.js";
import { sleepWithAbort } from "../../services/efsCardWriteDeadline.js";
import type { Landing, ReadCtx, Snapshot } from "../types.js";
import type { LedgerAdapter } from "./ledger.js";
import { isSequenced, stepsOf } from "./steps.js";
import type {
  CardMutationContext,
  CardMutationOutcome,
  CardMutationPlan,
  ResolvedCapability,
  ResolvedStep,
  SettleFacts,
} from "./types.js";

/**
 * Send the write, then find out what actually happened.
 *
 * There is exactly one exit path per outcome and all of them write the ledger, the audit log and the
 * mirror. Nothing here swallows an exception: an error that escapes this function leaves a row in
 * 'pending' or 'sent', which is a visible unresolved state rather than a lost one.
 *
 * ── The five outcomes, and why "we don't know" is one of them ────────────────────────────────────
 *
 *   intent landed, nothing else moved   → succeeded
 *   intent landed, other fields moved   → drift_detected  (+ audit card.drift_detected)
 *   intent did not land                 → failed          (+ the vendor's own fault text)
 *   the verification could not tell     → sent            (+ audit card.mutation_unverified)
 *   a later step of a sequence failed   → partial         (+ audit card.mutation_partial)
 *
 * `sent` is terminal and is surfaced to operators as "Unverified". A `setCardV2` timeout is NOT a
 * failure — the write may have landed — so it is never retried and never reported as "nothing
 * happened". A mutation whose result nobody knows is exactly the thing a human needs to go and check,
 * and the one thing this system must never do is decide on their behalf that it was fine.
 *
 * `partial` is the fifth, added in Step 3.4 with the step loop (docs/27 §5.1, migration 0190). It is
 * terminal but ACTIONABLE: some steps applied, one did not, and the recovery is to re-run from
 * `step_index` — not to re-run the whole thing, which would re-apply what already landed.
 *
 * ── The mirror is updated in EVERY branch, including failure ─────────────────────────────────────
 * A refused write still teaches us the card's true state. EFS always wins; the mirror follows; the
 * ledger records that it moved. The reverse — pushing our expectation back at EFS — is never done.
 */
export async function applyCardMutation<TBody>(
  ctx: CardMutationContext,
  plan: CardMutationPlan<TBody>,
  ledger: LedgerAdapter,
): Promise<CardMutationOutcome> {
  const { capability } = plan;
  const steps = stepsOf(capability);
  const sequenced = isSequenced(capability);
  const read: ReadCtx = { env: ctx.env, creds: ctx.creds, cardNumber: ctx.cardNumber, opts: cardOpOptions(ctx) };

  /** Every edit the whole mutation named. Drift is judged across the mutation, not the last step. */
  const allEdits: CardEdit[] = [...plan.edits];
  let beforeSnapshot = plan.beforeSnapshot;
  let beforeDoc = plan.before;
  let landedSteps = 0;
  let last: { after: CardDocument; wire: DispatchOutcome } | null = null;

  for (const [index, step] of steps.entries()) {
    await ledger.markSent(ctx, plan.mutationId, sequenced ? index : null);

    // Step 0's edits were built in `plan`, before the ledger row opened, because a refusal thrown
    // from `buildEdits` must leave no row. Every later step builds its own against the document the
    // previous step actually left behind — the only document that can be right by then.
    const edits = index === 0
      ? plan.edits
      : step.mutation.kind === "echo" ? step.mutation.buildEdits(beforeDoc, capability.body) : [];
    if (index > 0) allEdits.push(...edits);

    const facts = settleFacts(plan, allEdits, sequenced ? { index, label: step.label } : null);
    const sent = await dispatchStep(ctx, read, step, beforeDoc, edits, capability.body);

    // `echo_unfaithful` is the exception: the request was never sent, so there is nothing to
    // reconcile and no reason to spend a vendor call proving it. Our bug, recorded as ours.
    if (sent.writeError?.code === "echo_unfaithful") {
      return landedSteps === 0
        ? await finalizeUnsent(ctx, ledger, facts, sent.writeError)
        : await finalizePartial(ctx, ledger, facts, null, sent);
    }

    // ALWAYS re-read. This is what turns "EFS returned 200" into "the card says Hold".
    const verified = await verifyStep(ctx, read, step, beforeSnapshot, edits, capability.body);

    if (!verified.after?.doc) {
      const wire = { ...sent, readError: verified.readError };
      return landedSteps === 0
        // Null, and the branch guarantees it: this is the "the re-read itself failed" route, the
        // original reason `unverified` exists. The other call site DOES have a document.
        ? await finalizeUnverified(ctx, ledger, facts, wire, null)
        : await finalizePartial(ctx, ledger, facts, null, wire);
    }

    // The mirror follows EFS in every branch, success or failure — fed from the verifying read itself
    // rather than a fourth vendor call (audit B5.1). Best effort: a mirror write that fails must not
    // turn a completed, correctly-recorded mutation into an error.
    await updateMirror(ctx, verified.after.doc);

    if (verified.landing !== "landed") {
      if (landedSteps > 0) return await finalizePartial(ctx, ledger, facts, verified.after.doc, sent);
      // "We could not tell" is not "it did not land". Recording the second as the first would invite
      // an operator to retry a change that may already be on the card.
      return verified.landing === "indeterminate"
        ? await finalizeUnverified(ctx, ledger, facts, { ...sent, readError: INDETERMINATE }, verified.after.doc)
        : await finalizeFailed(ctx, ledger, facts, verified.after.doc, sent);
    }

    landedSteps += 1;
    beforeSnapshot = verified.after;
    beforeDoc = verified.after.doc;
    last = { after: verified.after.doc, wire: sent };
  }

  // `firstStep` refuses an empty sequence in `plan`, before a row is ever opened, so a loop that ran
  // to completion has a last step. Throwing rather than asserting: a mutation that dispatched nothing
  // must never settle `succeeded`.
  if (!last) throw new Error(`mutation ${plan.mutationId} dispatched no steps`);
  return await finalizeLanded(ctx, ledger, settleFacts(plan, allEdits, null), last.after, last.wire);
}

/** Held rather than thrown, so the ledger can say WHY a verification came back undecided. */
const INDETERMINATE = new Error("the verifying re-read could not tell whether the change landed");

interface DispatchOutcome {
  requestXmlRedacted: string | null;
  responseXmlRedacted: string | null;
  writeError: EfsSoapError | null;
}

/**
 * What the settle phase is told. `edits` is the accumulated set, not the step's, because drift is a
 * property of the whole mutation: a sequence that changed the card in step 0 and something else in
 * step 1 has not drifted just because the last step did not name step 0's fields.
 */
function settleFacts<TBody>(
  plan: CardMutationPlan<TBody>,
  edits: readonly CardEdit[],
  step: { index: number; label: string } | null,
): SettleFacts {
  const capability: ResolvedCapability<TBody> = plan.capability;
  return {
    mutationId: plan.mutationId,
    intent: capability.intent,
    before: plan.before,
    edits,
    auditMeta: plan.auditMeta,
    auditAction: capability.auditAction,
    vendorMovesFields: capability.vendorMovesFields,
    stepIndex: step?.index ?? null,
    stepLabel: step?.label ?? null,
  };
}

/**
 * One step's wire write, chosen by `mutation.kind` rather than by inspecting the operation.
 *
 * `echo` is the only kind that reaches the echo engine, and going through `setCardV2` is what gets it
 * `assertEchoFidelity`, the `replaceAll` preservation assertion and WSCardv2 sequence checking. A
 * `direct` step names its own op and has no document in the request to get wrong.
 *
 * A dispatch failure is NOT the end of the story. A timeout may have landed, a decline may not have,
 * and only the re-read can tell the difference — so the error is HELD here, not thrown.
 */
async function dispatchStep<TBody>(
  ctx: CardMutationContext,
  read: ReadCtx,
  step: ResolvedStep<TBody>,
  beforeDoc: CardDocument,
  edits: readonly CardEdit[],
  body: TBody,
): Promise<DispatchOutcome> {
  try {
    const result: SetCardResult = step.mutation.kind === "echo"
      // `read.opts` is the same options object the reads use — interactive lane, the operation's
      // deadline — and `setCardV2` hardcodes `retry: false` on top of it. The capability never gets
      // to choose either (docs/27 §4).
      ? await setCardV2(ctx.env, ctx.creds, beforeDoc, ctx.cardNumber, edits, read.opts)
      : await step.mutation.dispatch(read, body);
    return {
      requestXmlRedacted: result.requestXmlRedacted,
      responseXmlRedacted: result.responseXmlRedacted,
      writeError: null,
    };
  } catch (error) {
    if (!(error instanceof EfsSoapError)) throw error;
    return { requestXmlRedacted: null, responseXmlRedacted: null, writeError: error };
  }
}

/**
 * Re-read, judge, and look a SECOND time before believing a "no".
 *
 * setCardv2's success response is void (WSDL: zero-part setCardv2Response), so an installation that
 * applies writes with any lag makes the immediate re-read see the OLD document — recording a
 * successful lock as `failed` and inviting the operator to retry a change that already landed, the
 * exact double-write this whole design exists to prevent (audit P0-2, incident 2026-08-12). One more
 * read after a pause is the cheapest defence; the pause is configurable so Phase 0's measured apply
 * latency can tune it (0 disables, tests only).
 *
 * The read is `step.verify.snapshot`, so a step whose state lives outside the card document reads
 * that state too — which is what removes the need for a capability "kind" per extra read op.
 */
async function verifyStep<TBody>(
  ctx: CardMutationContext,
  read: ReadCtx,
  step: ResolvedStep<TBody>,
  before: Snapshot,
  edits: readonly CardEdit[],
  body: TBody,
): Promise<{ after: Snapshot | null; landing: Landing; readError: unknown }> {
  let after: Snapshot | null = null;
  let readError: unknown = null;
  try {
    after = await step.verify.snapshot(read);
  } catch (error) {
    readError = error;
  }
  if (!after?.doc) return { after, landing: "indeterminate", readError: readError ?? INDETERMINATE };

  let landing = step.verify.judge(before, after, body, edits);

  const verifyRetryMs = ctx.env.EFS_CARD_VERIFY_RETRY_MS ?? 3_000;
  if (landing !== "landed" && verifyRetryMs > 0) {
    await sleepWithAbort(verifyRetryMs, ctx.signal);
    try {
      const second = await step.verify.snapshot(read);
      if (second.doc) {
        after = second;
        landing = step.verify.judge(before, second, body, edits);
      }
    } catch {
      // The first re-read stands. It succeeded and is a complete verification on its own; a failed
      // second look must not downgrade a verified `failed` into an unverified `sent`.
    }
  }

  return { after, landing, readError };
}
