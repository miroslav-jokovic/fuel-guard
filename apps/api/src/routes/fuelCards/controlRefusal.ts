import type { CardScope } from "../../services/efsCardControlAccess.js";
import { ActionRefusalError } from "../../services/efsCardControlErrors.js";

// Moved to the services layer in Step 3.4 so the orchestrator can throw it for a capability's
// governance gates without a service importing a router. Re-exported so every existing import of
// `ActionRefusalError` from this module keeps working.
export { ActionRefusalError } from "../../services/efsCardControlErrors.js";

/** Every explicit prompt removal is destructive; DRID additionally needs its named opt-in. */
export function assertPromptRemovalAllowed(
  removedInfoIds: readonly string[],
  allowRemoveDriverId: boolean,
  freshAuth: boolean,
): void {
  if (removedInfoIds.length === 0) return;
  if (!freshAuth) throw new ActionRefusalError("Confirm your password to remove a prompt.", "step_up_required");
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
    case "role":
      return ["forbidden", "Your role cannot change fuel cards."];
    case "not_approver":
      return ["forbidden", "You are not on this company's card-control approver list."];
    default:
      return ["forbidden", `You are not approved for the "${scope}" action on fuel cards.`];
  }
}
