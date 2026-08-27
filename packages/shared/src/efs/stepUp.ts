import { CARD_OVERRIDE_STEP_UP_ABOVE_USES } from "../cardWriteLimits.js";
import { efsStatusEquals } from "../efsCardCatalog.js";

/**
 * WHICH card changes demand a fresh sign-in — one definition, read by the gate that enforces it and
 * the drawer that warns about it.
 *
 * ── Why this had to move out of the API (plan Step 6.1, invariant 5) ────────────────────────────
 * The invariant asks the drawer to PREDICT step-up rather than discover it from a `step_up_required`
 * refusal. The obvious two ways to do that are both wrong:
 *
 *   • Re-writing the rule in the web view is a second implementation of a security rule — standing
 *     rule 5. The two copies disagree the first time a threshold moves, and the failure is silent: a
 *     drawer that promises no password and then gets asked for one.
 *   • A preflight endpoint costs a round trip per keystroke and puts a network call between an
 *     operator and a label that is a pure function of what they just typed.
 *
 * So the rules live here, where both halves read the SAME function. `packages/shared` is already
 * browser-safe and already holds the contracts these bind to; nothing here does I/O, touches a
 * credential, or knows a card number. The API's `preflightStepUp` / `planStepUp` / `precondition`
 * hooks keep their different TIMINGS — that split is deliberate and documented in `efs/types.ts` —
 * and now delegate their PREDICATES here.
 *
 * ── The drawer's prediction is not always the server's answer, and that is fine ──────────────────
 * Only `override_grant` decides from the request body alone. The other two decide from the card EFS
 * returns at write time:
 *
 *   | capability       | server hook       | decides from                    | drawer predicts from |
 *   |------------------|-------------------|---------------------------------|----------------------|
 *   | `override_grant` | `preflightStepUp` | the body                        | the body — EXACT     |
 *   | `card_unlock`    | `planStepUp`      | the fresh document's status     | the mirror's status  |
 *   | `prompts_set`    | `precondition`    | records the write would remove  | the operator's edits |
 *
 * So a card flagged for fraud since the last sweep is one the drawer will not warn about. The
 * warning is therefore a courtesy, never a guarantee, and **the drawer must keep handling a
 * `step_up_required` refusal it did not predict** — removing that fallback in the name of this
 * invariant would turn a stale mirror into a dead end. What the shared rule buys is that the two can
 * only ever disagree about their INPUT, never about the rule.
 */

/** Vendor range is 1–9 (guide p194); above three is a decision somebody should have to prove. */
export const overrideGrantNeedsStepUp = (uses: number): boolean =>
  uses > CARD_OVERRIDE_STEP_UP_ABOVE_USES;

/** Exported so the gate, its test and the drawer's warning cannot drift apart. */
export const OVERRIDE_GRANT_STEP_UP =
  `Confirm your password to grant more than ${CARD_OVERRIDE_STEP_UP_ABOVE_USES} uses.`;

/**
 * A product-limit override needs a password however few uses it grants (Step 10.1).
 *
 * It is a destructive write in a way a scope-only grant is not: p194 replaces the card's product
 * limits with the override's, so one use of this deletes the caps the card was carrying. Same
 * reasoning as `promptRemovalNeedsStepUp` — EVERY explicit removal is destructive, not only a large
 * one.
 */
export const overrideLimitsNeedStepUp = (limitCount: number): boolean => limitCount > 0;

export const OVERRIDE_LIMITS_STEP_UP =
  "Confirm your password to override a product limit — this replaces the card's own limits.";

/**
 * WHICH message an override grant needs, or null — the whole gate for this capability in one place.
 *
 * ── Why the two reasons cannot share `OVERRIDE_GRANT_STEP_UP` ────────────────────────────────────
 * Until Step 10.1 there was one reason and therefore one string. Adding a second and reusing the
 * first would tell an operator granting ONE use of a ULSD exception "confirm your password to grant
 * more than 3 uses" — a sentence about a threshold they are nowhere near, for a rule they did not
 * trip. This codebase already keeps `PROMPT_REMOVAL_STEP_UP` separate from `CARD_UNLOCK_STEP_UP` for
 * exactly that reason: a step-up prompt has to say what actually demanded it, or the operator goes
 * looking for the wrong thing.
 *
 * The limits reason wins when both apply, because it names the destructive half. Returning a SENTENCE
 * rather than a boolean is what lets the drawer warn with the server's own words instead of guessing
 * which rule fired — the Step 6.1 shape, extended rather than worked around.
 */
