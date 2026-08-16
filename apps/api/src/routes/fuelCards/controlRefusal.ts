import { PROMPT_REMOVAL_STEP_UP, promptRemovalNeedsStepUp } from "@fuelguard/shared";
import type { CardScope } from "../../services/efsCardControlAccess.js";
import { ActionRefusalError } from "../../services/efsCardControlErrors.js";

// Moved to the services layer in Step 3.4 so the orchestrator can throw it for a capability's
// governance gates without a service importing a router. Re-exported so every existing import of
// `ActionRefusalError` from this module keeps working.
export { ActionRefusalError } from "../../services/efsCardControlErrors.js";

/**
 * Every explicit prompt removal is destructive; DRID additionally needs its named opt-in.
 *
 * The step-up half is `promptRemovalNeedsStepUp` as of Step 6.1 — the same predicate and the same
 * sentence the drawer warns from, so an operator staging a removal is told a password is coming
 * before they press Confirm rather than after. Only the step-up half is shared: the DRID opt-in
 * raises `invalid_request`, not `step_up_required`, and a UI that conflated them would offer a
 * password box to somebody who needs a checkbox.
 */
export function assertPromptRemovalAllowed(
  removedInfoIds: readonly string[],
  allowRemoveDriverId: boolean,
  freshAuth: boolean,
): void {
  if (!promptRemovalNeedsStepUp(removedInfoIds)) return;
  if (!freshAuth) throw new ActionRefusalError(PROMPT_REMOVAL_STEP_UP, "step_up_required");
  if (removedInfoIds.includes("DRID") && !allowRemoveDriverId) {
    // Dropping the driver-ID record stops the pump asking who is fuelling, and every downstream
    // attribution decision loses its strongest signal — the guide warns about exactly this (p137).
    // Explicit flag AND a fresh sign-in; never a side effect of clearing a text box.
    throw new ActionRefusalError(
      "Removing the Driver ID prompt needs allowRemoveDriverId: true — it stops the pump checking who is fuelling.",
      "invalid_request",
    );
  }
}

/** One sentence per blocked-by reason, each pointing at what would actually unblock it. */
export function refusal(blockedBy: string | null, scope: CardScope): [string, string] {
  switch (blockedBy) {
    case "kill_switch":
      return ["card_control_disabled", "Card actions are switched off for this deployment."];
    case "not_enabled":
      return [
        "card_control_disabled",
        "Card actions are not switched on for this company yet. An admin can enable them in Settings → Card control.",
      ];
    case "no_credentials":
      return ["efs_not_configured", "EFS is not connected for this company."];
    case "not_entitled":
      return [
        "card_control_not_entitled",
        "EFS has not confirmed write access for this account. An admin needs to run the EFS write check.",
      ];
    case "endpoint_changed":
      return [
        "card_control_not_entitled",
        "The EFS connection changed since this company was checked. An admin needs to re-run the connection check before card actions work again.",
      ];
    case "not_promoted":
      return [
        "card_control_not_promoted",
        // Not "not entitled": the account may well be entitled. What is missing is OUR record that
        // somebody approved this capability here, and the fix is a proof run, not a WEX call.
        "This action has not been approved for this company yet. An admin needs to prove it on a test card first.",
      ];
    case "capability_suspended":
      return [
        "card_control_suspended",
        "This action is suspended for this company. An admin can re-enable it once whatever caused the suspension is resolved.",
      ];
    case "role":
      return ["forbidden", "Your role cannot change fuel cards."];
    case "not_approver":
      return ["forbidden", "You are not on this company's card-control approver list."];
    default:
      return ["forbidden", `You are not approved for the "${scope}" action on fuel cards.`];
  }
}
