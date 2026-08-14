import { type CardLockBody, cardLockContract } from "@fuelguard/shared";
import { EFS_CARD_STATUS_LABELS } from "@fuelguard/shared";
import { defineView, row } from "./types.js";

/**
 * What an operator reads before a card stops working.
 *
 * The prose is lifted WORD FOR WORD from `lockConfirmation` in `cardControlModel.ts`. Step 3.5 moves
 * where it lives, not what it says: a pilot that reworded the confirmation would make "did the
 * migration change anything?" unanswerable, and this is the last screen between a dispatcher and a
 * driver stranded at a pump.
 *
 * `cardControlModel.ts` keeps `lockConfirmation` until Step 3.6 moves the remaining four and the
 * drawer switches to reading views. Two copies of one sentence is a real cost, and it is bounded and
 * deliberate — the alternative is rewiring the drawer in the same commit that migrates the first
 * capability, which is exactly the ambiguity the pilot exists to avoid.
 */
export const cardLockView = defineView(cardLockContract, {
  confirmation: (body: CardLockBody) =>
    body.status === "Inactive"
      ? {
          tone: "danger",
          title: "Deactivate this card?",
          body:
            "The card stops working at every location immediately, and deactivating is how a card is retired rather than paused. " +
            "Fuel purchases will decline until somebody activates it again.",
          confirmLabel: "Deactivate card",
          busyLabel: "Deactivating…",
          doneLabel: "Card deactivated",
        }
      : {
          tone: "danger",
          title: "Lock this card?",
          body:
            "The card stops working at every location immediately. Fuel purchases will decline until you unlock it.",
          confirmLabel: "Lock card",
          busyLabel: "Locking…",
          doneLabel: "Card locked",
        },

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
