import { OVERRIDE_BLOCKED_CAPABILITIES, overrideBlockedMessage, overrideBlocksWrite } from "@silvicom/shared";
import type { OperationCard, OperationDraft } from "./cardOperations";

/**
 * The drawer's half of the override freeze (docs/22 H16) — what to offer, and what to say.
 *
 * ── Why this is its own module ──────────────────────────────────────────────────────────────────
 * `cardOperations.ts` and `CardOperationDrawer.vue` both sit within a line or two of the 500-line
 * budget, and this is a whole rule with its own vocabulary rather than two more lines of an existing
 * one. Same reasoning `efsCardSequence.ts` was split out of `efsCardEcho.ts` for.
 *
 * ── The prediction is EXACT here, unlike the step-up warning ─────────────────────────────────────
 * `stepUp`'s drawer prediction is a courtesy that can disagree with the server, because two of the
 * three gates decide from the card EFS returns at write time while the drawer reads the mirror. This
 * one has the same input problem — `overrideUses` comes from the mirror, which can be a sweep old —
 * but the consequence is different and worth being clear about: a card whose exception was granted
 * since the last sweep gets no checkbox, the operator presses Confirm, and the API refuses with the
 * same sentence. That is the drawer under-offering, never over-promising, and it is why the API
 * precondition reads the FRESH document and is the thing that actually decides.
 */

/** Whether this card's exception will make EFS ignore a status change. */
export const cardHasArmedException = (overrideUses: number | null | undefined): boolean =>
  overrideBlocksWrite(overrideUses);

/**
 * The checkbox's label. Names the COUNT, because "an exception" and "seven more free tanks" are
 * different decisions and only one of them is on the card.
 */
export const clearExceptionLabel = (uses: number): string =>
  `Also remove the fuel override (${uses === 1 ? "1 purchase" : `${uses} purchases`} left)`;

/**
 * Why the operator is being asked at all. Sits under the checkbox rather than in a tooltip — the same
 * rule invariant 6 applies to the Confirm button's blocker.
 */
export const CLEAR_EXCEPTION_HELP =
  "EFS ignores a status change while the card has an override, so the card would not actually go on hold. "
  + "Removing it is the only way the change applies.";

/**
 * What sits with the disabled Confirm button when the box is unticked (invariant 6: the SENTENCE,
 * never a boolean — a disabled button whose tooltip says "invalid" tells an operator to go hunting).
 */
export const CLEAR_EXCEPTION_BLOCKER =
  "Tick “Also remove the fuel override” — EFS ignores the status change while the card has one.";

/**
 * The clause the confirmation gains, so the destruction is named on the same screen as the button
 * that causes it. `allowRemoveDriverId`'s rule: never inferred, always said out loud.
 */
export const clearExceptionClause = (uses: number): string =>
  ` Its fuel override (${uses === 1 ? "1 purchase" : `${uses} purchases`} left) will be removed at the `
  + "same time, and that cannot be undone from here — a new override has to be granted.";

/**
 * Whether the drawer offers the "Also remove the fuel exception" checkbox — Hold alone (D-CCF2).
 *
 * Keyed on the capability the draft RESOLVES to, not on the operation: the status control writes
 * through three capabilities, and only `card_lock` carries `clearException`. Until CCF1
 * (2026-10-28) the box rendered for Active and Inactive too, the operator ticked it, and the API
 * refused the unlock or deactivate anyway with a different instruction — a way through that led
 * nowhere (`docs/plans/fuel/CARD-CONTROL-CORRECTIONS-PLAN.md` B2).
 */
export const offersClearException = (capabilityKey: string, overrideUses: number | null | undefined): boolean =>
  capabilityKey === "card_lock" && cardHasArmedException(overrideUses);

/**
 * The override freeze's blocker for ANY capability — invariant 6's SENTENCE.
 *
 * Here rather than in `cardOperations.ts` so it sits beside the checkbox label and help text it has to
 * agree with: the button says "tick the box", the box says what it does, and one file owns both. It
 * also keeps that file under the 500-line budget, which is the seam `promptDrafts.ts` and
 * `operationDrafts.ts` were cut along before it.
 *
 * Two answers, the Option A / Option B split:
 *   • `card_lock` — the checkbox is the way through, so the blocker asks for it and lifts once ticked.
 *   • every other capability in `OVERRIDE_BLOCKED_CAPABILITIES` (unlock, deactivate, prompts) — the
 *     sentence the API's `assertOverrideDoesNotBlock` refuses with, read from the same shared map and
 *     message, so the drawer says before Confirm exactly what the server would say after it.
 * A capability outside the map (grant, clear) is not frozen here; grant has its own blocker.
 */
export const overrideFreezeBlocker = (
  capabilityKey: string, draft: OperationDraft, card: OperationCard,
): string | null => {
  if (!cardHasArmedException(card.overrideUses)) return null;
  if (capabilityKey === "card_lock") return draft.clearException ? null : CLEAR_EXCEPTION_BLOCKER;
  const what = OVERRIDE_BLOCKED_CAPABILITIES[capabilityKey];
  return what ? overrideBlockedMessage(card.overrideUses ?? 0, what) : null;
};
