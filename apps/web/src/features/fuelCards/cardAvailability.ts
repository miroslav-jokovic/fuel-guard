import type { CardCapabilities } from "@fuelguard/shared";

// ─── Write availability ────────────────────────────────────────────────────────────────────────

export interface AvailabilityNotice {
  /** `disabled` shows the panel greyed with an explanation; `hidden` removes it entirely. */
  mode: "available" | "disabled" | "hidden";
  message: string;
  /** Admin-only next step, when there is one. */
  actionTo?: string;
  actionLabel?: string;
}

/**
 * What to tell someone who cannot change this card.
 *
 * The distinction that matters: an entitlement we have not CHECKED yet is shown as a disabled panel
 * with an explanation, because the read layer ships first and the whole product story is "you will be
 * able to lock this card" — hiding the actions makes Phase A look like a dead end and generates
 * support tickets for a feature that is already built. A capability the person will NEVER have,
 * because of their role, is hidden instead: advertising it reads as a taunt.
 */
export function availability(capabilities: CardCapabilities, isAdmin: boolean): AvailabilityNotice {
  if (!capabilities.blockedBy) return { mode: "available", message: "" };

  const adminAction = isAdmin
    ? { actionTo: "/settings/card-control", actionLabel: "Open card control settings" }
    : {};

  switch (capabilities.blockedBy) {
    case "role":
    case "not_approver":
      return { mode: "hidden", message: "" };
    case "kill_switch":
      return { mode: "disabled", message: "Card actions are paused." };
    case "no_credentials":
      return {
        mode: "disabled",
        message: "EFS is not connected for this company.",
        ...adminAction,
      };
    case "not_enabled":
      return {
        mode: "disabled",
        message: "Card actions are not switched on for this company.",
        ...adminAction,
      };
    case "not_entitled":
      return capabilities.writeEntitlement === "denied"
        ? {
            mode: "disabled",
            message:
              "EFS has not enabled card changes for this account. Ask your WEX representative to add write access for the service account.",
          }
        : {
            mode: "disabled",
            message:
              "Card actions are not switched on yet. An admin needs to run the EFS write check.",
            ...adminAction,
          };
    case "endpoint_changed":
      return {
        mode: "disabled",
        message:
          "The EFS connection changed since this company was checked. An admin needs to re-run the connection check before card actions work again.",
        ...adminAction,
      };
    default:
      return { mode: "disabled", message: "Card actions are unavailable." };
  }
}
