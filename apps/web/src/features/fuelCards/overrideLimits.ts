import { EFS_OVERRIDE_MAX_LIMITS, type EfsLimitOption, type OverrideLimit } from "@fuelguard/shared";
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
 * ⚠ RULE 2 — diesel is two product codes, and one of them is not enough.
 *
 * WEX: *"different truck stops use different product codes for fuel."* The guide's own p194 example
 * caps `ULSD` alone, which is an illustration of the request shape and NOT a complete operational
 * recipe — a driver sent to a stop that rings up `DSL` is declined by an exception that named only
 * `ULSD`.
 *
 * Enforced as a BLOCKER rather than by silently adding the partner, because adding a product nobody
 * asked for is granting fuel nobody authorised — the same rule `clearException` follows. The operator
 * adds it, so the confirmation names what they chose.
 */
export const DIESEL_PAIR = ["DSL", "ULSD"] as const;

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

/** A fresh row for the picker, at p194's window and with no product chosen yet. */
export const emptyOverrideLimit = (): OverrideLimit =>
  ({ limitId: "", limit: 0, ...P194_LIMIT_WINDOW });

/** Whether another product may be added — `grantOverrideSchema` refuses more than this. */
export const canAddOverrideLimit = (limits: readonly OverrideLimit[]): boolean =>
  limits.length < EFS_OVERRIDE_MAX_LIMITS;

/**
 * The blocker, as a SENTENCE (invariant 6) — every reason this grant cannot be sent yet.
 *
 * Returns the FIRST unmet condition rather than a list: a disabled button with four sentences under
 * it is a form nobody reads. They are ordered by how early the operator hits them.
 */
export function overrideLimitsBlocker(
  draft: OperationDraft,
  vocabulary: readonly EfsLimitOption[],
): string | null {
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

  const missing = missingDieselPartner(limits, vocabulary);
  if (missing) {
    return `Add ${missing} as well — truck stops ring up diesel under both codes, and an exception `
      + `naming only one declines the driver at the others.`;
  }
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
  return ` During the exception the card is capped at ${joinWithAnd(named)}, and its OTHER product `
    + "limits are removed for the duration — that is how EFS applies a product override.";
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
