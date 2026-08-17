import {
  OVERRIDE_GRANT_STEP_UP,
  type OverrideGrantBody,
  overrideGrantContract,
  overrideGrantNeedsStepUp,
} from "@fuelguard/shared";
import { defineView, row } from "./types.js";

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
        "The exception is used up automatically — it does not need to be revoked.",
      confirmLabel: "Grant exception",
      busyLabel: "Granting…",
      doneLabel: "Exception granted",
    };
  },

  /**
   * Three rows, because three fields move together and reading `override` as a boolean is the bug
   * audit W1 caught. Showing only the use count would hide a scope change entirely — the difference
   * between "anywhere" and "one station" is the whole of the operator's decision.
   */
  diff: (before, body: OverrideGrantBody) => [
    row("Exception", usesLabel(before.overrideUses ?? 0), usesLabel(body.uses)),
    row("Where", scopeLabel(before.overrideAllLocations === true, before.locationOverrideId ?? null),
      scopeLabel(body.scope.kind === "all", body.scope.kind === "location" ? body.scope.locationId : null)),
  ],

  /**
   * The one gate that is EXACT here: `preflightStepUp` decides from the body alone, and this has the
   * same body. Turning the stepper past three re-renders this warning with no round trip.
   */
  stepUp: (body: OverrideGrantBody) =>
    (overrideGrantNeedsStepUp(body.uses) ? OVERRIDE_GRANT_STEP_UP : null),
});

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
