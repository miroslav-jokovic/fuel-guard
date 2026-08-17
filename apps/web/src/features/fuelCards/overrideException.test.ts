import { describe, expect, it } from "vitest";
import {
  CLEAR_EXCEPTION_BLOCKER,
  CLEAR_EXCEPTION_HELP,
  cardHasArmedException,
  clearExceptionClause,
  clearExceptionLabel,
  statusBlocker,
} from "./overrideException";
import type { OperationCard, OperationDraft } from "./cardOperations";

/**
 * The drawer's half of docs/22 H16.
 *
 * The API refuses a status change on a card with an armed exception; this is the offer that turns that
 * refusal into a one-press action for `card_lock`. Every case here is about the OFFER being made, and
 * being made honestly — a checkbox that destroys something without saying so is worse than a refusal.
 */

const card = (overrideUses: number | null): OperationCard =>
  ({ status: "Active", infos: [], limits: [], overrideUses, overrideAllLocations: false, locationOverrideId: null }) as unknown as OperationCard;
const draft = (clearException: boolean): OperationDraft => ({ clearException }) as unknown as OperationDraft;

describe("when the offer appears", () => {
  it("appears on a card with uses left, and not on one without", () => {
    expect(cardHasArmedException(1)).toBe(true);
    expect(cardHasArmedException(0)).toBe(false);
    expect(cardHasArmedException(null)).toBe(false);
  });
});

describe("the blocker, which is the way through rather than a wall", () => {
  it("asks for the tick on a card with an exception", () => {
    expect(statusBlocker(draft(false), card(2))).toBe(CLEAR_EXCEPTION_BLOCKER);
  });

  it("clears once the operator ticks it — the box is what unblocks Confirm", () => {
    expect(statusBlocker(draft(true), card(2))).toBeNull();
  });

  it("never fires on the ordinary card, which is nearly all of them", () => {
    expect(statusBlocker(draft(false), card(0))).toBeNull();
    expect(statusBlocker(draft(false), card(null))).toBeNull();
  });

  it("names the tick rather than the failure — invariant 6 wants the remedy, not the diagnosis", () => {
    expect(CLEAR_EXCEPTION_BLOCKER).toContain("Tick");
    // POSITIVE CONTROL for that absence: it still says WHY, or the operator is being ordered about.
    expect(CLEAR_EXCEPTION_BLOCKER).toContain("ignore the status change");
  });
});

describe("what the operator is told before pressing", () => {
  it("counts the purchases, because 1 and 7 are different decisions", () => {
    expect(clearExceptionLabel(1)).toContain("1 purchase left");
    expect(clearExceptionLabel(7)).toContain("7 purchases left");
    expect(clearExceptionClause(1)).toContain("1 purchase");
    expect(clearExceptionClause(3)).toContain("3 purchases");
  });

  it("says the removal cannot be undone from here", () => {
    // The clause is the ONLY place the operator learns that locking destroys the exception. If this
    // stops saying so, the write becomes a silent destruction with a checkbox in front of it.
    expect(clearExceptionClause(2)).toContain("removed");
    expect(clearExceptionClause(2)).toContain("cannot be undone");
  });

  it("explains why the box exists at all, not just what it does", () => {
    expect(CLEAR_EXCEPTION_HELP).toContain("would not actually lock");
  });
});
