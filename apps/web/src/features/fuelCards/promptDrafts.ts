import { EFS_EDITABLE_INFO_IDS, PROMPT_INPUT_UNSET, type CardCapabilities, type PromptInput } from "@fuelguard/shared";
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

/**
 * The card's prompts as editable drafts.
 *
 * Everything outside the editable set is echoed untouched by the API — and a `replaceAll` carrying
 * an info id this account does not allow is refused by `promptsEdits` (Step 9.1c), while silently
 * dropping the rest is what deletes a driver assignment (guide p137).
 */
export const promptDrafts = (
  rows: readonly { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }[],
  allowed: readonly string[],
): PromptInput[] =>
  rows
    .filter((p) => allowed.includes(p.infoId))
    .map((p) => ({
      infoId: p.infoId,
      validationType: p.validationType === "REPORT_ONLY" ? "REPORT_ONLY" : "EXACT_MATCH",
      matchValue: p.matchValue,
      reportValue: p.reportValue,
      remove: false,
      ...PROMPT_INPUT_UNSET,
    }));
