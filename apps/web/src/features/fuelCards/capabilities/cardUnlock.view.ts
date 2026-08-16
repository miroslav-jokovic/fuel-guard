import {
  CARD_UNLOCK_STEP_UP,
  EFS_CARD_STATUS_LABELS,
  cardUnlockContract,
  cardUnlockNeedsStepUp,
  efsStatusEquals,
} from "@fuelguard/shared";
import { defineView, row } from "./types.js";

/**
 * Releasing a card, said two ways because it is two different decisions.
 *
 * Prose lifted word for word from `unlockConfirmation`, which Step 6.4 deleted. What changed is
 * where `wasFraud` comes from: the model took it as an argument the caller computed, and the view
 * derives it from the card the drawer is already showing. One less thing a call site can get wrong,
 * and the tone, title and body then cannot disagree with each other.
 */
export const cardUnlockView = defineView(cardUnlockContract, {
  confirmation: (_body, card) => {
    // efsStatusEquals, never ===: this account reports FRAUD upper-cased, and an exact comparison
    // would show the ordinary copy for the one case that most needs the stronger wording.
    const wasFraud = efsStatusEquals(card.card.status, "Fraud");
    return {
      tone: wasFraud ? "danger" : "warning",
      title: wasFraud ? "Unlock a card flagged for fraud?" : "Unlock this card?",
      body: wasFraud
        // Somebody — WEX, or this product's own detection — decided this card was being abused.
        // Releasing it is not the reversible safety action a lock is, and the copy should not
        // pretend otherwise.
        ? "This card is flagged for fraud. Unlocking it lets fuel purchases go through again at every location it is allowed to use. Confirm your password to continue."
        : "Fuel purchases will go through again at every location this card is allowed to use.",
      confirmLabel: "Unlock card",
      busyLabel: "Unlocking…",
      doneLabel: "Card unlocked",
    };
  },

  diff: (before) => [row("Status", statusLabel(before.status), statusLabel("Active"))],

  /**
   * Predicted from the MIRROR's status; `planStepUp` decides from the document EFS returns at write
   * time. A card flagged since the last sweep is therefore one this will not warn about — the
   * drawer's `step_up_required` fallback is what covers that, and it stays.
   */
  stepUp: (_body, card) => (cardUnlockNeedsStepUp(card.card.status) ? CARD_UNLOCK_STEP_UP : null),
});

const statusLabel = (status: string | null): string => {
  if (!status) return "Unknown";
  const known = Object.entries(EFS_CARD_STATUS_LABELS)
    .find(([value]) => value.toLowerCase() === status.toLowerCase());
  return known ? known[1] : status;
};
