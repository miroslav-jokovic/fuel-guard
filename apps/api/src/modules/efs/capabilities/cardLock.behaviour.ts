import {
  CARD_LOCK_OVERRIDE_BLOCKED,
  type CardLockBody,
  cardLockContract,
  efsStatusEquals,
  overrideBlocksWrite,
} from "@silvicom/shared";
import { lockEdits, overrideClearEdits } from "../services/efsCardEdits.js";
import { ActionRefusalError } from "../services/efsCardControlErrors.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import { defineBehaviour } from "../types.js";
import { statusIsRevertible, statusRevert } from "./statusRevert.js";

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
 * **No precondition on the STATUS.** Locking an already-locked card is a no-op echo, not an error.
 * Refusing it would mean a dispatcher acting on a stale screen gets a failure where nothing was wrong.
 *
 * ⚠ **There IS one precondition now, and it is about the override, not the status** (docs/22 H16,
 * 2026-08-17). An armed override makes EFS silently ignore a status change — proven live, with no
 * signal at the response layer — so a lock on such a card did nothing and said "the card is
 * unchanged". Lock is also the only capability offered a way THROUGH rather than a refusal, because a
 * refusal at 2am on a stolen card is the friction the no-step-up rule above exists to prevent: send
 * `clearException` and the exception leaves in the same write. It is never inferred.
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
    buildEdits: (doc, body: CardLockBody) => [
      ...lockEdits(body.status, doc.card.status),
      /**
       * The exception goes out in the SAME request as the status (docs/22 H16, Option B).
       *
       * Only when the operator asked (`clearException`) and only when there is one to remove, so an
       * ordinary lock is exactly the one write it has always been — no extra vendor call on the 2am
       * path, which a two-step sequence would have cost every caller to serve this one.
       *
       * ⚠ ONE UNPROVEN THING, stated rather than hidden: H16 proved a status-only write is ignored
       * while an override is armed, and that an override-only clear lands. It did NOT test a request
       * carrying BOTH, so whether EFS evaluates the status against the pre- or post-clear state is
       * unknown. The failure mode if it evaluates pre-clear is recoverable and loud, not silent: the
       * clear lands, the status does not, `cardEchoVerify` reports `status` unlanded, the row settles
       * `failed`, and the operator's next press succeeds because there is no longer an exception in
       * the way. Worth one probe to settle — docs/28 §10 carries it.
       */
      ...(body.clearException && overrideBlocksWrite(doc.card.overrideUses) ? overrideClearEdits() : []),
    ],
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
   * EFS itself reported, so the way home also exercises this account's own casing on the write path,
   * which is the H1 hypothesis. A card already held would prove nothing, hence the precondition;
   * `efsStatusEquals` rather than `===`, because this account reports `HOLD`.
   *
   * The revert routing moved to `statusRevert.ts` on 2026-08-16. It used to send the observed status
   * VERBATIM — `INACTIVE` into a case-sensitive enum — which the capability's own schema refused,
   * leaving the card changed. Its header has the full account.
   */
  proof: {
    precondition: (snap) =>
      !efsStatusEquals(snap.doc?.card.status ?? null, "Hold")
      // A card at Fraud or Deleted can be locked and then never put back, because no capability
      // writes either status. Void beats a proof that strands a real card (standing rule 14).
      && statusIsRevertible(snap.doc?.card.status ?? null)
      /**
       * ⚠ And a card carrying an override is VOID for this proof, not something to clear through.
       *
       * H16: the status would be silently ignored, so the run would report `not_landed` and read as
       * "this account cannot lock" — a false negative on the safest capability in the product. And
       * `clearException` is deliberately NOT set below: an automated probe does not get to destroy a
       * real exception to make its own precondition true.
       */
      && !overrideBlocksWrite(snap.doc?.card.overrideUses),
    sample: (): CardLockBody => ({ status: "Hold", clearException: false, expectedVersion: "" }),
    revert: (snap) => {
      const { capability, body } = statusRevert(snap);
      return { capability, body: { ...body, expectedVersion: "" } };
    },
  },

  /**
   * The lock's own refusal, and the one that offers a way through instead of a dead end.
   *
   * Not `assertOverrideDoesNotBlock` — that helper's message ends "remove the exception first, then
   * try again", which is the right sentence for the other four and the wrong one here: this capability
   * can remove it for you, so telling an operator to go elsewhere would be false as well as slow.
   */
  precondition: (_ctx, snap, body: CardLockBody) => {
    if (body.clearException) return;
    if (overrideBlocksWrite(snap.doc?.card.overrideUses)) {
      throw new ActionRefusalError(CARD_LOCK_OVERRIDE_BLOCKED, "invalid_request");
    }
  },

  /** `clearedException` is recorded because the write DESTROYED something — the audit row has to say
   *  so, the same way `removedInfoIds` does for a prompt removal. */
  auditMeta: (snap, body: CardLockBody) => ({
    statusRequested: body.status,
    statusBefore: snap.doc?.card.status ?? null,
      clearedException: body.clearException && overrideBlocksWrite(snap.doc?.card.overrideUses),
    overrideUsesBefore: snap.doc?.card.overrideUses ?? null,
  }),
});
