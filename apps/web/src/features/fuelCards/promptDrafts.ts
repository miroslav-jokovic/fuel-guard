import {
  EFS_EDITABLE_INFO_IDS,
  PROMPT_INPUT_UNSET,
  type CardCapabilities,
  type EfsLimitOption,
  type PromptInput,
  infoLabel,
  resolveLimitVocabulary,
} from "@silvicom/shared";
import type { OperationCard } from "./cardOperations";

/**
 * Turning a card's prompt records into editable drafts, and back.
 *
 * Split out of `cardOperations.ts` when Step 9.2 pushed that file past the 500-line budget. The cut
 * is along the seam Phase 9 is actively widening: these three are the only functions in that file
 * that decide WHICH prompts an operator may touch, and every remaining step of this phase (9.3's
 * accrual input, 9.4's infoSource precondition, 9.6's add/edit/remove) changes them and nothing else.
 *
 * ── Step 9.1's client half, closed 2026-08-17 ───────────────────────────────────────────────────
 * This file used to key off `EFS_EDITABLE_INFO_IDS`, the hardcoded DRID/UNIT pair, because no
 * endpoint carried the account's real set to the browser: the API accepted twenty-four ids and the
 * drawer offered two. The set now rides on `capabilities.editableInfoIds`, computed server-side by
 * the same `resolveEditableInfoIds` the write path uses.
 *
 * `allowed` is a REQUIRED parameter on all three, deliberately. A default would have let a call site
 * silently keep the old pair — which is precisely the bug being closed, and it would have been
 * invisible at exactly the call sites that forgot.
 */

/**
 * The account's editable prompt ids, or the fallback when the server has not said.
 *
 * One function rather than `caps?.editableInfoIds ?? EFS_EDITABLE_INFO_IDS` repeated at four call
 * sites — the drawer, the blocker and both pages — because the fallback is a claim about what an
 * unread account permits, and four copies is four places for that claim to drift from the server's
 * (standing rule 5). The value it falls back to is what `resolveEditableInfoIds(null)` answers on
 * the API side, so the two halves agree by construction rather than by coincidence.
 *
 * The fallback fires only for an API deploy predating the field. The server always sends it.
 */
export const allowedInfoIdsFrom = (
  capabilities: Pick<CardCapabilities, "editableInfoIds"> | null | undefined,
): readonly string[] => capabilities?.editableInfoIds ?? EFS_EDITABLE_INFO_IDS;

/** The editable prompts the card HAS. */
export const editableInfoIds = (card: OperationCard, allowed: readonly string[]): string[] =>
  allowed.filter((id) => (card.infos ?? []).some((info) => info.infoId === id));

/** The editable prompts the card LACKS — what `promptAdd` can offer. */
export const missingEditableInfoIds = (card: OperationCard, allowed: readonly string[]): string[] =>
  allowed.filter((id) => !(card.infos ?? []).some((info) => info.infoId === id));

type PromptRow = { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null };

/**
 * The two ways of treating an entry that the drawer's form can express. The vendor has seven
 * (guide p36); the other five carry bounds or an accrual the form has no field for.
 */
export const FORM_VALIDATION_TYPES = ["EXACT_MATCH", "REPORT_ONLY"] as const;
type FormValidationType = (typeof FORM_VALIDATION_TYPES)[number];
const formType = (type: string | null): FormValidationType | null =>
  (FORM_VALIDATION_TYPES as readonly string[]).includes(type ?? "") ? (type as FormValidationType) : null;

/**
 * The card's prompts as editable drafts.
 *
 * Everything outside the editable set is echoed untouched by the API — and a `replaceAll` carrying
 * an info id this account does not allow is refused by `promptsEdits` (Step 9.1c), while silently
 * dropping the rest is what deletes a driver assignment (guide p137).
 *
 * ── A prompt whose type the form cannot express is LEFT OUT, not retyped (2026-11-16) ────────────
 * This mapped every type that was not REPORT_ONLY to EXACT_MATCH. A card-level odometer prompt
 * (ACCRUAL_CHECK, no match value) therefore became "EXACT_MATCH with nothing to match", which the
 * contract refuses — so no prompt on that card could be saved at all — and a NUMERIC prompt would have
 * been rewritten as EXACT_MATCH by a save that never showed it changing. A record the request does
 * not name is written back exactly as EFS sent it (`promptsEdits`), which is the API's own rule for
 * the same case in a proof run (`proofPrompts`). `untouchedPrompts` lists what was left out.
 * Production carried no such card-level prompt when this was written: 1,765 records, 455
 * EXACT_MATCH and 1,310 REPORT_ONLY.
 */
