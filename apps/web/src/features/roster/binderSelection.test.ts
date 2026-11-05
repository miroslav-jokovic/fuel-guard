import { describe, expect, it } from "vitest";
import { DQ_EXPORT_MAX_DRIVERS } from "@silvicom/shared";
import { capSelection, selectionFull } from "./binderSelection";

const ids = (n: number, from = 0) => new Set(Array.from({ length: n }, (_, i) => `d${from + i}`));

describe("capSelection (DQ-INTO-DRIVERS-PLAN DD2)", () => {
  it("keeps a selection at or under one binder's limit whole", () => {
    const r = capSelection(ids(DQ_EXPORT_MAX_DRIVERS));
    expect(r.selected.size).toBe(DQ_EXPORT_MAX_DRIVERS);
    expect(r.capped).toBe(false);
  });

  it("keeps the first ticked when two pages' worth pass the limit, and says it turned some away", () => {
    // Page one ticked whole (20), then page two ticked whole (20 more): 40 asked for.
    const next = new Set([...ids(20), ...ids(20, 20)]);
    const r = capSelection(next);
    expect(r.capped).toBe(true);
    expect([...r.selected]).toEqual([...next].slice(0, DQ_EXPORT_MAX_DRIVERS));
  });

  it("calls a selection full exactly at the limit", () => {
    expect(selectionFull(ids(DQ_EXPORT_MAX_DRIVERS - 1))).toBe(false);
    expect(selectionFull(ids(DQ_EXPORT_MAX_DRIVERS))).toBe(true);
  });
});
