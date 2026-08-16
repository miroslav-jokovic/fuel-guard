import type { WsCard } from "@fuelguard/shared";
import { CardControlApiError } from "./useCardControl";

/**
 * The refusals that are not really the end, and what the drawer does about each.
 *
 * ── Why this is a module and not a method on the drawer ─────────────────────────────────────────
 * Seven branches, each with its own recovery, and every one of them is a claim about what the API
 * meant. Out here they can be tested without mounting a drawer, driving a vendor call or faking a
 * toast store — which is what `cardOperationFailure.test.ts` does, one case per branch.
 *
 * A key is NOT rotated for any of these except `idempotency_key_reused`: none of the others opened a
 * ledger row, so the same key is still the right one for the retry the operator is about to make.
 * Rotating on a network blip is how a genuine double-submit stops being caught.
 */

export interface OperationFailureHandlers {
  /** The API asked for a password the prediction did not foresee. The frozen body is kept. */
  stepUp: (reason: string) => void;
  /** 409 with the live document attached — reseed from it, and drop the authorised body. */
  cardMoved: (version: string, card: Pick<WsCard, "status" | "infos">) => void;
  /** Give up on the frozen body without reseeding: it is no longer what should be sent. */
  abandon: () => void;
  /** Mint a fresh idempotency key. */
  rekey: () => void;
  /** Ask the parent to refetch — capabilities may have moved under the operator. */
  refetch: () => void;
  notify: (kind: "error", title: string, message?: string) => void;
}

/** The 409 payload is the fresh document the API just read, not a mirror row. */
export function isLiveCard(value: unknown): value is Pick<WsCard, "status" | "infos"> {
  return typeof value === "object" && value !== null && Array.isArray((value as { infos?: unknown }).infos);
}

export function handleOperationFailure(error: unknown, on: OperationFailureHandlers): void {
  const api = error instanceof CardControlApiError ? error : null;

  if (api?.code === "step_up_required") {
    /**
     * The fallback invariant 5 keeps, and must keep.
     *
     * Two of the three step-up gates decide against the document EFS returns at write time while the
     * drawer only has the mirror, so a card flagged for fraud since the last sweep arrives here
     * unpredicted. The frozen body is deliberately untouched: confirming the password then re-sends
     * exactly what the operator authorised, not whatever the form holds by then.
     */
    on.stepUp(api.message || "This action needs a recent sign-in.");
    return;
  }

  if (api?.code === "card_state_changed") {
    const version = api.detail.currentVersion;
    const card = api.detail.card;
    if (typeof version === "string" && isLiveCard(card)) {
      on.cardMoved(version, card);
    } else {
      on.abandon();
    }
    // The authorised body was authorised against a card that has since moved; re-sending it is the
    // overwrite `expectedVersion` exists to prevent. The parent refetch repairs the mirror, but the
    // payload above is what the drawer shows, because the API read it just now and the mirror has not.
    on.refetch();
    on.notify("error", "Card changed in EFS", "The current settings are loaded — review and try again.");
    return;
  }

  on.abandon();

  if (api?.code === "mutation_in_flight") {
    on.notify("error", "Still confirming an earlier change", "Wait for it to finish, then try again.");
    return;
  }
  if (api?.code === "idempotency_key_reused") {
    // Defence in depth: the drawer re-seeds on card change, so this should not happen — but if it
    // does, a fresh key makes the retry clean rather than stuck.
    on.rekey();
    on.notify("error", "Please try that again", "The previous request could not be matched; a fresh attempt is ready.");
    return;
  }
  if (api?.status === 429) {
    const retryAfter = typeof api.detail.retryAfterSec === "number"
      ? ` Try again in about ${api.detail.retryAfterSec}s.`
      : "";
    on.notify("error", "Too many card changes just now", `This limit protects the account.${retryAfter}`);
    return;
  }
  if (api?.code === "card_control_disabled" || api?.code === "card_control_not_entitled" || api?.status === 403) {
    on.refetch();
    on.notify("error", "Card actions are not available", api?.message);
    return;
  }
  on.notify("error", "Could not change the card", error instanceof Error ? error.message : undefined);
}
