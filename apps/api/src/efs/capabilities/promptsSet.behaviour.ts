import { type PromptsSetBody, promptsSetContract } from "@fuelguard/shared";
import { promptsEdits } from "../../services/efsCardEdits.js";
import { assertPromptRemovalAllowed } from "../../routes/fuelCards/controlRefusal.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import { defineBehaviour } from "../types.js";
import type { PlanCtx, Snapshot } from "../types.js";

/**
 * Changing a card's prompts, and the one refusal that needs a COMPUTED value rather than a body.
 *
 * ── Why this is a `precondition` and not a step-up hook ──────────────────────────────────────────
 * `assertPromptRemovalAllowed` needs three things at once: which records the change would actually
 * REMOVE, the caller's explicit `allowRemoveDriverId`, and whether they re-authenticated. Only the
 * first is interesting — it is not in the body, it falls out of diffing the request against the card
 * EFS just returned. So the gate cannot run before the read, and `preflightStepUp` is the wrong
 * shape by construction (docs/27 §3.4 lists exactly this case).
 *
 * It throws rather than returning a verdict because it raises TWO different refusals — a missing
 * opt-in is `invalid_request`, a missing password is `step_up_required` — and collapsing them into
 * one boolean would tell somebody to re-authenticate when what they actually need is a flag.
 *
 * ── The decision is made against the FRESH document, never the mirror ────────────────────────────
 * A prompt removed in the WEX portal five minutes ago must not make this refuse, and one added there
 * must not slip through unauthorised. `precondition` runs after the fresh read and before the ledger
 * row opens, so a refusal leaves no row, no dispatch, and no half-finished record.
 */
export const promptsSetBehaviour = defineBehaviour(promptsSetContract, {
  target: { kind: "card" },

  mutation: {
    kind: "echo",
    buildEdits: (doc, body: PromptsSetBody) => promptsEdits(doc, body.prompts).edits,
  },

  verify: cardEchoVerify<PromptsSetBody>(),

  precondition: (ctx: PlanCtx, snap: Snapshot, body: PromptsSetBody) => {
    const plan = planFor(snap, body);
    assertPromptRemovalAllowed(plan.removedInfoIds, body.allowRemoveDriverId, ctx.stepUp);
  },

  auditMeta: (snap: Snapshot, body: PromptsSetBody) => {
    const plan = planFor(snap, body);
    return { promptsBefore: plan.before, promptsAfter: plan.after, removedInfoIds: plan.removedInfoIds };
  },
});

/**
 * `promptsEdits` runs three times per request — precondition, auditMeta, buildEdits — as it already
 * ran twice in the hand-written handler. It is a pure diff over a parsed document with no vendor
 * call and no allocation worth naming, and the alternative is a cache on the snapshot that can go
 * stale between the gate and the write. Recomputing from the same document is the cheaper mistake.
 */
const planFor = (snap: Snapshot, body: PromptsSetBody) => {
  if (!snap.doc) throw new Error("prompts_set requires a card document");
  return promptsEdits(snap.doc, body.prompts);
};
