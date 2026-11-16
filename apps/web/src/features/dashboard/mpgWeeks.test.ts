import { describe, expect, it } from "vitest";
import { bandOf, partWeekNote, readWeeks, weekCaption } from "./mpgWeeks";

/**
 * The Fleet MPG card's weeks (SMALL-SCREENS-PLAN.md D-SM13). The default range on 2026-11-16 opened on
 * a Saturday, so its first calendar bucket was Sat–Sun and read 6.30 between full weeks of ~7.0.
 */
const full = (from: string, to: string, mpg: number | null) => ({ from, to, mpg, partial: false });

describe("the Fleet MPG card's weeks", () => {
  it("calls a Monday-to-Sunday bucket a full week and a clamped one a part-week, with its days", () => {
    const [first, mid, last] = readWeeks([
      full("2026-10-17", "2026-10-18", 6.3),
      full("2026-10-19", "2026-10-25", 6.96),
      { from: "2026-11-10", to: "2026-11-15", mpg: 6.6, partial: true },
    ]);
    expect(first).toMatchObject({ days: 2, full: false });
    expect(mid).toMatchObject({ days: 7, full: true });
    expect(last).toMatchObject({ days: 6, full: false });
  });

  it("does not call a seven-day bucket full when the roll-up stopped short of it", () => {
    expect(readWeeks([{ from: "2026-11-09", to: "2026-11-15", mpg: 7, partial: true }])[0]!.full).toBe(false);
  });

  it("builds last period's band from its full weeks only, so a weekend stub cannot widen it", () => {
    const weeks = readWeeks([
      full("2026-09-19", "2026-09-20", 5.4),
      full("2026-09-21", "2026-09-27", 7.74),
      full("2026-09-28", "2026-10-04", 7.34),
      full("2026-10-05", "2026-10-11", null),
    ]);
    expect(bandOf(weeks)).toEqual({ lo: 7.34, hi: 7.74 });
  });

  it("draws no band when last period had no full measured week", () => {
    expect(bandOf(readWeeks([full("2026-09-19", "2026-09-20", 6.1)]))).toBeNull();
  });

  it("names a part-week by its dates and days, and says nothing when every week is full", () => {
    const weeks = readWeeks([full("2026-10-17", "2026-10-18", 6.3), full("2026-10-19", "2026-10-25", 6.96)]);
    expect(partWeekNote(weeks)).toContain("10/17 – 10/18 (2 days)");
    expect(partWeekNote(weeks.slice(1))).toBeNull();
    expect(weekCaption(weeks[0]!)).toBe("10/17 – 10/18 · 2 days");
    expect(weekCaption(weeks[1]!)).toBe("week of 10/19");
  });
});
