import {
  EFS_OVERRIDE_MAX_LIMITS,
  type EfsLimitOption,
  type OverrideLimit,
  efsStatusEquals,
  overrideGrantBlockedMessage,
  overrideGrantStatusMessage,
} from "@silvicom/shared";
import type { OperationDraft } from "./cardOperations";

/**
 * The product-limit half of a fuel exception — Step 10.3's rules, and what the drawer says about them.
 *
 * Its own module for `overrideException.ts`' reason: `cardOperations.ts` and `CardOperationInputs.vue`
 * both sit near the 500-line budget, and this is a whole rule with its own vocabulary rather than two
 * more lines of an existing one. It owns the picker's copy AND its blockers, so the button that says
 * "fix this" and the field that fixes it cannot disagree.
 *
 * ── Three rules from WEX's OWN portal guides, none of them in the SOAP guide ────────────────────
 * `docs/efs/eManager-Overrides-2017-11.pdf`, cited in `docs/37` §8. Each is a way to ship a screen
 * that looks right and grants the wrong thing.
 */

/**
 * ⚠ RULE 1 — the amount REPLACES the card's limit; it is not added to it.
 *
 * WEX, verbatim: *"Override limit does not 'add' to the existing limit; it is REPLACING the limit as
 * a daily total (i.e. if a card has a 100 gallon limit of diesel and the card needs an additional 50
 * gallons, the override would need to be in place for 150 gallons)."*
 *
 * A field labelled "additional gallons" therefore grants LESS than the card already allowed, and the
 * driver is declined for asking for more than the exception that was meant to help him. The label and
 * this help text are the whole defence, so they are here rather than inline in the template.
 */
export const OVERRIDE_LIMIT_AMOUNT_LABEL = "Total allowed during the exception";
export const OVERRIDE_LIMIT_AMOUNT_HELP =
  "This REPLACES the card's normal limit for this product — it is not added to it. A card capped at "
  + "100 gallons that needs 50 more wants 150 here, not 50.";

/**
 * ⚠ RULE 2 — diesel is two product codes, and the vendor ADVISES naming both. Advises, not requires.
 *
 * WEX's Overrides guide, NOTES: *"When overriding fuel, add product DSL for the desired gallons,
 * select 'Save and Add Another' and also add product ULSD for the desired gallons. This is done
 * because different truck stops use different product codes for fuel."*
 *
 * The portal's own flow requires exactly ONE product — *"Select product to override and then
 * 'Next'"* — and offers more only conditionally: *"Select 'Save and Add Another' **if** multiple
 * products are being overridden."* Until 2026-08-18 this module enforced the pairing as a BLOCKER,
 * which demanded two products where the vendor demands one; Miki's ruling that day — one product
 * required, all others in the same session optional — matches the vendor's flow, so the pairing is
 * now `dieselPartnerAdvice`: shown beside the picker with a one-click add, never a refusal.
 *
 * The advice is still worth a sentence AND a button, because the risk it names is real: a driver
 * sent to a stop that rings diesel up as `DSL` is declined by an exception that named only `ULSD`.
 * The operator clicks to add the partner, so the confirmation still names only what they chose —
 * silently adding a product nobody asked for stays off the table (`clearException`'s rule).
 */
export const DIESEL_PAIR = ["DSL", "ULSD"] as const;

/**
 * The advice, as a sentence for the picker — null whenever there is nothing to advise: no diesel
 * chosen, both codes already named, or the account does not offer the partner.
 */
export function dieselPartnerAdvice(
  limits: readonly OverrideLimit[],
  vocabulary: readonly EfsLimitOption[],
): string | null {
  const partner = missingDieselPartner(limits, vocabulary);
  if (!partner) return null;
  return `Truck stops ring up diesel under both DSL and ULSD — an exception naming only one can `
    + `decline the driver where the pump uses the other. WEX's own guide advises adding ${partner} `
    + `as well, at the same amount.`;
}

/**
 * ⚠ And the amounts on the pair do NOT add up — WEX's Overrides guide, verbatim:
 *
 *   *"The system will not combine the gallon limit on DLS and ULSD as it recognizes this as one
 *   product."* (their typo, their emphasis)
 *
 * So DSL 150 + ULSD 150 is **150 gallons of diesel**, not 300. Naming both codes is how the exception
 * reaches every truck stop; it is not how you buy twice as much. A confirmation that lists them as
 * two lines invites exactly that arithmetic, which is why the clause says so out loud.
 */
