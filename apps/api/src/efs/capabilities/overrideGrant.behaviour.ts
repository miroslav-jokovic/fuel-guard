import {
  CARD_OVERRIDE_STEP_UP_ABOVE_USES,
  type OverrideGrantBody,
  overrideGrantContract,
  overrideStepUpMessage,
} from "@fuelguard/shared";
import { overrideGrantEdits } from "../../services/efsCardEdits.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import { defineBehaviour } from "../types.js";

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

  verify: cardEchoVerify<OverrideGrantBody>(),

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
