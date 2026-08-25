import { describe, it, expect } from "vitest";
import { change, daysBetween, rangeLabel, shortDay, usdCompact, windowLabel } from "./fuelSpendReportFormat.js";

/**
 * The date helpers exist because the document used to print ISO dates at a boss, and "2026-08-17 -
 * 2026-08-23" wrapped to two lines in a 92pt column — which doubled every row of the week-by-week
 * table. They are pinned here rather than left to the render because the failure they are most likely
 * to have is a silent off-by-one, and an off-by-one in a period label is a report that names the wrong
 * week.
 */
describe("period labels", () => {
  it("reads a calendar day as UTC, not as local midnight", () => {
    // `new Date("2026-08-17")` west of Greenwich is the 16th. These are days from `fuel_spend_days`,
    // not instants, and the whole document is stamped in UTC.
    expect(shortDay("2026-08-17")).toBe("Aug 17");
    expect(shortDay("2026-01-01")).toBe("Jan 1");
    expect(shortDay("2026-12-31")).toBe("Dec 31");
  });

  it("collapses the month when a range does not cross one", () => {
    expect(rangeLabel("2026-08-17", "2026-08-23")).toBe("Aug 17 - 23");
  });

  it("keeps both months when it does", () => {
    expect(rangeLabel("2026-06-29", "2026-07-05")).toBe("Jun 29 - Jul 5");
  });

  it("prints one date for a single-day period rather than the same date twice", () => {
    expect(rangeLabel("2026-08-17", "2026-08-17")).toBe("Aug 17");
  });

  it("puts the year on the letterhead once, and twice only when the window crosses one", () => {
    expect(windowLabel("2026-06-01", "2026-08-23")).toBe("Jun 1 - Aug 23, 2026");
    expect(windowLabel("2025-12-28", "2026-01-03")).toBe("Dec 28, 2025 - Jan 3, 2026");
  });

  it("falls back to the raw strings rather than inventing a date it could not parse", () => {
    expect(shortDay("not-a-date")).toBe("not-a-date");
    expect(rangeLabel("2026-08", "2026-09")).toBe("2026-08 - 2026-09");
  });

  it("counts days inclusively at both ends, and across a month boundary", () => {
    expect(daysBetween("2026-08-17", "2026-08-23")).toBe(7);
    expect(daysBetween("2026-08-17", "2026-08-17")).toBe(1);
    expect(daysBetween("2026-06-01", "2026-08-23")).toBe(84);
  });
});

describe("usdCompact", () => {
  /**
   * Only the KPI cards use this. A card is read at a glance and six digits in 17pt type is a number
   * the reader parses rather than sees; a table cell is read FOR the digits, which is why nothing in a
   * table goes through here.
   */
  it("abbreviates past ten thousand and keeps the digits below it", () => {
    expect(usdCompact(159_235)).toBe("$159k");
    expect(usdCompact(9_804)).toBe("$9,804");
    expect(usdCompact(10_400)).toBe("$10k");
  });

  it("keeps one decimal in the millions until it no longer earns its place", () => {
    expect(usdCompact(1_045_342)).toBe("$1.0M");
    expect(usdCompact(2_460_000)).toBe("$2.5M");
    expect(usdCompact(12_300_000)).toBe("$12M");
  });

  it("signs a negative rather than dropping the sign into the abbreviation", () => {
    expect(usdCompact(-159_235)).toBe("-$159k");
  });

  it("prints a dash for a figure nobody could measure, never $0", () => {
    expect(usdCompact(null)).toBe("-");
  });
});

describe("change", () => {
  /**
   * The sign and the preference resolved together. This was the other way round in one draft — the
   * flag said "which direction would be bad" and never met the sign — and every spend tile rendered
   * red whether spend rose or fell.
   */
  it("calls a rise in spend bad and a rise in MPG good", () => {
    expect(change(100, 110, true)).toEqual({ delta: "+10.0%", deltaIsBad: true });
    expect(change(6.0, 6.3, false)).toEqual({ delta: "+5.0%", deltaIsBad: false });
  });

  it("calls a fall in spend good and a fall in MPG bad", () => {
    expect(change(110, 100, true).deltaIsBad).toBe(false);
    expect(change(6.3, 6.0, false).deltaIsBad).toBe(true);
  });

  it("says nothing at all when there is nothing to compare against", () => {
    expect(change(null, 100, true)).toEqual({});
    expect(change(0, 100, true)).toEqual({});
    expect(change(100, 100, true)).toEqual({});
  });
});