export const DIESEL_ONE_PRODUCT =
  " DSL and ULSD are the same product to EFS — naming both covers every truck stop, and the amount "
  + "is NOT doubled.";

/**
 * ⚠ RULE 3 — `hours` gets NO asserted meaning here.
 *
 * The portal's override screen calls it *"hours allowed between swipes"*; its limits screen calls it
 * *"when to refresh the limit"*; the SOAP field table matches the second. Three sources, two
 * meanings, so the UI asserts neither: p194's own example writes `hours: 1, minHours: 0` and that is
 * what a grant sends, unlabelled and unexposed. Showing a control we cannot name correctly is how an
 * operator learns a rule that is not true.
 */
export const P194_LIMIT_WINDOW = { hours: 1, minHours: 0 } as const;

/**
 * Why an operator would tick `Product/limit override`, and what it costs — said BEFORE they tick it.
 *
 * The destruction is named twice on purpose: here, where the decision is made, and again in the
 * confirmation (`overrideLimitsClause`), where it is committed. `clearException` follows the same
 * rule for the same reason — a consequence stated only at the end is a consequence discovered too
 * late to change your mind about cheaply.
 */
export const PRODUCT_OVERRIDE_HELP =
  "Caps what the driver may buy during the exception. While it is armed the card's OTHER product "
  + "limits are removed — that is how EFS applies a product override.";

/**
 * ⚠ `Allow Hand Enter` — the portal puts it on this screen, and the screen is misleading.
 *
 * `handEnter` is an ordinary card field (`string (7)` ALLOW / DISALLOW / POLICY on getCard/setCard).
 * It has no override scope in the guide, none in the WSDL, and no expiry anywhere. Sitting under the
 * portal's `Optional` heading next to `Product/Limit Override` it reads as *"for these N uses, also
 * permit hand entry"* — and there is no such thing.
 *
 * So the label says what it does. Miki's 2026-08-17 call was that it belongs in settings; on
 * 2026-08-18, having seen the portal, he asked for it here. Both hold only if the control is honest
 * about outliving the exception, which is the whole reason these two strings exist rather than the
 * portal's three words.
 *
 * ⚠ There is no way to turn hand entry OFF here, deliberately — see `grantOverrideSchema`.
 * Unticked means "not asked about", never DISALLOW.
 */
export const ALLOW_HAND_ENTER_LABEL = "Allow hand-entered card numbers";
export const ALLOW_HAND_ENTER_HELP =
  "⚠ This does NOT expire with the exception. It stays on until somebody changes it back — the "
  + "vendor has no version of this setting that lasts only for the granted purchases.";

/** The confirmation's clause, so the permanence is named where it is committed as well as chosen. */
export const handEnterClause = (allow: boolean): string =>
  (allow
    ? " Hand-entered card numbers will also be permitted — and that stays on after the exception is "
      + "used up, until it is changed back."
    : "");

/** A fresh row for the picker, at p194's window and with no product chosen yet. */
export const emptyOverrideLimit = (): OverrideLimit =>
  ({ limitId: "", limit: 0, ...P194_LIMIT_WINDOW });

/** Whether another product may be added — `grantOverrideSchema` refuses more than this. */
export const canAddOverrideLimit = (limits: readonly OverrideLimit[]): boolean =>
  limits.length < EFS_OVERRIDE_MAX_LIMITS;

/**
 * The grant's WHOLE blocker chain — the card's state first, then the draft's inputs
 * (`operationBlocker`'s own ordering rule: each step is a thing the operator can do less about
 * than the one after it).
 *
 * The armed-override refusal is Miki's 2026-08-18 ruling, and the API refuses identically
 * (`overrideGrant.behaviour.ts`) — both read `overrideGrantBlockedMessage`, so the drawer's
 * sentence and the server's cannot drift. Blocking here is what keeps the operator from spending
 * a vendor call and a rate-limit slot to learn what the card page already knows.
 */
export function grantBlocker(
  draft: OperationDraft,
  card: { overrideUses: number | null; status: string | null },
): string | null {
  /**
   * Active cards only — Miki's 2026-08-18 ruling, checked FIRST for the API's reason: on a held or
   * inactive card there is nothing the operator can fix in this drawer, so every other sentence is
   * an errand. Absent status falls through; the API's precondition reads the live card either way.
   */
  if (card.status !== null && !efsStatusEquals(card.status, "Active")) {
    return overrideGrantStatusMessage(card.status);
  }
  const uses = card.overrideUses ?? 0;
  if (uses > 0) return overrideGrantBlockedMessage(uses);
  if (draft.scopeKind === "location" && draft.location === null) {
    return "Choose the location this exception applies at.";
  }
  return overrideLimitsBlocker(draft);
}

