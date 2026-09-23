import { EFS_VALIDATION_TYPES, PROMPT_INPUT_UNSET, type PromptsSetBody, promptsSetContract } from "@silvicom/shared";
import { promptsEdits } from "../services/efsCardEdits.js";
import { assertPromptRemovalAllowed } from "../routes/controlRefusal.js";
import { ActionRefusalError } from "../services/efsCardControlErrors.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import { assertOverrideDoesNotBlock } from "./overrideFreezeGuard.js";
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
    // A type outside the contract's enum cannot be carried faithfully, so the record is LEFT OUT —
    // and a record `replaceAll` is not handed stays exactly as it is on the card (`promptsEdits`).
    .filter((info) => (EFS_VALIDATION_TYPES as readonly string[]).includes(info.validationType ?? ""))
    .map((info) => ({
      infoId: info.infoId,
      /**
       * The card's OWN type, verbatim. This used to collapse everything that was not EXACT_MATCH to
       * REPORT_ONLY, and the revert is built from this same function — so a proof on a card with an
       * odometer prompt (ACCRUAL_CHECK) would have "restored" it as REPORT_ONLY and zeroed its value
       * (2026-09-23 review). The proof's whole claim is "exactly one field moved"; that includes
       * every record it writes back.
       */
      validationType: info.validationType as PromptsSetBody["prompts"][number]["validationType"],
      matchValue: info.matchValue,
      reportValue: info.reportValue,
      remove: false,
      // Length checks and bounds go back UNSET because `promptsEdits` keeps an existing record's own
      // `lengthCheck`/`minimum`/`maximum` untouched — only `value` is written from the body, and only
      // for ACCRUAL_CHECK, so that is the one carried from the card.
      ...PROMPT_INPUT_UNSET,
      value: info.validationType === "ACCRUAL_CHECK" ? accrualValue(info.value) : null,
    }));

const accrualValue = (raw: string | null): number | null => {
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

/**
 * Which prompt the proof flips: the first EXACT_MATCH record that has a value, or -1.
 *
 * ONE direction only, on purpose. EXACT_MATCH → REPORT_ONLY stops the pump checking an entry, so a
 * card left that way by a failed revert still fuels. The reverse makes the pump demand a value the
 * driver may not type, and a failed revert would strand them. It also had to stop being "whatever is
 * first": most prompts on the production account are REPORT_ONLY with no value (1,012 of 1,367 on
 * 2026-09-23), and flipping one of those to EXACT_MATCH is a body the contract refuses — which is
 * exactly how the first production prompts proof failed.
 */
const flipIndex = (prompts: PromptsSetBody["prompts"]): number =>
  prompts.findIndex((p) => p.validationType === "EXACT_MATCH" && (p.matchValue ?? "").length > 0);

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
   * Voided when the card has no editable EXACT_MATCH prompt with a value to flip (`flipIndex`):
   * there is nothing safe to change, so the run stops before anything is sent.
   */
  proof: {
    precondition: (snap, ctx) => flipIndex(proofPrompts(snap, ctx)) >= 0,
    sample: (snap, ctx): PromptsSetBody => {
      const prompts = proofPrompts(snap, ctx);
      const flip = flipIndex(prompts);
      return {
        expectedVersion: "",
        replaceAll: true,
        allowRemoveDriverId: false,
        /**
         * The value moves into `reportValue`; it is not dropped. `promptsEdits` blanks `matchValue` on
         * any non-EXACT_MATCH record, which is the vendor's own shape: on 2026-09-23, 0 of 152 mirrored
         * REPORT_ONLY records carried a matchValue and 151 carried a reportValue. The old flip left
         * both blank. Its revert failed on ••••6122 (proof `efe2b98a`), and after that "669" existed
         * nowhere in EFS, only in our ledger. Carried across, a card left behind by a failed revert
         * still holds its value where the WEX portal shows it, so putting it back is a type change.
         */
        prompts: prompts.map((p, i) =>
          (i === flip ? { ...p, validationType: "REPORT_ONLY" as const, reportValue: p.matchValue } : p)),
      };
    },
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
    /**
     * FIRST, before the prompt-source and removal checks (docs/22 H16).
     *
     * An armed override makes EFS silently ignore this write, so the other two refusals would be
     * deciding whether to permit a change that cannot happen — and a `step_up_required` raised below
     * would ask an operator for a password to authorise nothing.
     */
    assertOverrideDoesNotBlock("prompts_set", snap);
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
