/**
 * An action this caller is not allowed to take, discovered only once the FRESH card document is in
 * hand — a prompts change that drops the driver id, an unlock of a card EFS has just flagged.
 * Thrown from `buildEdits` so `planCardMutation` aborts before it writes a ledger row: no row, no
 * dispatch, no half-finished record of a change that never happened.
 */
export class ActionRefusalError extends Error {
  constructor(message: string, public code: "invalid_request" | "step_up_required") {
    super(message);
    this.name = "ActionRefusalError";
  }
}

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
