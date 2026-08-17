import { PROMPT_INPUT_UNSET, type PromptsSetBody, promptsSetContract } from "@fuelguard/shared";
import { promptsEdits } from "../../services/efsCardEdits.js";
import { assertPromptRemovalAllowed } from "../../routes/fuelCards/controlRefusal.js";
import { ActionRefusalError } from "../../services/efsCardControlErrors.js";
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
 * records back and changes exactly one field. Filtered to `ctx.editableInfoIds` — the set Step 9.1
 * resolves from the ACCOUNT, not the `EFS_EDITABLE_INFO_IDS` constant this comment named until
 * 2026-08-17 — because a `replaceAll` carrying an info id nobody may edit would be refused by the
 * contract's own schema, and silently dropping the rest is what deletes a driver assignment
 * (guide p137). PR #80 fixed the code; the comment still described the constant.
 */
const proofPrompts = (snap: Snapshot, ctx: EditsCtx): PromptsSetBody["prompts"] =>
  (snap.doc?.card.infos ?? [])
    .filter((info) => ctx.editableInfoIds.includes(info.infoId))
    .map((info) => ({
      infoId: info.infoId,
      validationType: info.validationType === "EXACT_MATCH" ? "EXACT_MATCH" as const : "REPORT_ONLY" as const,
      matchValue: info.matchValue,
      reportValue: info.reportValue,
      remove: false,
      // The proof rewrites the card's OWN records and flips one validationType. It must not also
      // start configuring length checks or accruals, so every Step 9.2 field goes back unset — the
      // proof's whole claim is "exactly one field moved".
      ...PROMPT_INPUT_UNSET,
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
    precondition: (snap, ctx) => proofPrompts(snap, ctx).length > 0,
    sample: (snap, ctx): PromptsSetBody => ({
      expectedVersion: "",
      replaceAll: true,
      allowRemoveDriverId: false,
      prompts: proofPrompts(snap, ctx).map((p, i) => (i === 0
        ? { ...p, validationType: p.validationType === "EXACT_MATCH" ? "REPORT_ONLY" as const : "EXACT_MATCH" as const }
        : p)),
    }),
    revert: (snap, ctx) => ({
      capability: "prompts_set",
      body: {
        expectedVersion: "",
        replaceAll: true, allowRemoveDriverId: false,
        prompts: proofPrompts(snap, ctx),
      },
    }),
  },

  precondition: (ctx: PlanCtx, snap: Snapshot, body: PromptsSetBody) => {
    assertCardPromptsAreWritable(snap);
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

/**
 * Step 9.4 — refuse a card-level prompt write on a card whose prompts come from the POLICY.
 *
 * ── The defect this closes, in the vendor's own words ───────────────────────────────────────────
 * `WSCardv2.header.infoSource` says where a card's prompts are read from: `CARD`, `POLICY` or
 * `BOTH`. On a `POLICY`-source card the card-level records are not what the pump consults, so a
 * `setCardv2` carrying them is **accepted and ignored** — the vendor's demonstrated response to
 * writes it does not want (audit W3, H1). The echo verifier cannot save us either: it re-reads the
 * card and finds the records it just wrote, because the card still STORES them. They simply do not
 * govern anything. So today this reports a clean landing for a change that will never reach a
 * driver at a pump.
 *
 * ── Why a refusal and not a warning ─────────────────────────────────────────────────────────────
 * The operator's intent — "make the pump ask this driver for their ID" — is unachievable through
 * this operation on this card, and no amount of retrying changes that. The fix is a policy edit,
 * which this product does not do. Reporting success is the failure; reporting a warning beside a
 * success is the same failure with a footnote.
 *
 * `invalid_request`, not `step_up_required`: no amount of re-authentication makes the write land.
 *
 * ── ⚠ NOT covered by a live proof, and the plan says why ────────────────────────────────────────
 * Step 9.4's Verify wants this checked on a real card. **Neither account has one**: every card on
 * both orgs reads `infoSource: BOTH` (`efsCardOps.ts`, Step 7.3), which is the finding that has
 * blocked the `infoSource=POLICY` fixture since Step 0.13. So this is proven offline against
 * `getCardV2.empty.xml` — a captured document that really does carry `POLICY` — and the live half
 * stays open. An offline proof of a refusal is worth more than it sounds: the branch either throws
 * on that document or it does not.
 *
 * `BOTH` is deliberately allowed. The card's own records ARE consulted under `BOTH`, which is why
 * every prompt write this product has ever landed was on a `BOTH` card.
 */
function assertCardPromptsAreWritable(snap: Snapshot): void {
  const source = snap.doc?.card.infoSource;
  // Absent is ALLOWED, not refused. A card document without the field is an older shape or a
  // parse we did not model, and refusing on "we could not tell" would block every prompt write
  // the moment the vendor renamed a header field. The removal gate above is the one that must
  // fail closed; this one guards against a silent no-op, and a silent no-op is not a safety
  // property worth breaking the feature over.
  if (source === null || source === undefined) return;
  if (source.trim().toUpperCase() !== "POLICY") return;
  throw new ActionRefusalError(
    "This card takes its prompts from the policy, so a card-level change would be accepted by EFS "
      + "and never used at the pump. Change the policy instead.",
    "invalid_request",
  );
}
