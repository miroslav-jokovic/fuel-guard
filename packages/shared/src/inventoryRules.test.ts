import { describe, expect, it } from "vitest";
import {
  COUNT_CONFIRM_FLOOR,
  DISPLAY_NO_MAX_SEQUENCE,
  countVarianceTier,
  deriveKitStatus,
  isLowStock,
  nextDisplayNo,
  type KitLine,
} from "./inventoryRules.js";

describe("isLowStock", () => {
  it("is low at the reorder point, not only below it", () => {
    expect(isLowStock({ quantityOnHand: 4, reorderPoint: 4 })).toBe(true);
    expect(isLowStock({ quantityOnHand: 3, reorderPoint: 4 })).toBe(true);
    expect(isLowStock({ quantityOnHand: 5, reorderPoint: 4 })).toBe(false);
  });

  it("honours a reorder point of zero — 'tell me when this hits nothing' is a real ask", () => {
    expect(isLowStock({ quantityOnHand: 0, reorderPoint: 0 })).toBe(true);
    expect(isLowStock({ quantityOnHand: 1, reorderPoint: 0 })).toBe(false);
  });

  it("is NOT low when no reorder point is set, however empty the shelf", () => {
    // Missing and lapsed are different facts (inspectionExpiry's ruling). Nobody has said what
    // 'enough' means here, so the system has not established a shortage.
    expect(isLowStock({ quantityOnHand: 0, reorderPoint: null })).toBe(false);
  });
});

describe("deriveKitStatus", () => {
  const strap = "strap";
  const chain = "chain";
  const fridge = "fridge";

  it("is complete when every expected line is held exactly", () => {
    const r = deriveKitStatus(
      [{ assetTypeId: strap, quantity: 4 }],
      [{ assetTypeId: strap, quantity: 4 }],
    );
    expect(r.state).toBe("complete");
    expect(r.shortBy).toBe(0);
    expect(r.extraBy).toBe(0);
  });

  it("counts the missing units, not the missing lines", () => {
    const r = deriveKitStatus(
      [{ assetTypeId: strap, quantity: 4 }],
      [{ assetTypeId: strap, quantity: 1 }],
    );
    expect(r.state).toBe("short");
    expect(r.shortBy).toBe(3);
    expect(r.lines).toEqual([{ assetTypeId: strap, expected: 4, held: 1, delta: -3 }]);
  });

  it("treats an entirely absent type as short by its whole quantity", () => {
    const r = deriveKitStatus([{ assetTypeId: fridge, quantity: 1 }], []);
    expect(r.state).toBe("short");
    expect(r.shortBy).toBe(1);
    expect(r.lines).toEqual([{ assetTypeId: fridge, expected: 1, held: 0, delta: -1 }]);
  });

  it("reports something held but not expected as extra, after the expected lines", () => {
    const r = deriveKitStatus(
      [{ assetTypeId: strap, quantity: 2 }],
      [
        { assetTypeId: strap, quantity: 2 },
        { assetTypeId: chain, quantity: 1 },
      ],
    );
    expect(r.state).toBe("extra");
    expect(r.extraBy).toBe(1);
    expect(r.lines).toEqual([
      { assetTypeId: strap, expected: 2, held: 2, delta: 0 },
      { assetTypeId: chain, expected: 0, held: 1, delta: 1 },
    ]);
  });

  it("calls a trailer short when it is both short and carrying a spare", () => {
    // The state is what somebody must act on. A missing strap is a load that cannot be secured;
    // a spare chain is untidy. A surplus must never hide a shortfall behind one word.
    const r = deriveKitStatus(
      [
        { assetTypeId: strap, quantity: 4 },
        { assetTypeId: chain, quantity: 2 },
      ],
      [
        { assetTypeId: strap, quantity: 3 },
        { assetTypeId: chain, quantity: 3 },
      ],
    );
    expect(r.state).toBe("short");
    expect(r.shortBy).toBe(1);
    expect(r.extraBy).toBe(1);
  });

  it("sums duplicate lines rather than dropping one — the default row plus the per-unit override", () => {
    const expected: KitLine[] = [
      { assetTypeId: strap, quantity: 2 },
      { assetTypeId: strap, quantity: 2 },
    ];
    const r = deriveKitStatus(expected, [{ assetTypeId: strap, quantity: 4 }]);
    expect(r.state).toBe("complete");
    expect(r.lines).toEqual([{ assetTypeId: strap, expected: 4, held: 4, delta: 0 }]);
  });

  it("is complete for an empty expectation and an empty hold", () => {
    expect(deriveKitStatus([], []).state).toBe("complete");
  });
});

