/**
 * WHICH writes an armed override silently swallows, and what to tell the operator — one definition,
 * read by the API's preconditions and by the drawer that warns before Confirm.
 *
 * ── The finding this exists for (docs/22 H16, 2026-08-17, QA ••••7671) ───────────────────────────
 * Two byte-identical `<status>HOLD</status>` writes, same session, same card, same casing:
 *
 *   overrideUses 0  →  LANDED
 *   overrideUses 1  →  did NOT land, three readings over 11s, `version` unchanged
 *
 * The override was the only variable, so WEX's portal sentence — *"when a card is in override no
 * changes can be made to the card (i.e. status, add cash, etc.)"* — is true of the WEB SERVICE and not
 * merely of their screens. Nothing in the 200-page SOAP guide mentions it.
 *
 * ⚠ **And the vendor gives NO SIGNAL.** Both writes came back `responseShape: empty` with no fault —
 * the ignored one is indistinguishable from the applied one at the response layer. Only the verifying
 * re-read catches it, which is why this has to be a PRECONDITION rather than a better error message:
 * by the time we can tell, a rate-limit slot and a vendor call have been spent and the operator has
 * been told "EFS accepted the request but the card is unchanged", which names neither cause nor cure.
 *
 * ── The freeze is FIELD-scoped, and that is why this is not a blanket refusal ─────────────────────
 * In the same run, with an override armed, the echo `clear_override` LANDED and `deleteOverride`
 * LANDED. The override trio stays writable — it must, or no override could ever be cleared. So
 * `override_clear` and `delete_override` are deliberately absent from the blocked set below, and a
 * future capability that only touches the override fields belongs out of it too.
 */

/**
 * True when a card carrying this many override uses will swallow a non-override write.
 *
 * A card with `overrideUses: 0` but an armed SCOPE field is NOT frozen: the test that reproduced the
 * freeze had a live count, and `override` is what the vendor decrements on use (p194). Reading the
 * scope fields as "in override" here would refuse writes on the residue Step 6.2 exists to let
 * operators tidy up — `cardOperations.ts` offers Remove exception on exactly that state.
 */
export const overrideBlocksWrite = (overrideUses: number | null | undefined): boolean =>
  (overrideUses ?? 0) > 0;

/**
 * What the operator is told, per capability, because a refusal that does not name the remedy is a
 * dead end.
 *
 * Written per capability rather than generated from a verb, for the reason `refusal()` already
 * establishes in this codebase: a gate that fires with the wrong sentence sends a person to the wrong
 * place. The lock sentence is the one that had to be different — see `CARD_LOCK_OVERRIDE_BLOCKED`.
 */
export const overrideBlockedMessage = (uses: number, what: string): string =>
  `This card has a fuel exception with ${uses === 1 ? "1 purchase" : `${uses} purchases`} left, and EFS `
  + `silently ignores ${what} while an exception is armed. Remove the exception first, then try again.`;

/**
 * The lock's own sentence, and the one place this product offers to do it FOR the operator.
 *
 * ⚠ Locking is the 2am action for a stolen card. This codebase has kept it free of every kind of
 * friction on purpose — no reason required (decision B1), no step-up (`CAPABILITIES_WITH_STEP_UP_GATE`
 * omits it) — and a refusal that says "go and clear an exception, then come back" is exactly the
 * friction that rule exists to prevent, at the worst possible moment.
 *
 * So lock is the one capability that offers to clear the exception as part of the same action. That is
 * defensible HERE and nowhere else: an armed override on a card somebody is locking is free fuel on a
 * card they are trying to stop, so removing it serves the operator's intent rather than contradicting
 * it. It is still a destruction, so it is never inferred — `clearException` must be sent explicitly,
 * the confirmation names it, and the audit row records it (the `allowRemoveDriverId` pattern).
 */
export const CARD_LOCK_OVERRIDE_BLOCKED =
  "This card has a fuel exception, and EFS silently ignores a status change while one is armed. "
  + "Confirm removing the exception as part of locking the card.";

/**
 * Capabilities an armed override blocks, and the noun each refusal uses.
 *
 * A hand-written map, deliberately, for the same reason `CAPABILITIES_WITH_STEP_UP_GATE` is one: it is
 * the thing being compared rather than a shortcut around comparing. Adding a capability that writes
 * outside the override trio without adding it here is a capability that will be silently swallowed on
 * a card with an exception. `apps/api/src/efs/capabilities/cardLock.behaviour.test.ts` pins the
 * refusal for one that IS mapped and for one that is not.
 */
export const OVERRIDE_BLOCKED_CAPABILITIES: Readonly<Record<string, string>> = {
  card_lock: "a status change",
  card_unlock: "a status change",
  card_deactivate: "a status change",
  prompts_set: "a prompt change",
};

/**
 * ⚠ Two absences that are decisions, not omissions.
 *
 * `override_clear` and `delete_override` write only the override trio, and H16 watched BOTH land on a
 * card carrying an armed override. Blocking them would make an armed exception unclearable, which is
 * the one state this whole guard must never create.
 *
 * **`override_grant` is a THIRD absence — refused on an armed card, but with its OWN sentence.**
 *
 * Decided 2026-08-18 (Miki: *"we cant give grant on card that is already in override"*), and the
 * vendor agrees three ways over:
 *
 *   • The portal offers NO second override — its guide: *"If there is no button to select under
 *     'Override Card' the card is already in override"*, and the remedy it gives is `Remove
 *     Override` first. Mirroring the vendor (standing rule 10) means refusing here.
 *   • H16's freeze is field-scoped: the trio lands on an armed card, but a grant is not just the
 *     trio — Step 10.3 sends the `<limits>` collection and `handEnter`, neither of which H16 put on
 *     the safe list. A grant over an armed override therefore risks applying PARTIALLY, with the
 *     vendor's usual empty-success either way.
 *   • The live observation matches: on 2026-08-18 a drawer grant of DSL 50 + ULSD 50 on a QA card
 *     came back `failed` while the card afterwards showed `Override: 1 use left` — the count landed,
 *     the limits did not visibly follow.
 *
 * It stays OUT of `OVERRIDE_BLOCKED_CAPABILITIES` because the map's sentence — "EFS silently ignores
 * {what}" — is FALSE for a grant (H16 proved the count lands). The refusal lives in
 * `overrideGrant.behaviour.ts`'s precondition with `overrideGrantBlockedMessage` below, and it is
 * uniform: a scope-only grant writes only the trio and would land, but the portal refuses uniformly,
 * and a landing re-grant REPLACES the count rather than adding to it — an operator granting "one
 * more" on an armed card gets 1, not 2, with nothing saying so. Remove first, then grant.
 *
 * **The mileage override is not here either, and the first draft of this file had it wrong.** It is
 * `overrideLastMileage` — a unit-keyed operation that never touches `setCardv2` and takes no card
 * number at all (docs/37 §3). The freeze is a property of writes to a CARD, so a unit-keyed write is
 * outside it. Worth stating rather than leaving to inference: "everything that writes" is the obvious
 * generalisation of H16 and it is wrong.
 */

/**
 * The grant's own refusal, shared so the API's precondition and the drawer's blocker say the same
 * thing (invariant 6: name the remedy, never just refuse).
 */
export const overrideGrantBlockedMessage = (uses: number): string =>
  `This card already has a fuel exception with ${uses === 1 ? "1 purchase" : `${uses} purchases`} `
  + "left. Remove that exception first — the vendor offers no second override on a card already in "
  + "override, and granting over one can apply only partially while EFS reports success either way.";
