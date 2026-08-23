import { describe, it, expect } from "vitest";
import {
  sevenDayStatementCreateSchema,
  sevenDayTotal,
  sevenDayWindow,
  sevenDayWindowMismatch,
} from "./sevenDayStatement.js";

/**
 * §395.8(j)(2)'s arithmetic, which is the whole reason the statement exists: a carrier that does not
 * know what a new driver already worked cannot know what they may lawfully work today.
 */

const days = (dates: string[], hours: number[]): Array<{ date: string; hours: number }> =>
  dates.map((date, i) => ({ date, hours: hours[i] ?? 0 }));

describe("the seven-day window", () => {
  /**
   * ⚠ The statement's own day is NOT in the window. That is the regulation's wording — "the seven
   * days preceding the day the driver begins work" — and it is exactly the off-by-one somebody
   * corrects on a quiet afternoon, so it is pinned by a date a reader can check by hand.
   */
  it("is the seven days BEFORE the statement, oldest first", () => {
    expect(sevenDayWindow("2026-08-08")).toEqual([
      "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04",
      "2026-08-05", "2026-08-06", "2026-08-07",
    ]);
  });

  it("crosses a month boundary without arithmetic of its own", () => {
    expect(sevenDayWindow("2026-03-03")[0]).toBe("2026-02-24");
  });

  /** 2028 is a leap year; a helper doing its own day maths would land on the 29th or skip it. */
  it("crosses the end of February in a leap year", () => {
    expect(sevenDayWindow("2028-03-04")).toContain("2028-02-29");
  });
});

describe("sevenDayWindowMismatch", () => {
  const dates = sevenDayWindow("2026-08-08");

  it("passes a statement covering the right week", () => {
    expect(sevenDayWindowMismatch({ statement_date: "2026-08-08", days: days(dates, [8, 8, 8, 8, 8, 0, 0]) })).toBeNull();
  });

  /**
   * ⚠ Reported as the dates rather than as `false`. The hours are summed against a window, so a
   * window that is not the regulation's produces a lawful-looking total that is not — and a caller
   * that can only say "invalid" cannot tell the driver which day to fix.
   */
  it("names both sides when the dates drifted by a day", () => {
    const drifted = dates.map((d) => `2026-08-${String(Number(d.slice(8)) + 1).padStart(2, "0")}`);
    const out = sevenDayWindowMismatch({ statement_date: "2026-08-08", days: days(drifted, [8, 8, 8, 8, 8, 0, 0]) });
    expect(out?.expected[0]).toBe("2026-08-01");
    expect(out?.got[0]).toBe("2026-08-02");
  });
});

describe("sevenDayTotal", () => {
  it("adds the week up", () => {
    expect(sevenDayTotal(days(sevenDayWindow("2026-08-08"), [10, 11, 9, 8, 12, 0, 0]))).toBe(50);
  });

  /** Quarter-hours are §395.8's own grid, and floating-point addition of them is not exact. */
  it("does not accumulate floating-point dust", () => {
    expect(sevenDayTotal(days(sevenDayWindow("2026-08-08"), [0.1, 0.2, 0.1, 0, 0, 0, 0]))).toBe(0.4);
  });
});

describe("the create contract", () => {
  const base = {
    driver_id: "11111111-2222-4333-8444-555555555555",
    statement_date: "2026-08-08",
    days: days(sevenDayWindow("2026-08-08"), [8, 8, 8, 8, 8, 0, 0]),
    last_relieved_at: "2026-08-07T18:30:00Z",
    signed_name: "Susan Godfrey",
    signed_on: "2026-08-08",
  };

  it("accepts a complete statement", () => {
    expect(sevenDayStatementCreateSchema.safeParse(base).success).toBe(true);
  });

  /**
   * ⚠ Six days is refused, and this is not strictness for its own sake: a partial statement is not a
   * lenient one, it is an arithmetic base with a hole in it — worse than none, because it looks
   * complete. The database pins the same shape (0236's `seven_day_statements_days_shape`).
   */
  it("refuses a statement with six days", () => {
    expect(sevenDayStatementCreateSchema.safeParse({ ...base, days: base.days.slice(0, 6) }).success).toBe(false);
  });

  it("refuses a statement with eight", () => {
    const eight = [...base.days, { date: "2026-08-08", hours: 4 }];
    expect(sevenDayStatementCreateSchema.safeParse({ ...base, days: eight }).success).toBe(false);
  });

  it("allows a 23.75-hour day and refuses a 25-hour one", () => {
    const withHours = (h: number) => ({ ...base, days: [{ ...base.days[0]!, hours: h }, ...base.days.slice(1)] });
    expect(sevenDayStatementCreateSchema.safeParse(withHours(23.75)).success).toBe(true);
    expect(sevenDayStatementCreateSchema.safeParse(withHours(25)).success).toBe(false);
  });
});
