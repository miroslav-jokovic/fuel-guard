import { describe, expect, it, vi } from "vitest";
import { CardControlApiError } from "./useCardControl";
import { handleOperationFailure, type OperationFailureHandlers } from "./cardOperationFailure";

/**
 * One case per branch, because each branch is a CLAIM about what the API meant and getting one
 * wrong is silent: an operator is told to retry a write that already landed, or a fresh key is
 * minted for an attempt that is still in flight.
 */

const handlers = (): OperationFailureHandlers & { [K in keyof OperationFailureHandlers]: ReturnType<typeof vi.fn> } => ({
  stepUp: vi.fn(), cardMoved: vi.fn(), abandon: vi.fn(), rekey: vi.fn(), refetch: vi.fn(), notify: vi.fn(),
}) as never;

const apiError = (message: string, code: string, status = 409, detail: Record<string, unknown> = {}) =>
  new CardControlApiError(message, code, status, detail);

describe("step_up_required", () => {
  it("keeps the frozen body — the password re-sends what was authorised, not the form", () => {
    const on = handlers();
    handleOperationFailure(apiError("This card is flagged for fraud.", "step_up_required", 401), on);

    expect(on.stepUp).toHaveBeenCalledWith("This card is flagged for fraud.");
    // `abandon` would drop the frozen body, and the retry after the password would then send
    // whatever the form held by then.
    expect(on.abandon).not.toHaveBeenCalled();
    expect(on.rekey).not.toHaveBeenCalled();
  });

  it("falls back to its own sentence when the server sent none", () => {
    const on = handlers();
    handleOperationFailure(apiError("", "step_up_required", 401), on);
    expect(on.stepUp).toHaveBeenCalledWith("This action needs a recent sign-in.");
  });
});

describe("card_state_changed", () => {
  it("reseeds from the live document the API attached, and drops the authorised body", () => {
    const on = handlers();
    const live = { status: "HOLD", infos: [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "L-1", reportValue: null }] };
    handleOperationFailure(
      apiError("changed", "card_state_changed", 409, { currentVersion: "v".repeat(32), card: live }),
      on,
    );

    expect(on.cardMoved).toHaveBeenCalledWith("v".repeat(32), live);
    expect(on.refetch).toHaveBeenCalled();
    expect(on.rekey).not.toHaveBeenCalled();
  });

  it("abandons rather than guesses when the 409 carried no usable document", () => {
    // A payload without an `infos` array is not the fresh card. Seeding from it would put invented
    // state on screen and call it EFS's.
    const on = handlers();
    handleOperationFailure(apiError("changed", "card_state_changed", 409, { currentVersion: 12 }), on);

    expect(on.cardMoved).not.toHaveBeenCalled();
    expect(on.abandon).toHaveBeenCalled();
  });
});

describe("the refusals that leave no ledger row", () => {
  it("does NOT mint a fresh key while an earlier attempt is still being confirmed", () => {
    // Rotating here is how a genuine double-submit stops being caught: the in-flight attempt's key
    // is the only thing that can match the retry to it.
    const on = handlers();
    handleOperationFailure(apiError("in flight", "mutation_in_flight"), on);

    expect(on.rekey).not.toHaveBeenCalled();
    expect(on.notify).toHaveBeenCalledWith("error", "Still confirming an earlier change", expect.any(String));
  });

  it("DOES mint a fresh key when the server could not match the old one", () => {
    const on = handlers();
    handleOperationFailure(apiError("reused", "idempotency_key_reused"), on);
    expect(on.rekey).toHaveBeenCalled();
  });

  it("quotes the retry-after when the limiter sent one, and stays quiet when it did not", () => {
    const withHint = handlers();
    handleOperationFailure(apiError("slow down", "rate_limited", 429, { retryAfterSec: 42 }), withHint);
    expect(withHint.notify.mock.calls[0]![2]).toContain("42s");

    const without = handlers();
    handleOperationFailure(apiError("slow down", "rate_limited", 429), without);
    expect(without.notify.mock.calls[0]![2]).not.toContain("undefined");
  });

  it("asks the parent to refetch when the answer was 403 — capabilities may have moved", () => {
    const on = handlers();
    handleOperationFailure(apiError("nope", "card_control_not_entitled", 403), on);
    expect(on.refetch).toHaveBeenCalled();
  });

  it("reports a plain network error without pretending to know what it was", () => {
    const on = handlers();
    handleOperationFailure(new Error("fetch failed"), on);

    expect(on.abandon).toHaveBeenCalled();
    expect(on.notify).toHaveBeenCalledWith("error", "Could not change the card", "fetch failed");
    expect(on.stepUp).not.toHaveBeenCalled();
  });
});
