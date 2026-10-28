import { CARD_BLOCKED_SENTENCES, PROMPT_REMOVAL_STEP_UP, promptRemovalNeedsStepUp } from "@silvicom/shared";
import type { CardScope } from "../services/efsCardControlAccess.js";
import { ActionRefusalError } from "../services/efsCardControlErrors.js";

// Moved to the services layer in Step 3.4 so the orchestrator can throw it for a capability's
// governance gates without a service importing a router. Re-exported so every existing import of
// `ActionRefusalError` from this module keeps working.
export { ActionRefusalError } from "../services/efsCardControlErrors.js";

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
      "Removing the Driver ID prompt has to be confirmed on its own, because the pump then stops checking who is fueling.",
      "invalid_request",
    );
  }
}

/**
 * The deploy-wide kill switch's refusal, on its own because it is the one reason that is not about a
 * card scope — `routes/unitMileage.ts` writes to EFS without being a card capability and still has
 * to answer to the switch, in the same words.
 */
export const KILL_SWITCH_REFUSAL: [string, string] = ["card_control_disabled", CARD_BLOCKED_SENTENCES.kill_switch];

/**
 * The error code per blocked-by reason. The SENTENCE is `CARD_BLOCKED_SENTENCES`, shared with the drawer
 * and the card page since CCF4 (2026-10-28), so a refusal and the disabled button before it cannot word
 * one cause two ways.
 *
 * `not_promoted` is deliberately not "not entitled": the account may well be entitled. What is missing
 * is OUR record that somebody approved this capability here, and the fix is a proof run, not a WEX call.
 */
export function refusal(blockedBy: string | null, _scope: CardScope): [string, string] {
  switch (blockedBy) {
    case "kill_switch":
      return KILL_SWITCH_REFUSAL;
    case "not_enabled":
      return ["card_control_disabled", CARD_BLOCKED_SENTENCES.not_enabled];
    case "no_credentials":
      return ["efs_not_configured", CARD_BLOCKED_SENTENCES.no_credentials];
    case "not_entitled":
      return ["card_control_not_entitled", CARD_BLOCKED_SENTENCES.not_entitled];
    case "endpoint_changed":
      return ["card_control_not_entitled", CARD_BLOCKED_SENTENCES.endpoint_changed];
    case "not_promoted":
      return ["card_control_not_promoted", CARD_BLOCKED_SENTENCES.not_promoted];
    case "capability_suspended":
      return ["card_control_suspended", CARD_BLOCKED_SENTENCES.capability_suspended];
    case "role":
      return ["forbidden", CARD_BLOCKED_SENTENCES.role];
    case "not_approver":
      return ["forbidden", CARD_BLOCKED_SENTENCES.not_approver];
    default:
      // Never the raw scope code (plan W6): `"lock"` in quotes means nothing to a fleet manager.
      return ["forbidden", "You are not approved for this action on fuel cards."];
  }
}
