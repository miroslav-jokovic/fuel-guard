import { PROMPT_INPUT_UNSET } from "@fuelguard/shared";
import {
  EFS_WRITABLE_STATUSES, efsStatusEquals, type EfsWritableStatus,
} from "@fuelguard/shared";
import type { CardOperationSpec, OperationCard, OperationDraft } from "./cardOperations";
import { missingEditableInfoIds, promptDrafts } from "./promptDrafts";

/**
 * Seeding an operation's draft from the card.
 *
 * Split out of `cardOperations.ts` when Step 9.6's third prompt action took that file past the
 * 500-line budget — the same seam and the same reason `promptDrafts.ts` left it at Step 9.2. The cut
 * is clean because nothing in `cardOperations.ts` calls this: the drawer does, three times, and the
 * import runs one way only.
 */

/**
 * A draft seeded from the card, including `promptAdd`'s new blank record.
 *
 * The new record joins `prompts` rather than sitting beside it, so the body is a plain `replaceAll`
 * of the whole array and nothing has to remember to merge the two — which is how an add turns into
 * a delete of everything else (guide p137).
 *
 * Pure, and out here rather than in the drawer, because the drawer calls it three times — on seed,
 * inside the dirty comparison, and on a 409 reseed — and a `dirty` check computing its baseline
 * differently from `seed()` reads TRUE on an untouched drawer. That is exactly the defect Step 6.1
 * shipped and `seededFor` had to paper over.
 */
export const seedDraftFor = (
  operation: CardOperationSpec | null,
  status: string,
  prompts: readonly { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }[],
  allowed: readonly string[],
): OperationDraft => {
  const base = { ...emptyDraft(status), prompts: promptDrafts(prompts, allowed) };
  /**
   * Seeded to the card's first editable prompt so the form opens on something, and the blocker still
   * demands a choice for a card whose editable set is empty.
   */
  if (operation?.id === "promptRemove") return { ...base, removeInfoId: base.prompts[0]?.infoId ?? null };
  if (operation?.id !== "promptAdd") return base;
  const addInfoId = missingEditableInfoIds({
    status, infos: prompts as OperationCard["infos"], limits: [],
    overrideUses: null, overrideAllLocations: null, locationOverrideId: null,
  }, allowed)[0] ?? null;
  return addInfoId === null ? base : {
    ...base,
    addInfoId,
    prompts: [...base.prompts, {
      infoId: addInfoId,
      // EXACT_MATCH by default: a prompt the pump only RECORDS stops nobody, and the operator can
      // downgrade it deliberately. Defaulting the other way makes the weaker choice the silent one.
      validationType: "EXACT_MATCH",
      ...PROMPT_INPUT_UNSET,
      matchValue: "",
      reportValue: null,
      remove: false,
    }],
  };
};

export const emptyDraft = (current: string | null = null): OperationDraft =>
  ({ targetStatus: currentWritableStatus(current), clearException: false, uses: 1, scopeKind: "all", location: null, limits: [], allowHandEnter: false, prompts: [], addInfoId: null, removeInfoId: null });

/**
 * The card's status as one of the three the operator may write, or `Active` when it is neither.
 *
 * A card sitting at `Fraud` or `Deleted` has no row in the list — those are not writable states —
 * so the draft has to start SOMEWHERE. It starts at Active, and `statusRows` marks the real state
 * separately, because silently pre-ticking a value the card is not at is how somebody presses Save
 * and changes a card they only meant to look at.
 */
export const currentWritableStatus = (status: string | null): EfsWritableStatus =>
  EFS_WRITABLE_STATUSES.find((s) => efsStatusEquals(s, status)) ?? "Active";
