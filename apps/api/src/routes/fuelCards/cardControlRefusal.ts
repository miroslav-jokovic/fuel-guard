import type { CardScope } from "../../services/efsCardControlAccess.js";

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
