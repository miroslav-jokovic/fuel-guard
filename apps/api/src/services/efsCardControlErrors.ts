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
      | "not_found"
      // The capability names a target the only LedgerAdapter cannot key a row on (docs/27 §5.2).
      // Not reachable from the five routes that exist; it is what makes the seam fail closed
      // instead of writing an unkeyed row into the card ledger.
      | "unsupported_target",
    public status: number,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CardControlError";
  }
}

/**
 * An action this caller is not allowed to take, discovered only once the FRESH card document is in
 * hand — a prompts change that drops the driver id, an unlock of a card EFS has just flagged.
 * Thrown from `buildEdits`, or from a capability's `planStepUp` / `precondition`, so
 * `planCardMutation` aborts before it writes a ledger row: no row, no dispatch, no half-finished
 * record of a change that never happened.
 *
 * Lives beside `CardControlError` rather than in `routes/fuelCards/controlRefusal.ts`, where it was
 * defined until Step 3.4, because the orchestrator now throws it for a capability's governance gates
 * and a service must not import a router to do that. `controlRefusal.ts` re-exports it, so every
 * existing import keeps working.
 */
export class ActionRefusalError extends Error {
  constructor(message: string, public code: "invalid_request" | "step_up_required") {
    super(message);
    this.name = "ActionRefusalError";
  }
}
