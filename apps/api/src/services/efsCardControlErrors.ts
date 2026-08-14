/**
 * A refusal that is about US or about the request, not about the vendor. Vendor problems arrive as
 * `EfsSoapError` and keep their own codes, so a route can tell "EFS said no" from "we said no"
 * without inspecting message text.
 */
export class CardControlError extends Error {
  constructor(
    message: string,
    public code:
      | "card_control_disabled"
      | "card_control_not_entitled"
      | "card_state_changed"
      | "mutation_in_flight"
      | "idempotency_key_reused"
      | "org_hourly_cap_reached"
      | "secrets_key_missing"
      | "not_found",
    public status: number,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CardControlError";
  }
}
