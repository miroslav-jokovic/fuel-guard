import { type CardLockBody, cardLockContract } from "@fuelguard/shared";
import { EFS_CARD_STATUS_LABELS } from "@fuelguard/shared";
import { defineView, row } from "./types.js";
import { cardHasArmedException, clearExceptionClause } from "../overrideException.js";

/**
 * What an operator reads before a card stops working.
 *
 * The prose was lifted WORD FOR WORD from `lockConfirmation` in `cardControlModel.ts`. Step 3.5
 * moved where it lives, not what it says: a pilot that reworded the confirmation would have made
 * "did the migration change anything?" unanswerable, and this is the last screen between a
 * dispatcher and a driver stranded at a pump.
 *
 * Step 6.4 deleted the copy in `cardControlModel.ts` once `CardOperationDrawer.vue` began reading
 * views. This is now the only place the sentence exists; `capabilities/views.test.ts` asserts it.
 *
 * Step 8.1 removed the `Inactive` branch that used to sit beside this one. It has not been deleted —
 * it moved to `cardDeactivate.view.ts` word for word, along with the status that reaches it. This
 * view now has one branch because `lockCardSchema` has one value, and the type says so: `body.status`
 * is `"Hold"`, so a second branch would be unreachable code rather than a defensive one.
 */
export const cardLockView = defineView(cardLockContract, {
  confirmation: (body: CardLockBody, card) => ({
    tone: "danger",
    title: "Lock this card?",
    /**
     * The base sentence is untouched — Step 3.5's rule that this prose moves but never rewords.
     *
     * H16 adds a CLAUSE, and only when the operator ticked the box: the write will also destroy the
     * card's fuel exception, and the screen with the button on it is the only place that can say so.
     * `allowRemoveDriverId`'s rule — never inferred, always named — applied to the other destruction
     * this product can now perform.
     */
    body:
      "The card stops working at every location immediately. Fuel purchases will decline until you unlock it."
      + (body.clearException && cardHasArmedException(card.card.overrideUses)
        ? clearExceptionClause(card.card.overrideUses ?? 0)
        : ""),
    confirmLabel: "Lock card",
    busyLabel: "Locking…",
    doneLabel: "Card locked",
  }),

  /**
   * One row, matching the contract's `diffRows: ["status"]`.
   *
   * The BEFORE is whatever the card currently reads, unnormalised through the label table — this
   * account spells its statuses `ACTIVE` and `HOLD` (incident 2026-08-12), and a diff that quietly
   * title-cased them would hide the very mismatch that made a successful lock look like a failure.
   * `EFS_CARD_STATUS_LABELS` is consulted only when the value is one we recognise.
   */
  diff: (before, body: CardLockBody) => [
    row("Status", statusLabel(before.status), statusLabel(body.status)),
  ],
});

const statusLabel = (status: string | null): string => {
  if (!status) return "Unknown";
  const known = Object.entries(EFS_CARD_STATUS_LABELS)
    .find(([value]) => value.toLowerCase() === status.toLowerCase());
  return known ? known[1] : status;
};
