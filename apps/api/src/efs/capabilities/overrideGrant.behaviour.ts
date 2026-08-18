import {
  type OverrideGrantBody,
  efsStatusEquals,
  overrideBlocksWrite,
  overrideGrantBlockedMessage,
  overrideGrantContract,
  overrideGrantStatusMessage,
  overrideGrantStepUp,
} from "@fuelguard/shared";
import { overrideGrantEdits, overrideLimitsBefore } from "../../services/efsCardEdits.js";
import { unlandedEditNames } from "../../services/efsCardReconcile.js";
import { unlandedEditNamesFromAfter } from "../../lib/efsCardWrite.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import { ActionRefusalError } from "../../services/efsCardControlErrors.js";
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
const UNOBSERVABLE_GRANT_FIELDS: ReadonlySet<string> = new Set([
  "overrideAllLocations",
  "locationOverride",
  /**
   * ⚠ `limits` joined on 2026-08-18, from the production 10.4 run (limit-restore-production.json).
   *
   * With the override ARMED (uses 1, six-field ULSD probe accepted), getCardv2 still returned the
   * card's OWN record — ADD 40, autoRollMap 127 — not the override's. The override's limits live in
   * the vendor's override overlay, and the read path never echoes them. So an unlanded `limits`
   * edit after a grant is not evidence the cap failed to arm; it is what a WORKING product override
   * looks like through getCardv2. This is precisely how the 2026-08-18 QA grant (DSL 50 + ULSD 50)
   * came to be recorded `failed` while the card showed a use armed — the judge condemned the one
   * field this vendor never reports back.
   */
  "limits",
]);

/**
 * The count is the exception (guide p194): `override` is what authorises a purchase, and no
 * tolerance applies to it. A grant whose count did not land granted nothing and is a plain failure.
 */
