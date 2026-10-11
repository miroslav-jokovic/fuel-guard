import { describe, expect, it } from "vitest";
import { emptyDraft, rebaseDraft } from "./operationDrafts";

describe("rebaseDraft — a 409 reseeds only what the card's move changed", () => {
  it("keeps every field whose seed did not move, and takes the new seed where it did", () => {
    const before = { ...emptyDraft("Active"), prompts: [] };
    const after = { ...emptyDraft("Hold"), prompts: [] };
    const typed = { ...before, uses: 3, targetStatus: "Inactive" as const, scopeKind: "location" as const };

    const rebased = rebaseDraft(typed, before, after);

    expect(rebased.uses).toBe(3);
    expect(rebased.scopeKind).toBe("location");
    // The status moved, so the status choice is the card's again — the operator must look at it.
    expect(rebased.targetStatus).toBe("Hold");
  });

  it("is the old reseed when nothing the operator typed survives the move", () => {
    const before = emptyDraft("Active");
    expect(rebaseDraft(before, before, before)).toEqual(before);
  });
});
