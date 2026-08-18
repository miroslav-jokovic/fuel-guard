import {
  type OverrideGrantBody,
  overrideGrantContract,
  overrideGrantStepUp,
} from "@fuelguard/shared";
import { defineView, row } from "./types.js";
import { overrideLimitsClause } from "../overrideLimits.js";

/**
 * The confirmation that NAMES THE NUMBERS.
 *
 * "This card will be allowed 2 purchases outside its normal limits at Loves station 442,
 * Effingham IL." A generic "grant an override?" is how somebody grants nine when they meant one.
 * Prose lifted word for word from `overrideConfirmation`, which Step 6.4 deleted.
 */
export const overrideGrantView = defineView(overrideGrantContract, {
  confirmation: (body: OverrideGrantBody, card) => {
    const purchases = body.uses === 1 ? "1 purchase" : `${body.uses} purchases`;
    return {
      tone: "warning",
      title: "Grant a fuel exception?",
      body:
        `This card will be allowed ${purchases} outside its normal limits ${whereLabel(body, card.locationLabel)}. ` +
        "The exception is used up automatically — it does not need to be revoked." +
        // Step 10.3. Names the DESTRUCTION on the same screen as the button that causes it, the rule
        // `clearExceptionClause` follows: a product override removes the card's other limits (p194).
        overrideLimitsClause(body.limits ?? [], card.limitOptions ?? []),
      confirmLabel: "Grant exception",
      busyLabel: "Granting…",
      doneLabel: "Exception granted",
    };
  },

  /**
   * The count AND the scope, because those fields move together and reading `override` as a boolean
   * is the bug audit W1 caught. Showing only the use count would hide a scope change entirely — the
   * difference between "anywhere" and "one station" is the whole of the operator's decision. A third
   * row appears when the grant caps products, and it is the only one that describes a DELETION.
   */
  diff: (before, body: OverrideGrantBody) => [
    row("Exception", usesLabel(before.overrideUses ?? 0), usesLabel(body.uses)),
    row("Where", scopeLabel(before.overrideAllLocations === true, before.locationOverrideId ?? null),
      scopeLabel(body.scope.kind === "all", body.scope.kind === "location" ? body.scope.locationId : null)),
    /**
     * The fourth row, and it is a DELETION as much as an addition: after this write the card's
     * product limits ARE the override's (p194). "Its own limits" on the left says what is being
     * replaced without claiming to list records this context does not carry.
     */
    ...((body.limits ?? []).length > 0
      ? [row("Product limits", "Its own limits", productsLabel(body.limits))]
      : []),
  ],

  /**
   * The one gate that is EXACT here: `preflightStepUp` decides from the body alone, and this has the
   * same body. Turning the stepper past three re-renders this warning with no round trip.
   *
   * `overrideGrantStepUp` rather than the two predicates spelled out, so the drawer shows the reason
   * the server would actually give. There are two of them since Step 10.1, and a view that picked its
   * own would be free to warn about a use count while the server refused over a deleted product limit.
   */
  stepUp: (body: OverrideGrantBody) => overrideGrantStepUp(body),
});

/** Products and amounts, ids included: the id is what EFS declines on if the operator picked wrong. */
const productsLabel = (limits: OverrideGrantBody["limits"]): string =>
  limits.map((limit) => `${limit.limitId} ${limit.limit}`).join(", ");

const usesLabel = (uses: number): string =>
  uses === 0 ? "None" : uses === 1 ? "1 purchase" : `${uses} purchases`;

const scopeLabel = (allLocations: boolean, locationId: string | null): string => {
  if (allLocations) return "Any location";
  if (!locationId) return "None";
  return `Network plus ${locationId}`;
};

/** Falls back to the id when the drawer cannot name the station: the id is what a driver is declined at. */
const whereLabel = (
  body: OverrideGrantBody,
  resolve: ((locationId: string) => string | null) | undefined,
): string => {
  if (body.scope.kind !== "location") return "at any location";
  // "as well as" — guide p194 opens the card UP TO this location; it does not restrict it to one.
  return `on its usual network, as well as at ${resolve?.(body.scope.locationId) ?? `location ${body.scope.locationId}`}`;
};
