import { EFS_CARD_STATUS_LABELS, cardDeactivateContract, efsStatusEquals } from "@silvicom/shared";
import { defineView, row } from "./types.js";

/**
 * Retiring a card, said two ways because it is two different decisions.
 *
 * The prose for the Active case is lifted WORD FOR WORD from `cardLock.view.ts`'s `Inactive` branch,
 * which is where deactivation's copy lived while `card_lock` still wrote both statuses. Step 8.1 moved
 * where it lives, not what it says — a split that reworded the confirmation would have made "did the
 * split change anything an operator sees?" unanswerable.
 *
 * The Hold case is new, because it is the sentence the whole step was written for. A card on Hold is
 * already declining fuel, so "the card stops working immediately" is not true of it and would read as
 * a warning about something that already happened. What actually changes is that the pause becomes
 * permanent — and, per the step's own Verify, that it happens WITHOUT the card passing back through
 * Active on the way.
 *
 * ── No `stepUp` ─────────────────────────────────────────────────────────────────────────────────
 * Absent deliberately, and `CAPABILITIES_WITH_STEP_UP_GATE` asserts the absence from both sides: the
 * API's registry test derives the gated set from the behaviours, the web's from these views, and each
 * compares against that one hand-written pin. The reasoning is in the contract's header.
 */
export const cardDeactivateView = defineView(cardDeactivateContract, {
  confirmation: (_body, card) => {
    // efsStatusEquals, never ===: this account reports `HOLD` upper-cased (incident 2026-08-12), and
    // an exact comparison would show the wrong copy for the case this capability exists to serve.
    const wasHeld = efsStatusEquals(card.card.status, "Hold");
    return {
      tone: "danger",
      title: wasHeld ? "Retire this card from the fleet?" : "Deactivate this card?",
      body: wasHeld
        // It is already declining fuel; what changes is that this is now how it stays. And it gets
        // there directly — the card is never briefly spendable on the way, which is what made the old
        // unlock-then-deactivate sequence worth removing.
        ? "This card is already on hold, so nothing changes at the pump right now. Deactivating retires it for good — "
          + "it will not be re-enabled by lifting the hold, and it never becomes spendable on the way there."
        : "The card stops working at every location immediately, and deactivating is how a card is retired rather than paused. "
          + "Fuel purchases will decline until somebody activates it again.",
      confirmLabel: "Deactivate card",
      busyLabel: "Deactivating…",
      doneLabel: "Card deactivated",
      typeToConfirm: {
        label: "Type the last four digits of this card to confirm",
        // Names what is wrong AND what to do, per invariant 6. "Invalid" would send somebody hunting.
        mismatch: "Those digits do not match this card. Check the number in the header above.",
      },
    };
  },

  /**
   * One row, matching the contract's `diffRows: ["status"]`.
   *
   * The BEFORE is whatever the card currently reads, unnormalised through the label table — this
   * account spells its statuses `ACTIVE` and `HOLD`, and a diff that quietly title-cased them would
   * hide the very mismatch that made a successful write look like a failure (incident 2026-08-12).
   */
  diff: (before) => [row("Status", statusLabel(before.status), statusLabel("Inactive"))],
});

const statusLabel = (status: string | null): string => {
  if (!status) return "Unknown";
  const known = Object.entries(EFS_CARD_STATUS_LABELS)
    .find(([value]) => value.toLowerCase() === status.toLowerCase());
  return known ? known[1] : status;
};
