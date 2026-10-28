import {
  CARD_UNLOCK_STEP_UP,
  EFS_CARD_STATUS_LABELS,
  cardUnlockContract,
  cardUnlockNeedsStepUp,
  efsStatusEquals,
} from "@silvicom/shared";
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
    // Q-CCF1 (a), 2026-10-28: Hold is the word. This capability writes Active from Hold OR Inactive,
    // so "take off hold" is said only for a held card; anything else is "make active".
    const wasHeld = efsStatusEquals(card.card.status, "Hold");
    return {
      tone: wasFraud ? "danger" : "warning",
      title: wasFraud ? "Make a card flagged for fraud active?" : wasHeld ? "Take this card off hold?" : "Make this card active?",
      body: wasFraud
        // Somebody — WEX, or this product's own detection — decided this card was being abused.
        // Releasing it is not the reversible safety action a lock is, and the copy should not
        // pretend otherwise.
        ? "This card is flagged for fraud. Making it active lets fuel purchases go through again at every location it is allowed to use. Confirm your password to continue."
        : "Fuel purchases will go through again at every location this card is allowed to use.",
      confirmLabel: wasHeld && !wasFraud ? "Take off hold" : "Make active",
      busyLabel: "Saving…",
      doneLabel: "Card active",
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
