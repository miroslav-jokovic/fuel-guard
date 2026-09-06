import { describe, it, expect } from "vitest";
import { quarterLabel, ledgerTiles } from "./useFindingsSummary";

/**
 * The quarter a recovered figure covers, said on the tile.
 *
 * "Recovered $1,161" with no period is a number nobody can check. The label is derived from the same
 * `quarterFrom` the API computed rather than from the browser's clock, so the words above the figure
 * and the window behind it cannot disagree — a tile rendered at 23:00 on 31 December in Chicago would
 * otherwise name the quarter that starts in an hour.
 */
describe("naming the quarter a recovery figure covers", () => {
  it("reads the quarter off the date the API measured, not off the reader's clock", () => {
    expect(quarterLabel("2026-01-01")).toBe("Q1 2026");
    expect(quarterLabel("2026-04-01")).toBe("Q2 2026");
    expect(quarterLabel("2026-07-01")).toBe("Q3 2026");
    expect(quarterLabel("2026-10-01")).toBe("Q4 2026");
  });
});

/**
 * Which tiles a caller gets, which is C9's whole ruling expressed as a render decision.
 *
 * The Dashboard has no section gate — every authenticated member opens it — so the API answers per
 * row and the page renders what it is given. `null` and `0` are the two answers that must not be
 * confused: one means "nothing you may see" and the other means "nothing".
 */
const ICONS = { open: "open-icon", money: "money-icon" };
const FMT = {
  int: (n: number) => String(n),
  compact: (n: number) => String(n),
  money: (n: number) => `$${n.toFixed(2)}`,
};
const tiles = (o: Partial<Parameters<typeof ledgerTiles>[0] & object> | null) =>
  ledgerTiles(o === null ? null : ({ quarterFrom: "2026-07-01", open: null, recoveredThisQuarter: null, ...o } as never), ICONS, FMT);

describe("which ledger tiles a caller gets", () => {
  it("renders both for somebody who may see both", () => {
    expect(tiles({ open: 158, recoveredThisQuarter: 1161.55 }).map((t) => t.label)).toEqual([
      "Open findings",
      "Recovered",
    ]);
  });

  // ⚠ The ruling in one assertion. A driver is told NOTHING, not told zero — a tile reading 0 would
  // claim the fleet has no findings, which this page is not entitled to say to them.
  it("renders nothing at all for a caller the API answered null", () => {
    expect(tiles({ open: null, recoveredThisQuarter: null })).toEqual([]);
    expect(tiles(null)).toEqual([]);
  });

  it("renders a real zero, because an org with nothing outstanding has earned the number", () => {
    const t = tiles({ open: 0, recoveredThisQuarter: 0 });
    expect(t.map((x) => x.label)).toEqual(["Open findings", "Recovered"]);
    expect(t[0]!.value).toBe("0");
    // Green rather than amber: nothing outstanding is good news and should not read as a warning.
    expect(t[0]!.tone).toContain("success");
  });

  // The bookkeeper sees money findings and no theft cases, so they get the count and the money and
  // the count is smaller. The page does not decide that — it renders what it was told.
  it("renders only the money tile when the count was withheld, and vice versa", () => {
    expect(tiles({ open: null, recoveredThisQuarter: 900 }).map((t) => t.label)).toEqual(["Recovered"]);
    expect(tiles({ open: 76, recoveredThisQuarter: null }).map((t) => t.label)).toEqual(["Open findings"]);
  });

  it("sends each tile to the queue it counts", () => {
    const t = tiles({ open: 5, recoveredThisQuarter: 10 });
    expect(t[0]!.to).toEqual({ path: "/findings" });
    // Recovered is money that was closed, so it opens the closed queue rather than the working one.
    expect(t[1]!.to).toEqual({ path: "/findings", query: { state: "closed" } });
  });

  it("names the quarter on the money tile, so the figure has a period", () => {
    expect(tiles({ recoveredThisQuarter: 10 })[0]!.sub).toBe("Q3 2026");
  });
});
