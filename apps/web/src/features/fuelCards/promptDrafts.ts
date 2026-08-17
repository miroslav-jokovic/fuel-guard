import { EFS_EDITABLE_INFO_IDS, PROMPT_INPUT_UNSET, type EfsEditableInfoId, type PromptInput } from "@fuelguard/shared";
import type { OperationCard } from "./cardOperations";

/**
 * Turning a card's prompt records into editable drafts, and back.
 *
 * Split out of `cardOperations.ts` when Step 9.2 pushed that file past the 500-line budget. The cut
 * is along the seam Phase 9 is actively widening: these three are the only functions in that file
 * that decide WHICH prompts an operator may touch, and every remaining step of this phase (9.3's
 * accrual input, 9.4's infoSource precondition, 9.6's add/edit/remove) changes them and nothing else.
 *
 * ⚠ Still keyed on `EFS_EDITABLE_INFO_IDS`, the hardcoded DRID/UNIT pair. Step 9.1 made the editable
 * set an ACCOUNT fact resolved server-side, and the browser cannot see it yet — no endpoint carries
 * `editableInfoIds` to the client. Until one does, this file narrows the UI to the old pair while the
 * API would accept 24, which is a real gap and is recorded here rather than in a comment nobody
 * reads. Closing it is the remaining half of 9.1, and 9.6 needs it.
 */

/** The editable prompts the card HAS. */
export const editableInfoIds = (card: OperationCard): EfsEditableInfoId[] =>
  EFS_EDITABLE_INFO_IDS.filter((id) => (card.infos ?? []).some((info) => info.infoId === id));

/** The editable prompts the card LACKS — what `promptAdd` can offer. */
export const missingEditableInfoIds = (card: OperationCard): EfsEditableInfoId[] =>
  EFS_EDITABLE_INFO_IDS.filter((id) => !(card.infos ?? []).some((info) => info.infoId === id));

/**
 * The card's prompts as editable drafts.
 *
 * Everything outside the editable set is echoed untouched by the API — and a `replaceAll` carrying
 * an info id this account does not allow is refused by `promptsEdits` (Step 9.1c), while silently
 * dropping the rest is what deletes a driver assignment (guide p137).
 */
export const promptDrafts = (
  rows: readonly { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }[],
): PromptInput[] =>
  rows
    .filter((p) => (EFS_EDITABLE_INFO_IDS as readonly string[]).includes(p.infoId))
    .map((p) => ({
      infoId: p.infoId,
      validationType: p.validationType === "REPORT_ONLY" ? "REPORT_ONLY" : "EXACT_MATCH",
      matchValue: p.matchValue,
      reportValue: p.reportValue,
      remove: false,
      ...PROMPT_INPUT_UNSET,
    }));
