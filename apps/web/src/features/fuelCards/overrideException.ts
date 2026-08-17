import { overrideBlocksWrite } from "@fuelguard/shared";
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
  `Also remove the fuel exception (${uses === 1 ? "1 purchase" : `${uses} purchases`} left)`;

/**
 * Why the operator is being asked at all. Sits under the checkbox rather than in a tooltip — the same
 * rule invariant 6 applies to the Confirm button's blocker.
 */
export const CLEAR_EXCEPTION_HELP =
  "EFS ignores a status change while an exception is armed, so the card would not actually lock. "
  + "Removing it is the only way the change applies.";

/**
 * What sits with the disabled Confirm button when the box is unticked (invariant 6: the SENTENCE,
 * never a boolean — a disabled button whose tooltip says "invalid" tells an operator to go hunting).
 */
export const CLEAR_EXCEPTION_BLOCKER =
  "Tick “Also remove the fuel exception” — EFS will ignore the status change while one is armed.";

/**
 * The clause the confirmation gains, so the destruction is named on the same screen as the button
 * that causes it. `allowRemoveDriverId`'s rule: never inferred, always said out loud.
 */
export const clearExceptionClause = (uses: number): string =>
  ` Its fuel exception (${uses === 1 ? "1 purchase" : `${uses} purchases`} left) will be removed at the `
  + "same time, and that cannot be undone from here — a new exception has to be granted.";

/**
 * The status operation's blocker — invariant 6's SENTENCE, and the reason the checkbox exists.
 *
 * Here rather than in `cardOperations.ts` so it sits beside the checkbox label and help text it has to
 * agree with: the button says "tick the box", the box says what it does, and one file owns both. It
 * also keeps that file under the 500-line budget, which is the seam `promptDrafts.ts` and
 * `operationDrafts.ts` were cut along before it.
 *
 * ⚠ This does NOT block — it is the way through. The checkbox turns it off, and the write then carries
 * the exception out in the same request. A capability with no such offer (unlock, deactivate, prompts)
 * gets a flat refusal from the API instead, which is the Option A / Option B split.
 */
export const statusBlocker = (draft: OperationDraft, card: OperationCard): string | null =>
  (cardHasArmedException(card.overrideUses) && !draft.clearException ? CLEAR_EXCEPTION_BLOCKER : null);