describe("countVarianceTier — D-INV21", () => {
  it("does not interrupt a small variance on a small shelf", () => {
    expect(countVarianceTier(12, 10)).toBe("none");
    expect(countVarianceTier(12, 12)).toBe("none");
  });

  it("never fires the recount rung on a variance the floor forgave", () => {
    // 12 → 10 is 16.7 %, over the 10 % line, but only 2, under the floor of 5. Applied as two
    // independent tests this asks for a second counter on a bin nobody was asked to confirm.
    const variance = Math.abs(10 - 12);
    expect(variance).toBeLessThanOrEqual(COUNT_CONFIRM_FLOOR);
    expect(variance / 12).toBeGreaterThan(0.1);
    expect(countVarianceTier(12, 10)).toBe("none");
  });

  it("goes straight from none to recount on a small shelf, at the floor", () => {
    expect(countVarianceTier(40, 35)).toBe("none");
    expect(countVarianceTier(40, 34)).toBe("recount");
  });

  it("has no numeric confirm rung at all below ~50 expected, and that is structural", () => {
    // Worth pinning because a count-screen author will look for it. Both rungs share the floor of
    // 5, and confirm's proportion (5 %) is lower than recount's (10 %), so a confirm can only exist
    // where 10 % of expected exceeds 5 — i.e. above 50. On smaller bins the only route to `confirm`
    // is the zero-against-non-zero rule. Being 6 out of 12 wrong genuinely is worth a second pair
    // of eyes, so the gap is acceptable; being surprised by it in the UI would not be.
    for (const expected of [10, 20, 40, 50]) {
      const tiers = new Set<string>();
      for (let counted = 0; counted <= expected * 2; counted += 1) {
        if (counted === 0) continue; // the zero rule is tested separately
        tiers.add(countVarianceTier(expected, counted));
      }
      expect(tiers.has("confirm")).toBe(false);
    }
    // And above it, the confirm rung exists.
    expect(countVarianceTier(400, 379)).toBe("confirm");
  });

  it("uses the proportion once the shelf is big enough for it to exceed the floor", () => {
    // 5 % of 400 is 20, well over the floor of 5.
    expect(countVarianceTier(400, 385)).toBe("none");
    expect(countVarianceTier(400, 379)).toBe("confirm");
    expect(countVarianceTier(400, 359)).toBe("recount");
  });

  it("confirms a zero against a non-zero even when the numbers are tiny", () => {
    expect(countVarianceTier(3, 0)).toBe("confirm");
  });

  it("does not escalate that tiny zero to a second counter", () => {
    // Making another person walk over for three of something is how a discipline gets ignored.
    expect(countVarianceTier(3, 0)).not.toBe("recount");
  });

  it("does escalate a zero against a large expectation, by ordinary arithmetic", () => {
    expect(countVarianceTier(120, 0)).toBe("recount");
  });

  it("treats an overcount the same as an undercount", () => {
    expect(countVarianceTier(400, 441)).toBe("recount");
  });

  it("stops for six of something the shelf says it has none of, but not for three", () => {
    expect(countVarianceTier(0, 6)).toBe("recount");
    expect(countVarianceTier(0, 3)).toBe("none");
  });
});

describe("nextDisplayNo — D-INV18", () => {
  it("prints the shape the plan spells out", () => {
    expect(nextDisplayNo(412)).toBe("A-0412");
    expect(nextDisplayNo(1)).toBe("A-0001");
  });

  it("keeps a fixed width past the first block instead of growing the digits", () => {
    // A-10000 sorts before A-9999 in every list and printed sheet in the product.
    expect(nextDisplayNo(9999)).toBe("A-9999");
    expect(nextDisplayNo(10_000)).toBe("B-0001");
    expect(nextDisplayNo(19_998)).toBe("B-9999");
    expect(nextDisplayNo(19_999)).toBe("C-0001");
  });

  it("sorts lexically across a block boundary, which is the point of the rolling", () => {
    const numbers = [nextDisplayNo(9999), nextDisplayNo(10_000), nextDisplayNo(1)];
    expect([...numbers].sort()).toEqual(["A-0001", "A-9999", "B-0001"]);
  });

  it("throws past Z-9999 rather than emitting a number that collides", () => {
    expect(nextDisplayNo(DISPLAY_NO_MAX_SEQUENCE)).toBe("Z-9999");
    expect(() => nextDisplayNo(DISPLAY_NO_MAX_SEQUENCE + 1)).toThrow(/exhausted/);
  });

  it("refuses a zero or negative sequence", () => {
    expect(() => nextDisplayNo(0)).toThrow(/start at 1/);
    expect(() => nextDisplayNo(-1)).toThrow(/start at 1/);
    expect(() => nextDisplayNo(1.5)).toThrow(/start at 1/);
  });
});
