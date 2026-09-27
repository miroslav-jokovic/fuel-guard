import { describe, expect, it } from "vitest";
import { addressCoverage } from "./addressCoverage.js";

/**
 * §391.21(b)(3) in months (C3c1). Pinned: the window's first month must be covered, moving in the
 * month of moving out or the month after is continuous, overlaps merge, an address outside the window
 * counts only for the part inside it, and a malformed row is ignored rather than believed.
 */
describe("addressCoverage", () => {
  it("opens the window in the month three years before the application, and ends in its month", () => {
    const c = addressCoverage([], "2026-09-27");
    expect(c.start).toBe("2023-09");
    expect(c.end).toBe("2026-09");
    expect(c.gaps).toEqual([{ from: "2023-09", to: "2026-09" }]);
    expect(c.covered).toBe(false);
  });

  it("merges overlapping and adjacent addresses, in any order", () => {
    const c = addressCoverage([
      { from: "2025-01", to: null },
      { from: "2022-01", to: "2024-06" },
      { from: "2024-03", to: "2024-12" },
    ], "2026-09-27");
    expect(c.gaps).toEqual([]);
    expect(c.covered).toBe(true);
  });

  it("treats a blank end month as the current address, running to the application", () => {
    expect(addressCoverage([{ from: "2020-01", to: "" }], "2026-09-27").covered).toBe(true);
  });

  it("finds a gap at the start, in the middle and at the end at once", () => {
    const c = addressCoverage([
      { from: "2023-11", to: "2024-01" },
      { from: "2024-04", to: "2026-07" },
    ], "2026-09-27");
    expect(c.gaps).toEqual([
      { from: "2023-09", to: "2023-10" },
      { from: "2024-02", to: "2024-03" },
      { from: "2026-08", to: "2026-09" },
    ]);
  });

  it("crosses a year boundary without inventing a month thirteen", () => {
    const c = addressCoverage([{ from: "2020-01", to: "2024-11" }, { from: "2025-02", to: null }], "2026-01-15");
    expect(c.start).toBe("2023-01");
    expect(c.gaps).toEqual([{ from: "2024-12", to: "2025-01" }]);
  });

  it("ignores a row it cannot read, or one that ends before it begins", () => {
    const c = addressCoverage([{ from: "soon", to: null }, { from: "2025-05", to: "2024-01" }], "2026-09-27");
    expect(c.gaps).toEqual([{ from: "2023-09", to: "2026-09" }]);
  });
});
