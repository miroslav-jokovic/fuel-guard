import { type CardDeactivateBody, cardDeactivateContract, efsStatusEquals } from "@silvicom/shared";
import { deactivateEdits } from "../services/efsCardEdits.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import { assertOverrideDoesNotBlock } from "./overrideFreezeGuard.js";
import { defineBehaviour } from "../types.js";
import { statusIsRevertible, statusRevert } from "./statusRevert.js";

/**
 * How a card is retired, and how we decide it landed.
 *
 * Everything mechanical here is `card_lock`'s, because it WAS `card_lock`'s until Phase 8.1 split
 * `Inactive` out of it. What is new is that the split makes the ledger say which of the two happened
 * — see the contract's header for why that was worth a migration.
 *
 * **No step-up**, deliberately, and the contract explains it at length: this is the fuel-STOPPING
 * direction, the same as a lock, and `CAPABILITIES_WITH_STEP_UP_GATE` asserts the absence from both
 * sides. The friction that belongs on a retirement is the view's typed last-four confirmation, which
 * defends against the failure this operation actually has — the wrong card, or meaning to pause.
 *
 * **No precondition.** Deactivating an already-inactive card is a no-op echo, not an error, exactly
 * as re-locking a held card is. Refusing it would hand a dispatcher acting on a stale screen a
 * failure where nothing was wrong. (The `proof` plan below has its own precondition, which is a
 * different question: whether the RUN would prove anything.)
 */
export const cardDeactivateBehaviour = defineBehaviour(cardDeactivateContract, {
  target: { kind: "card" },

  mutation: {
    kind: "echo",
    /**
     * Spelled from the fresh IN-OPERATION read, like every other status write. This account stores
     * `INACTIVE`; a write spelled `Inactive` from the guide would be accepted and silently ignored
     * (H1, incident 2026-08-12).
     */
    buildEdits: (doc) => deactivateEdits(doc.card.status),
  },

  verify: cardEchoVerify<CardDeactivateBody>(),

  /**
   * Undone by `card_unlock` or `card_lock`, never by itself — there is no capability that un-retires
   * a card to an arbitrary prior status, which is why the routing is shared with the other two
   * status capabilities in `statusRevert.ts`.
   *
   * OEG-3 voids a run on a card already Inactive: deactivating it reports success without any write
   * having landed, which is the H1 failure exactly.
   */
  proof: {
    precondition: (snap) =>
      !efsStatusEquals(snap.doc?.card.status ?? null, "Inactive")
      && statusIsRevertible(snap.doc?.card.status ?? null),
    sample: (): CardDeactivateBody => ({ expectedVersion: "" }),
    revert: (snap) => {
      const { capability, body } = statusRevert(snap);
      return { capability, body: { ...body, expectedVersion: "" } };
    },
  },

  /**
   * H16, same as the other two status writes: refused rather than silently swallowed. Retiring a card
   * is never the 2am action, so no `clearException` way through — a refusal that names the exception is
   * both honest and cheap here.
   */
  precondition: (_ctx, snap) => assertOverrideDoesNotBlock("card_deactivate", snap),

  auditMeta: (snap) => ({
    statusBefore: snap.doc?.card.status ?? null,
    /**
     * The case Phase 8.1 was written for, recorded as a fact rather than inferred later.
     *
     * A card retired straight from `Hold` never passed through `Active` on the way — which is what
     * the step's Verify asks ("a held card can be deactivated without first being unlocked"). Before
     * Phase 6.5 that sequence needed an unlock first, and the audit trail of those two writes is
     * indistinguishable from a deliberate re-activation followed by a retirement.
     */
    deactivatedFromHold: efsStatusEquals(snap.doc?.card.status ?? null, "Hold"),
  }),
});