export const overrideGrantStepUp = (body: { uses: number; limits?: readonly unknown[] }): string | null => {
  if (overrideLimitsNeedStepUp(body.limits?.length ?? 0)) return OVERRIDE_LIMITS_STEP_UP;
  if (overrideGrantNeedsStepUp(body.uses)) return OVERRIDE_GRANT_STEP_UP;
  return null;
};

/**
 * `efsStatusEquals`, never `===`: this account reports `FRAUD` upper-cased, and an exact comparison
 * waved the unlock straight past the gate it exists to demand (audit P1-7).
 */
export const cardUnlockNeedsStepUp = (status: string | null): boolean =>
  efsStatusEquals(status, "Fraud");

export const CARD_UNLOCK_STEP_UP =
  "This card is flagged for fraud. Confirm your password to unlock it.";

/**
 * EVERY explicit prompt removal is destructive, not only `DRID` — dropping any record stops the pump
 * asking for it. `DRID` additionally needs its named opt-in, which is a different refusal and stays
 * in `assertPromptRemovalAllowed`: a missing flag is `invalid_request`, a missing password is
 * `step_up_required`, and collapsing them tells somebody to re-authenticate when what they need is a
 * checkbox.
 */
export const promptRemovalNeedsStepUp = (removedInfoIds: readonly string[]): boolean =>
  removedInfoIds.length > 0;

export const PROMPT_REMOVAL_STEP_UP = "Confirm your password to remove a prompt.";

/**
 * WHICH capabilities have a step-up gate at all — the pin two independent derivations check against.
 *
 * A hand-written list, and deliberately so, for the same reason the API fitness test's
 * `EXPECTED_KEYS` is: it is the thing being compared, not a shortcut around comparing. What makes it
 * safe is that NEITHER side owns it. `apps/api` cannot import `apps/web`, so no single test can pair
 * a behaviour's gate with a view's warning; instead each side derives its own set from its own
 * registry and asserts equality with this one.
 *
 * Both halves: `apps/api/src/modules/efs/registry.test.ts` derives from the behaviours' governance hooks,
 * and `apps/web/src/features/fuelCards/capabilities/registry.test.ts` from the view registry. Adding
 * a gate to a behaviour without teaching the view to warn turns the web's red; teaching the view
 * without the gate turns the API's red. Either way somebody has to come here and say what they meant.
 *
 * `card_lock` is absent and that is an assertion: locking is the 2am safety action, friction there
 * has a cost measured in stolen fuel, and it must never demand a password.
 */
export const CAPABILITIES_WITH_STEP_UP_GATE: readonly string[] = [
  "card_unlock",
  "override_grant",
  "prompts_set",
];

/**
 * WHICH capabilities refuse from state read at write time — a SEPARATE pin from the one above, and the
 * split is the point.
 *
 * `precondition` is not only a step-up hook. `prompts_set` uses it for both: a missing DRID opt-in is
 * `invalid_request`, a missing password is `step_up_required`. `card_lock` gained one in H16 that can
 * only ever raise the first — an armed override makes EFS silently ignore a status change, so the lock
 * is refused rather than swallowed.
 *
 * Before this split, `apps/api/src/modules/efs/registry.test.ts` derived "has a gate" from the presence of a
 * `precondition` and
 * compared it against the step-up pin, so adding lock's refusal demanded adding `card_lock` to that
 * list. That would have asserted something FALSE and load-bearing: the list's own comment says lock is
 * absent deliberately because *"locking is the 2am safety action … and it must never demand a
 * password"*, and the web half would then have made the drawer promise a password prompt that never
 * comes. A pin is only worth having if what it pins is true.
 *
 * So there are two pins now, both hand-written, and neither is weaker than the single one was: adding
 * any precondition still forces an edit here, and adding a password demand still forces an edit above.
 */
export const CAPABILITIES_WITH_PRECONDITION: readonly string[] = [
  "card_deactivate",
  "card_lock",
  "card_unlock",
  /**
   * Step 10.3. Refuses a PRODUCT override on a `limitSource=POLICY` card — Step 9.4's refusal for
   * the other collection, and `invalid_request` only: no password makes a card-level write govern a
   * pump that reads the policy. A scope-only exception is untouched, so this never blocks the
   * ordinary grant.
   */
  "override_grant",
  "prompts_set",
];
