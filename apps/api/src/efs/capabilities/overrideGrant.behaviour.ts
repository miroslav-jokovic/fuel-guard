import {
  CARD_OVERRIDE_STEP_UP_ABOVE_USES,
  type OverrideGrantBody,
  overrideGrantContract,
  overrideStepUpMessage,
} from "@fuelguard/shared";
import { overrideGrantEdits } from "../../services/efsCardEdits.js";
import { unlandedEditNames } from "../../services/efsCardReconcile.js";
import { unlandedEditNamesFromAfter } from "../../lib/efsCardWrite.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import { defineBehaviour, type Landing } from "../types.js";

/**
 * The two fields this account has never once echoed back, and the reason a granted override was
 * recorded `failed`.
 *
 * ── The evidence, 2026-08-15 (docs/22 H2, docs/30 §6.A) ─────────────────────────────────────────
 * Three live QA grants of `override=1, overrideAllLocations=true` all landed the COUNT (0 → 1) and
 * all read `overrideAllLocations=false` back. Across every card either org has ever mirrored — 234
 * rows — `overrideAllLocations` is `false` 234 times and `true` zero times, and `locationOverride`
 * is null 234 times. Four checked-in fixtures agree, including `getCardV2.overridden.xml`, which HAS
 * an override armed. This vendor does not report card override SCOPE through `getCardv2`.
 *
 * ── Why this is `indeterminate` and not a tolerance ─────────────────────────────────────────────
 * Calling the write landed would assert a scope we cannot observe — and the expensive direction of
 * being wrong is the one `overrideGrantEdits` already names: the operator is told "at every
 * location" while the driver is declined everywhere. Calling it failed is what shipped, and it tells
 * the operator to retry a grant that worked, which grants a SECOND one. Neither is true, so the
 * capability says so: the row stays `sent`, the audit says `card.mutation_unverified`, and the
 * operator is told to go and look instead of to try again.
 *
 * Phase 4.4's config scanner is the instrument that settles whether the scope armed. Until it has,
 * this is the honest answer and NOT a resting place — the rows accumulate on the unresolved list on
 * purpose, where they are visible.
 */
const UNOBSERVABLE_SCOPE_FIELDS: ReadonlySet<string> = new Set([
  "overrideAllLocations",
  "locationOverride",
]);

/**
 * The count is the exception (guide p194): `override` is what authorises a purchase, and no
 * tolerance applies to it. A grant whose count did not land granted nothing and is a plain failure.
 */
const judgeGrant = (unlanded: readonly string[]): Landing => {
  if (unlanded.length === 0) return "landed";
  if (unlanded.some((name) => !UNOBSERVABLE_SCOPE_FIELDS.has(name))) return "not_landed";
  return "indeterminate";
};

const echoVerify = cardEchoVerify<OverrideGrantBody>();

/**
 * Granting a fuel exception, and the one gate in this codebase that runs on the body alone.
 *
 * `preflightStepUp` is answered before `prepare()`, so a caller who asks for more than three uses
 * without a fresh sign-in is refused WITHOUT spending a slot against their daily override budget —
 * twenty-five a day, and the refusal is for an action they were always allowed to take once they
 * re-authenticate. The hand-written handler got the order right by hand; here it is the type's
 * doing (docs/27 §3.4, and Step 3.5b's test asserts the counter is unmoved).
 */
export const overrideGrantBehaviour = defineBehaviour(overrideGrantContract, {
  target: { kind: "card" },

  mutation: {
    kind: "echo",
    /**
     * Three fields move together, per the p194 recipe: the use COUNT, the location id, and which
     * scope is armed. `overrideGrantEdits` owns that arithmetic — including refusing a location
     * scope of "0", the LOCATION_OVERRIDE_NONE sentinel that arms neither scope and declines the
     * driver everywhere while the ledger says they are covered (audit P1-6c).
     */
    buildEdits: (doc, body: OverrideGrantBody) => overrideGrantEdits(doc, body.uses, body.scope),
  },

  /**
   * `cardEchoVerify`'s reads, its own resolution. Both halves are overridden together and
   * deliberately: the background sweep re-judges a `sent` row through `reconcile`, so overriding
   * only `judge` would leave the sweep condemning, one sync cycle later, precisely the mutation the
   * live path declined to condemn.
   */
  verify: {
    snapshot: echoVerify.snapshot,
    judge: (before, after, _body, edits) => {
      if (!before.doc || !after.doc) return "indeterminate";
      return judgeGrant(unlandedEditNames(before.doc, after.doc, edits));
    },
    reconcile: (after, edits) => {
      if (!after.doc) return "indeterminate";
      return judgeGrant(unlandedEditNamesFromAfter(after.doc, edits));
    },
  },

  /**
   * **Undone by `override_clear`** — the second capability whose revert is a different capability.
   *
   * One use, all locations, on a card carrying no override. `uses: 1` deliberately sits at or below
   * `CARD_OVERRIDE_STEP_UP_ABOVE_USES`, so a proof run never needs a fresh sign-in and the harness
   * never has to hold a password.
   *
   * **This is the capability the whole harness was pulled forward for.** Step 4.4 proved
   * `overrideAllLocations` is never emitted by this account, so `judge` returns `indeterminate` and
   * OEG-3 cannot come back green from a live run either. That is the correct outcome and it is the
   * ANSWER: it distinguishes "the account rejects the scope" from "no card is resting in it", which
   * a fleet-at-rest scan can never do, and it is what decides whether Step 3.11 becomes a proven
   * adapter or a permanent precondition.
   */
  proof: {
    precondition: (snap) => (snap.doc?.card.overrideUses ?? 0) === 0,
    sample: (): OverrideGrantBody => ({
      uses: 1, scope: { kind: "all" }, expectedVersion: "", reason: "Capability proof run",
    }),
    revert: () => ({
      capability: "override_clear",
      body: { expectedVersion: "", reason: "Capability proof revert" },
    }),
  },

  /** One free tank is an exception; four is a decision somebody should have to prove they made. */
  preflightStepUp: (body: OverrideGrantBody) =>
    (body.uses > CARD_OVERRIDE_STEP_UP_ABOVE_USES ? overrideStepUpMessage : null),

  auditMeta: (snap, body: OverrideGrantBody) => ({
    overrideUsesBefore: snap.doc?.card.overrideUses ?? null,
    overrideUsesAfter: body.uses,
    overrideScope: body.scope.kind,
    locationId: body.scope.kind === "location" ? body.scope.locationId : null,
  }),
});