export const promptDrafts = (rows: readonly PromptRow[], allowed: readonly string[]): PromptInput[] =>
  rows
    .filter((p) => allowed.includes(p.infoId) && formType(p.validationType) !== null)
    .map((p) => ({
      infoId: p.infoId,
      validationType: formType(p.validationType)!,
      matchValue: p.matchValue,
      reportValue: p.reportValue,
      remove: false,
      ...PROMPT_INPUT_UNSET,
    }));

/** The prompts a save does not name: outside the account's editable set, or of a type the form cannot express. */
export const untouchedPrompts = <T extends PromptRow>(rows: readonly T[], allowed: readonly string[]): T[] =>
  rows.filter((p) => !allowed.includes(p.infoId) || formType(p.validationType) === null);

/**
 * Change how the pump treats a prompt, keeping the value the operator can see.
 *
 * EFS keeps a prompt's value in one of two fields: `matchValue` when the pump checks the entry,
 * `reportValue` when it only records it (production, 2026-11-16: all 455 EXACT_MATCH records carry a
 * matchValue and no reportValue; all 1,310 REPORT_ONLY records the reverse). The form showed whichever
 * field belonged to the chosen type, and the choice used to change the type alone — so switching a
 * prompt emptied the box, and a save then either blanked the value in EFS (to "report only") or was
 * refused for having none (to "must match"). The same loss is what stranded unit 669 on card ••6122
 * when the first production prompts proof could not revert (2026-09-23); the proof was taught to carry
 * the value across then, and the form was not.
 */
export const withValidationType = (prompt: PromptInput, validationType: FormValidationType): PromptInput => {
  if (prompt.validationType === validationType) return prompt;
  const shown = (prompt.validationType === "REPORT_ONLY" ? prompt.reportValue : prompt.matchValue) ?? "";
  return validationType === "REPORT_ONLY"
    ? { ...prompt, validationType, matchValue: null, reportValue: shown }
    : { ...prompt, validationType, matchValue: shown, reportValue: null };
};

/**
 * Why Save is refused when a prompt is set to "must match" with nothing to match, or null.
 *
 * The contract refuses that record ("EXACT_MATCH needs a value to match"), because a pump told to
 * check an entry against nothing declines every entry. The Edit form had no such check of its own, so
 * Save stayed enabled and the operator met the contract's sentence as a failed request.
 */
export const unmatchablePromptBlocker = (prompts: readonly PromptInput[]): string | null => {
  const empty = prompts.find((p) => !p.remove && p.validationType === "EXACT_MATCH" && !(p.matchValue ?? "").trim());
  return empty
    ? `Enter the value the driver must type for ${infoLabel(empty.infoId)}, or set it to report only.`
    : null;
};

/**
 * The account's limit vocabulary, or the fallback when the server has not said — Step 10.3.
 *
 * Deliberately the same shape as `allowedInfoIdsFrom` above, including the reason: the fallback is
 * a claim about what an unread account can cap, and it must be the SAME claim the API makes. It
 * falls back to `resolveLimitVocabulary(null)` — the guide's transcribed table — which is exactly
 * what the server answers for an org that has never been walked.
 *
 * ⚠ The picker must key off THIS and never off `EFS_LIMIT_LABELS` directly. That table is our
 * transcription of the guide (60 ids); this account carries 73 groups, fifteen of which the table
 * does not contain. Reading the table directly is Phase 9.1's defect, one phase later — the API
 * would accept an id the drawer could not offer, silently.
 *
 * Lives beside the prompt accessor rather than in `cardOperations.ts` because the two answer the
 * same question about two vocabularies, and the next person to change one should see the other.
 */
export const allowedLimitsFrom = (
  capabilities: Pick<CardCapabilities, "limitOptions"> | null | undefined,
): readonly EfsLimitOption[] => capabilities?.limitOptions ?? LIMIT_VOCABULARY_FALLBACK;

/**
 * Computed once at module load, not per call. `resolveLimitVocabulary(null)` walks the whole guide
 * table to build 60 objects, and this is read by every render of a picker that lists them.
 */
const LIMIT_VOCABULARY_FALLBACK: readonly EfsLimitOption[] = resolveLimitVocabulary(null);
