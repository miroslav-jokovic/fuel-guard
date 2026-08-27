import {
  CARD_UNLOCK_STEP_UP,
  type CardUnlockBody,
  cardUnlockContract,
  cardUnlockNeedsStepUp,
  efsStatusEquals,
} from "@silvicom/shared";
import { unlockEdits } from "../services/efsCardEdits.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import { assertOverrideDoesNotBlock } from "./overrideFreezeGuard.js";
import { defineBehaviour } from "../types.js";
import { statusIsRevertible, statusRevert } from "./statusRevert.js";

/**
 * The one sentence this gate may say. Shared so the refusal and its test cannot drift apart.
 *
 * An ALIAS as of Step 6.1: sentence and predicate moved together to `efs/stepUp.ts`, where the
 * drawer reads both to warn before an operator presses Confirm. Kept under this name because the
 * behaviour test asserts against it, and re-exported rather than re-declared so there is still
 * exactly one string.
 */
export const FRAUD_STEP_UP = CARD_UNLOCK_STEP_UP;

/**
 * Releasing a card, and the one status change that is not the safe direction.
 *
 * ── The fraud gate moved, and it moved to the source of truth ────────────────────────────────────
 * The hand-written handler asked TWICE. First against `efs_cards.status` — our mirror — to prompt
 * early, then against the document EFS returned inside the operation, which is the decision that
 * counts (audit P1-7). Only the second survives here, and `docs/27` §3.4 is explicit about why: this
 * gate needs "the card's CURRENT status, not the mirror's".
 *
 * That is a behaviour change and it is the point. The mirror is stale by construction in both
 * directions: it can demand a password for a card WEX cleared an hour ago, and it cannot see a card
 * flagged since the last sweep. A check built from a different source than the thing it checks,
 * resolving the permissive way, is the shape five defects in this workstream have shared
 * (`docs/29` §7) — and here it was guarding the same decision as an authoritative check sitting six
 * lines below it.
 *
 * What it cost: the early refusal now spends one `getCardv2` before answering. It never saved a
 * rate-limit slot — the mirror read ran AFTER `prepare()` — so the only loss is one vendor call on a
 * path that should be rare, and what is bought is that the answer is right.
 */
export const cardUnlockBehaviour = defineBehaviour(cardUnlockContract, {
  target: { kind: "card" },

  mutation: {
    kind: "echo",
    /** Spelled from the fresh read's own casing, exactly as the lock is (incident 2026-08-12). */
    buildEdits: (doc) => unlockEdits(doc.card.status),
  },

  verify: cardEchoVerify<CardUnlockBody>(),

  /**
   * **Undone by `card_lock`, not by itself** — the case that corrected `ProofPlan.revert`.
   *
   * Needs a card that is NOT already active, which on a healthy fleet is the rarer starting state;
   * OEG-3 voids the run rather than pretending, because unlocking an active card reports success
   * without any write ever having landed. The revert restores the exact status observed, so a card
   * proved from `HOLD` goes back to HOLD and not to Inactive.
   *
   * The routing moved to `statusRevert.ts` on 2026-08-16, which also fixed what it SENT: the observed
   * spelling went verbatim into a case-sensitive enum, so `HOLD` was refused by `card_lock`'s own
   * schema and the card stayed unlocked. This capability had never been proved, so Step 8.2 would
   * have been the first run to hit it. See that file's header.
   */
  proof: {
    precondition: (snap) =>
      !efsStatusEquals(snap.doc?.card.status ?? null, "Active")
      // Fraud and Deleted pass the test above and cannot be written back by anything, so a run
      // starting there would unlock a real card and have no way home (standing rule 14).
      && statusIsRevertible(snap.doc?.card.status ?? null),
    sample: (): CardUnlockBody => ({ expectedVersion: "" }),
    revert: (snap) => {
      const { capability, body } = statusRevert(snap);
      return { capability, body: { ...body, expectedVersion: "" } };
    },
  },

  /**
   * Runs after the fresh read and before the ledger row opens, so a refusal leaves nothing behind.
   *
   * `efsStatusEquals`, never `===`: this account reports `FRAUD` upper-cased, and an exact
   * comparison waved the unlock straight past the gate it exists to demand. That comparison is now
   * `cardUnlockNeedsStepUp` (Step 6.1) — the SAME predicate the drawer warns from, differing only in
   * what it is handed. This one gets the document EFS just returned; the drawer only has the mirror,
   * which is why its warning is a courtesy and this remains the decision.
   */
  /**
   * H16: an armed override makes EFS silently ignore a status change, so an unlock on such a card did
   * nothing and reported "the card is unchanged". Refused rather than swallowed.
   *
   * Ahead of `planStepUp` in effect if not in source order — the orchestrator runs step-up decisions
   * and the precondition around the same fresh read, and the important property is that a card with an
   * exception never reaches the dispatch. Unlike lock, there is no `clearException` way through: an
   * unlock is not urgent in the way a lock is, so a refusal naming the exception is the honest answer.
   */
  precondition: (_ctx, snap) => assertOverrideDoesNotBlock("card_unlock", snap),

  planStepUp: (ctx, snap) =>
    (!ctx.stepUp && cardUnlockNeedsStepUp(snap.doc?.card.status ?? null) ? CARD_UNLOCK_STEP_UP : null),

  auditMeta: (snap) => ({
    statusBefore: snap.doc?.card.status ?? null,
    // Read from the document EFS just returned, not from the mirror the old handler also consulted.
    // One source, so the audit row cannot disagree with the gate that let the write through.
    unlockedFromFraud: efsStatusEquals(snap.doc?.card.status ?? null, "Fraud"),
  }),
});