/**
 * The blocker, as a SENTENCE (invariant 6) — every reason this grant cannot be sent yet.
 *
 * Returns the FIRST unmet condition rather than a list: a disabled button with four sentences under
 * it is a form nobody reads. They are ordered by how early the operator hits them.
 */
export function overrideLimitsBlocker(draft: OperationDraft): string | null {
  const limits = draft.limits ?? [];
  if (limits.length === 0) return null;

  const unchosen = limits.some((limit) => !limit.limitId);
  if (unchosen) return "Choose a product for every line, or remove the empty one.";

  /**
   * `grantOverrideSchema` refuses limits with a location scope, and the reason is the guide's: p194's
   * recipe sets `overrideAllLocations` true and says nothing about a location-scoped product
   * override, so it is a shape the vendor never described. Refusing here means the operator is told
   * BEFORE they spend a request and a slot of their daily override budget.
   */
  if (draft.scopeKind !== "all") {
    return "A product limit can only be granted at every location — change “Where it applies”.";
  }

  const zero = limits.find((limit) => limit.limit <= 0);
  if (zero) {
    return `Set an amount for ${zero.limitId} — an exception of zero declines the driver outright.`;
  }
  /**
   * ⚠ Deliberately NOT here: the diesel pair. It was this function's fourth refusal until
   * 2026-08-18, which made every diesel exception demand two products where the portal demands one
   * — see `dieselPartnerAdvice`, which is where the vendor's NOTES guidance now lives.
   */
  return null;
}

/**
 * The other half of RULE 2: which diesel code is named without its partner.
 *
 * Null when neither is present, when both are, or when the ACCOUNT does not carry the partner —
 * demanding a product this account cannot cap would be an unfixable blocker, which is worse than the
 * risk it guards against.
 */
export function missingDieselPartner(
  limits: readonly OverrideLimit[],
  vocabulary: readonly EfsLimitOption[],
): string | null {
  const chosen = new Set(limits.map((limit) => limit.limitId));
  const offered = new Set(vocabulary.map((option) => option.limitId));
  for (const [id, partner] of [DIESEL_PAIR, [...DIESEL_PAIR].reverse()] as [string, string][]) {
    if (chosen.has(id) && !chosen.has(partner) && offered.has(partner)) return partner;
  }
  return null;
}

/**
 * The clause the confirmation gains when products are capped — and it has to carry the DESTRUCTION.
 *
 * p194: *"echo back your data from the getCard response **except remove the limits** … add back the
 * limits array with the products and limits that you want for the override."* So granting a product
 * exception DELETES the card's ordinary product limits for the duration. That is the vendor's design
 * rather than our choice, and it is exactly the kind of consequence `clearExceptionClause` exists to
 * name on the same screen as the button that causes it.
 *
 * ⚠ Whether EFS restores those limits when the exception clears is UNPROVEN — Step 10.4 asks the
 * vendor that question live, and `overrideGrant.behaviour.ts` records `limitsBefore` in the audit row
 * so the answer is survivable either way. Until it is answered the sentence promises nothing about
 * restoration; it says what will happen, not what will happen afterwards.
 */
export function overrideLimitsClause(
  limits: readonly OverrideLimit[],
  vocabulary: readonly EfsLimitOption[],
): string {
  if (limits.length === 0) return "";
  const byId = new Map(vocabulary.map((option) => [option.limitId, option]));
  const named = limits.map((limit) => {
    const option = byId.get(limit.limitId);
    return `${option?.label ?? limit.limitId} at ${amountWithUnit(option, limit.limit)}`;
  });
  const bothDiesel = DIESEL_PAIR.every((id) => limits.some((l) => l.limitId === id));
  return ` During the exception the card is capped at ${joinWithAnd(named)}, and its OTHER product `
    + "limits are removed for the duration — that is how EFS applies a product override."
    + (bothDiesel ? DIESEL_ONE_PRODUCT : "");
}

/** The amount with the unit the ACCOUNT gives this product, never a unit inferred from the id. */
export const amountWithUnit = (option: EfsLimitOption | undefined, amount: number): string => {
  if (!option) return String(amount);
  if (option.unit === "gallons") return `${amount} gal`;
  if (option.unit === "dollars") return `$${amount}`;
  return String(amount);
};

const joinWithAnd = (parts: readonly string[]): string =>
  (parts.length <= 1 ? parts[0] ?? "" : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);
