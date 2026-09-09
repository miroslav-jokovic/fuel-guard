import { describe, expect, it } from "vitest";
import { stockLevelBadge } from "./badges";

/**
 * `stockLevelBadge` — the stock half of the badge vocabulary (INVENTORY-PLAN.md I4).
 *
 * What is being pinned is not the words. It is that the badge ASKS `isLowStock` rather than
 * re-deriving it: `inventoryRules.ts` exists because the low-stock card, the low-stock filter and
 * the API must agree about the same shelf, and a `quantity <= reorder` written in the badge would
 * be a second definition that looks right on its own the day the rule changes.
 *
 * The null cases are the load-bearing ones. A null reorder point is not low HOWEVER empty the
 * shelf is — nobody has said what "enough" means for this part, so the system has not established
 * there is too little of it. That is the rule's own deliberate half, and a red pill on a zero with
 * no reorder point would report a shortage the shop never defined.
 */
describe("stockLevelBadge", () => {
  it("says nothing at all when no reorder point has been set, even at zero on hand", () => {
    expect(stockLevelBadge({ quantityOnHand: 0, reorderPoint: null })).toBeNull();
    expect(stockLevelBadge({ quantityOnHand: 40, reorderPoint: null })).toBeNull();
  });

  it("says nothing on a shelf that is above its reorder point", () => {
    expect(stockLevelBadge({ quantityOnHand: 12, reorderPoint: 3 })).toBeNull();
  });

  it("calls a shelf Low at its reorder point, not one below it", () => {
    // `isLowStock` compares with `<=`, because "tell me at three" means three is already the call.
    expect(stockLevelBadge({ quantityOnHand: 3, reorderPoint: 3 })).toEqual({ label: "Low", tone: "warning" });
    expect(stockLevelBadge({ quantityOnHand: 4, reorderPoint: 3 })).toBeNull();
  });

  it("separates Out from Low, because they are two different phone calls", () => {
    expect(stockLevelBadge({ quantityOnHand: 1, reorderPoint: 3 })).toEqual({ label: "Low", tone: "warning" });
    expect(stockLevelBadge({ quantityOnHand: 0, reorderPoint: 3 })).toEqual({ label: "Out", tone: "danger" });
  });

  it("honours a reorder point of ZERO, which is a legitimate thing to ask for", () => {
    // "Tell me when this hits nothing." The null check is separate from the comparison precisely so
    // that a zero here does not read as "unset" (`isLowStock`'s own reasoning).
    expect(stockLevelBadge({ quantityOnHand: 0, reorderPoint: 0 })).toEqual({ label: "Out", tone: "danger" });
    expect(stockLevelBadge({ quantityOnHand: 1, reorderPoint: 0 })).toBeNull();
  });
});
