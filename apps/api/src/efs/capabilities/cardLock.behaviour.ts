import { type CardLockBody, cardLockContract, efsStatusEquals } from "@fuelguard/shared";
import { lockEdits } from "../../services/efsCardEdits.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import { defineBehaviour } from "../types.js";

/**
 * How a lock is written, and how we decide it landed.
 *
 * Everything here is lifted verbatim from the hand-written handler in `routes/fuelCards/control.ts`,
 * including the two decisions that look like omissions and are not:
 *
 * **No step-up.** This is the safety action you want frictionless at 2am, it is fully reversible,
 * and friction here has a cost measured in stolen fuel. `preflightStepUp` and `planStepUp` are
 * absent deliberately — not forgotten. The gate that DOES exist on a status change is on unlock,
 * for a card EFS has flagged as Fraud, and it belongs to that capability.
 *
 * **No precondition.** Locking an already-locked card is a no-op echo, not an error. Refusing it
 * would mean a dispatcher acting on a stale screen gets a failure where nothing was wrong.
 */
export const cardLockBehaviour = defineBehaviour(cardLockContract, {
  target: { kind: "card" },

  mutation: {
    kind: "echo",
    /**
     * `doc.card.status` — the fresh IN-OPERATION read — is what supplies the casing. This account's
     * EFS stores `ACTIVE`; a write spelled `Hold` from the guide (p134) was accepted and silently
     * ignored, and the lock was recorded `failed` on a card that had not moved (incident 2026-08-12).
     * efsCardControl.test.ts proves it in "TRIPWIRE (H1)", which asserts the dispatched bytes rather
     * than a mock. The write is spelled the way THIS account spells
     * its statuses, which is a property of the document, not of the contract.
     */
    buildEdits: (doc, body: CardLockBody) => lockEdits(body.status, doc.card.status),
  },

  /**
   * The shared echo verification: re-read the card, ask whether the paths the edits NAMED moved.
   * Case-tolerant on a field we edited, so `Hold` answered as `HOLD` is a success and not a failure
   * — the other half of the same incident.
   */
  verify: cardEchoVerify<CardLockBody>(),

  /**
   * One of the two capabilities that genuinely undoes itself (Step 4.5).
   *
   * `Hold` rather than `Inactive`: it is the reversible one, and the revert writes back the status
   * EFS itself reported — byte-for-byte, so the way home also exercises this account's own casing on
   * the write path, which is the H1 hypothesis. A card already held would prove nothing, hence the
   * precondition; `efsStatusEquals` rather than `===`, because this account reports `HOLD`.
   */
  proof: {
    precondition: (snap) => !efsStatusEquals(snap.doc?.card.status ?? null, "Hold"),
    sample: (): CardLockBody => ({ status: "Hold", expectedVersion: "" }),
    revert: (snap) => ({
      // Never assume `Active`: a card proved from INACTIVE must go back to INACTIVE, and `card_lock`
      // can write it because Inactive is one of its own statuses. A card that started Active is
      // handled by the harness, which reverts through `card_unlock` when this returns a status
      // `card_lock` cannot write — see prove.ts.
      capability: efsStatusEquals(snap.doc?.card.status ?? null, "Active") ? "card_unlock" : "card_lock",
      body: efsStatusEquals(snap.doc?.card.status ?? null, "Active")
        ? { expectedVersion: "" }
        : { status: snap.doc?.card.status ?? "Inactive", expectedVersion: "" },
    }),
  },

  auditMeta: (snap, body: CardLockBody) => ({
    statusRequested: body.status,
    statusBefore: snap.doc?.card.status ?? null,
  }),
});
