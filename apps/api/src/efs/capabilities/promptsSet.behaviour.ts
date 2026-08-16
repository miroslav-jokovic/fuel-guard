import { EFS_EDITABLE_INFO_IDS, type PromptsSetBody, promptsSetContract } from "@fuelguard/shared";
import { promptsEdits } from "../../services/efsCardEdits.js";
import { assertPromptRemovalAllowed } from "../../routes/fuelCards/controlRefusal.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import { defineBehaviour } from "../types.js";
import type { EditsCtx, PlanCtx, Snapshot } from "../types.js";

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
/**
 * The card's own editable prompts, in the shape this capability's body wants them.
 *
 * Rebuilt from the observed document rather than invented, so a proof run writes the card's REAL
 * records back and changes exactly one field. Filtered to `EFS_EDITABLE_INFO_IDS` because a
 * `replaceAll` carrying an info id nobody may edit would be refused by the contract's own schema —
 * and silently dropping the rest is what deletes a driver assignment (guide p137).
 */
const proofPrompts = (snap: Snapshot): PromptsSetBody["prompts"] =>
  (snap.doc?.card.infos ?? [])
    .filter((info): info is typeof info & { infoId: (typeof EFS_EDITABLE_INFO_IDS)[number] } =>
      (EFS_EDITABLE_INFO_IDS as readonly string[]).includes(info.infoId))
    .map((info) => ({
      infoId: info.infoId,
      validationType: info.validationType === "EXACT_MATCH" ? "EXACT_MATCH" as const : "REPORT_ONLY" as const,
      matchValue: info.matchValue,
      reportValue: info.reportValue,
      remove: false,
    }));

export const promptsSetBehaviour = defineBehaviour(promptsSetContract, {
  target: { kind: "card" },

  mutation: {
    kind: "echo",
    buildEdits: (doc, body: PromptsSetBody, ctx) => promptsEdits(doc, body.prompts, ctx.editableInfoIds).edits,
  },

  verify: cardEchoVerify<PromptsSetBody>(),

  /**
   * The other self-undoing capability: `replaceAll` back to the records the card already had.
   *
   * The sample flips ONE prompt's `validationType` rather than adding or removing a record —
   * `EXACT_MATCH` is what makes the pump validate a driver's entry, so flipping it to `REPORT_ONLY`
   * and back is observable, reversible, and cannot strand a driver even if the revert fails. A
   * proof that added a prompt would consume the reserved empty-`<infos>` card permanently (docs/24
   * §3.3), and one that removed a DRID would trip this capability's own removal precondition.
   *
   * Voided when the card has no editable prompt to flip: there is nothing to change, so a write
   * would be a no-op reported as a landing.
   */
  proof: {
    precondition: (snap) => proofPrompts(snap).length > 0,
    sample: (snap): PromptsSetBody => ({
      expectedVersion: "",
      replaceAll: true,
      allowRemoveDriverId: false,
      prompts: proofPrompts(snap).map((p, i) => (i === 0
        ? { ...p, validationType: p.validationType === "EXACT_MATCH" ? "REPORT_ONLY" as const : "EXACT_MATCH" as const }
        : p)),
    }),
    revert: (snap) => ({
      capability: "prompts_set",
      body: {
        expectedVersion: "",
        replaceAll: true, allowRemoveDriverId: false,
        prompts: proofPrompts(snap),
      },
    }),
  },

  precondition: (ctx: PlanCtx, snap: Snapshot, body: PromptsSetBody) => {
    const plan = planFor(snap, body, ctx);
    assertPromptRemovalAllowed(plan.removedInfoIds, body.allowRemoveDriverId, ctx.stepUp);
  },

  auditMeta: (snap: Snapshot, body: PromptsSetBody, ctx: EditsCtx) => {
    const plan = planFor(snap, body, ctx);
    return { promptsBefore: plan.before, promptsAfter: plan.after, removedInfoIds: plan.removedInfoIds };
  },
});

/**
 * `promptsEdits` runs three times per request — precondition, auditMeta, buildEdits — as it already
 * ran twice in the hand-written handler. It is a pure diff over a parsed document with no vendor
 * call and no allocation worth naming, and the alternative is a cache on the snapshot that can go
 * stale between the gate and the write. Recomputing from the same document is the cheaper mistake.
 */
const planFor = (snap: Snapshot, body: PromptsSetBody, ctx: EditsCtx) => {
  if (!snap.doc) throw new Error("prompts_set requires a card document");
  return promptsEdits(snap.doc, body.prompts, ctx.editableInfoIds);
};