const judgeGrant = (unlanded: readonly string[]): Landing => {
  if (unlanded.length === 0) return "landed";
  if (unlanded.some((name) => !UNOBSERVABLE_GRANT_FIELDS.has(name))) return "not_landed";
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
    buildEdits: (doc, body: OverrideGrantBody) =>
      overrideGrantEdits(doc, body.uses, body.scope, body.limits, body.allowHandEnter),
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
    /**
     * `limits: []` deliberately. The proof run grants a SCOPE-only exception, so it needs no password
     * (`overrideGrantStepUp` returns null) and the harness never has to hold one — the same reason
     * `uses: 1` sits at or below the threshold. A product-limit proof deletes the card's limits and
     * belongs to Step 10.4's supervised run against a named QA card, not to an automated probe.
     */
    sample: (): OverrideGrantBody => ({
      // `allowHandEnter: false` spelled out for `limits: []`'s reason and one of its own: the flag
      // writes a PERMANENT card setting, and an automated probe does not get to leave one behind.
      uses: 1, scope: { kind: "all" }, limits: [], allowHandEnter: false, expectedVersion: "",
    }),
    revert: () => ({
      capability: "override_clear",
      body: { expectedVersion: "" },
    }),
    /**
     * The Step 3.11 question — "proven adapter or permanent precondition" — answered on 2026-08-18:
     * a permanent property of the VENDOR, so the proof gate carries it instead of failing on it.
     * A grant's judge can never say `succeeded`: the scope pair reads `false`/`0` on all 234
     * mirrored cards after grants that provably armed (H2), and the production 10.4 run watched an
     * ARMED override while getCardv2 returned the card's own limits (docs/40 §1.3). The count — the
     * one observable field — landing is what `sent` already requires; anything less is `not_landed`
     * and still fails OEG-3.
     */
    sentAccepted: {
      reason: "this vendor never echoes an override's scope or limits through getCardv2 (H2; "
        + "docs/40 §1.3) — the count landed, and the count is the only observable field",
    },
  },

  /**
   * One free tank is an exception; four is a decision somebody should have to prove they made.
   *
   * The threshold test moved to `efs/stepUp.ts` in Step 6.1 so the drawer can WARN with the same
   * predicate this gate REFUSES with. The timing is unchanged and still the point: this runs before
   * `prepare()`, so a refusal never spends a slot against the daily override budget.
   */
  preflightStepUp: (body: OverrideGrantBody) => overrideGrantStepUp(body),

  /**
   * Step 9.4's guard, for LIMITS — the gap the 2026-08-18 QA session found.
   *
   * `WSCardv2.header.limitSource` says where a card's product caps are read from: `CARD`, `POLICY`
   * or `BOTH`. It is the exact twin of `infoSource`, which `promptsSet.behaviour.ts` has refused on
   * since Phase 9, and the failure is the same one: on a `POLICY`-source card the card-level records
   * are not what the pump consults, so a `setCardv2` carrying them is accepted and ignored.
   *
   * ⚠ And the echo verifier cannot save us, for the reason 9.4 spells out: the card still STORES the
   * records, so the re-read finds them and reports a clean landing for an override that will never
   * cap anything. A product exception that reports success and lets a driver buy without limit is
   * the expensive direction of this mistake.
   *
   * ── Why the accounts made this easy to miss ─────────────────────────────────────────────────────
   * QA policy 1 carries NO limits at all, and the QA cards in use sit on policy 1 (inventory,
   * 2026-08-18). Production policy 1 carries nine, including DSL 200 and ULSD 200. So the config an
   * operator sees in production comes from the POLICY, while the QA cards this was built against had
   * neither policy nor card limits — which is why a product override could be designed, shipped and
   * demonstrated without the question ever being asked.
   *
   * ── Only when the grant actually writes limits ──────────────────────────────────────────────────
   * A scope-only exception touches no limits and must stay available on every card, `POLICY`-source
   * included: it grants purchases outside the card's normal caps, wherever those caps come from.
   * `BOTH` is allowed for 9.4's reason — the card's own records ARE consulted under `BOTH`.
   *
   * Absent is ALLOWED, not refused, exactly as in 9.4: refusing on "we could not tell" would break
   * the feature the moment the vendor renamed a header field, and this guards a silent no-op rather
   * than a safety property.
   */
  precondition: (_ctx, snap, body: OverrideGrantBody) => {
    /**
     * Exceptions are for cards that can fuel — Miki's 2026-08-18 ruling, made after watching a
     * HOLD card ACCEPT a grant (the 10.5 proof run; the 10.4 drill before it). EFS lands the count
     * and the pump declines the card anyway, so the ledger would say "covered" about a driver who
     * is not. FIRST, ahead of every other refusal: on a non-Active card there is nothing to fix —
     * no exception to remove, no product line to clear — so any other sentence sends the operator
     * on an errand that ends here anyway. `efsStatusEquals`, never `===` (H1: this account spells
     * ACTIVE upper-case). Absent is allowed, as everywhere in this file.
     */
    const status = snap.doc?.card.status;
    if (status !== null && status !== undefined && !efsStatusEquals(status, "Active")) {
      throw new ActionRefusalError(overrideGrantStatusMessage(status), "invalid_request");
    }

    /**
     * No grant on a card already in override — Miki's 2026-08-18 ruling, and the vendor's own
     * behaviour three ways over (see `overrideFreeze.ts`'s `override_grant` block: the portal offers
     * no second override, H16's freeze makes a grant's non-trio fields — `limits`, `handEnter` —
     * liable to be silently swallowed, and a landing re-grant REPLACES the count rather than adding).
     *
     * Before the limitSource check: the card's state outranks the request's inputs, and an
     * operator told "remove the exception" should not first be told to clear their product lines.
     * Absent is allowed, as everywhere in this file: `plan` has its own handling for a failed read,
     * and a vendor blip must not become a claim that the card carries an exception.
     */
    const uses = snap.doc?.card.overrideUses ?? null;
    if (snap.doc !== null && overrideBlocksWrite(uses)) {
      throw new ActionRefusalError(overrideGrantBlockedMessage(uses ?? 0), "invalid_request");
    }

    if (body.limits.length === 0) return;
    const source = snap.doc?.card.limitSource;
    if (source === null || source === undefined) return;
    if (source.trim().toUpperCase() !== "POLICY") return;
    throw new ActionRefusalError(
      "This card takes its product limits from the policy, so a card-level product override would "
        + "be accepted by EFS and never used at the pump. Grant the exception without a product "
        + "limit, or change the policy instead.",
      "invalid_request",
    );
  },

  /**
   * `limitsBefore` is the recovery record, not decoration (Step 10.1).
   *
   * The override REPLACES the card's product limits (p194) and nothing in the guide promises EFS puts
   * them back when the exception is cleared. Step 10.4 asks the vendor that question live; this line
   * is what makes the answer survivable either way, because the records the write deleted are in the
   * audit row whichever way it goes.
   *
   * Taken from `snap.doc` — the document EFS returned inside THIS operation — never from the mirror,
   * which can be a sweep old. Same rule as `lockEdits`' status casing, and for the same reason.
   */
  auditMeta: (snap, body: OverrideGrantBody) => ({
    overrideUsesBefore: snap.doc?.card.overrideUses ?? null,
    overrideUsesAfter: body.uses,
    overrideScope: body.scope.kind,
    locationId: body.scope.kind === "location" ? body.scope.locationId : null,
    limitsBefore: snap.doc ? overrideLimitsBefore(snap.doc) : null,
    limitsAfter: body.limits,
    /** Recorded because it OUTLIVES the exception — the audit row is the only place that says a
     *  permanent card setting moved during what the operator thought was a temporary grant. */
    handEnterBefore: snap.doc?.card.handEnter ?? null,
    allowHandEnter: body.allowHandEnter,
  }),
});
