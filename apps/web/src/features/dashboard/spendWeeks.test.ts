import { describe, expect, it } from "vitest";
import { drawsWeeks, fmtMoneyShort, spendBand, spendWeeks } from "./spendWeeks";

/**
 * The Fuel spend card's weeks (SMALL-SCREENS-PLAN.md D-SM15). On 2026-11-16 the default range opened
 * on a Saturday, and a phone gave each of its 31 days 8 px.
 */
const days = (from: string, values: (number | null)[]) =>
  values.map((value, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), value };
  });

describe("the Fuel spend card's weeks", () => {
  it("cuts the days on Monday and sums each week's dollars", () => {
    // Sat 10/17, Sun 10/18, then Mon 10/19 … Sun 10/25, then Mon 10/26.
    const weeks = spendWeeks(days("2026-10-17", [100, 50, 10, 10, 10, 10, 10, 10, 10.25, 7]));
    expect(weeks.map((w) => [w.from, w.to, w.days, w.full, w.total])).toEqual([
      ["2026-10-17", "2026-10-18", 2, false, 150],
      ["2026-10-19", "2026-10-25", 7, true, 70.25],
      ["2026-10-26", "2026-10-26", 1, false, 7],
    ]);
  });

  it("does not call a seven-day week full when one of its days has no figure", () => {
    const [w] = spendWeeks(days("2026-10-19", [10, 10, null, 10, 10, 10, 10]));
    expect(w).toMatchObject({ days: 7, full: false, total: 60 });
  });

  it("gives a week with no figure at all no total, not a zero", () => {
    expect(spendWeeks(days("2026-10-19", [null, null]))[0]!.total).toBeNull();
  });

  it("builds last period's band from its full weeks only", () => {
    const prev = spendWeeks(days("2026-09-19", [5, 5, ...Array(7).fill(40), ...Array(7).fill(45), 1]));
    expect(spendBand(prev)).toEqual({ lo: 280, hi: 315 });
  });

  it("draws weeks on a phone and a tablet, and days on a wide desktop card (31 days, widths measured 11-16)", () => {
    expect(drawsWeeks(318, 31)).toBe(true); // 390 px phone
    expect(drawsWeeks(680, 31)).toBe(true); // 768 px tablet, full-width card
    expect(drawsWeeks(804, 31)).toBe(true); // 1180 px tablet
    expect(drawsWeeks(904, 31)).toBe(false); // 1280 px desktop, one column
    expect(drawsWeeks(318, 7)).toBe(false); // a week's range fits a phone as days
    expect(drawsWeeks(0, 0)).toBe(false);
  });

  it("writes a bar's dollars short", () => {
    expect([fmtMoneyShort(297181), fmtMoneyShort(1_277_527), fmtMoneyShort(2_000_000), fmtMoneyShort(640)]).toEqual(["$297k", "$1.3M", "$2M", "$640"]);
  });
});
