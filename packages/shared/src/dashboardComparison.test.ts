import { describe, expect, it } from "vitest";
import { deltaLabel, deltaTone, periodDelta, previousWindow } from "./dashboardComparison.js";

describe("previousWindow", () => {
  it("is the same number of days, ending the day before the window starts", () => {
    // 31 days inclusive, the dashboard's default (-30 … today).
    expect(previousWindow({ from: "2026-08-19", to: "2026-09-18" })).toEqual({ from: "2026-07-19", to: "2026-08-18" });
  });

  it("gives a single day the single day before it", () => {
    expect(previousWindow({ from: "2026-03-01", to: "2026-03-01" })).toEqual({ from: "2026-02-28", to: "2026-02-28" });
  });

  it("crosses a year boundary by the calendar, not by any clock", () => {
    expect(previousWindow({ from: "2026-01-01", to: "2026-01-07" })).toEqual({ from: "2025-12-25", to: "2025-12-31" });
  });
});

describe("periodDelta", () => {
  it("reports the absolute and percent change with its direction", () => {
    expect(periodDelta(1_300_000, 1_160_000)).toEqual({ abs: 140_000, pct: expect.closeTo(12.07, 2), direction: "up" });
    expect(periodDelta(7.42, 7.72)).toMatchObject({ direction: "down" });
  });

  it("is null when either side is missing, so no pill can be drawn against an absent number", () => {
    expect(periodDelta(null, 10)).toBeNull();
    expect(periodDelta(10, undefined)).toBeNull();
    expect(periodDelta(Number.NaN, 10)).toBeNull();
  });

  it("has no percent against a zero previous, but still a direction", () => {
    expect(periodDelta(40, 0)).toEqual({ abs: 40, pct: null, direction: "up" });
    expect(periodDelta(0, 0)).toEqual({ abs: 0, pct: null, direction: "flat" });
  });

  it("calls a change that would print as 0.0% flat (D-DT4)", () => {
    expect(periodDelta(10_000.4, 10_000)).toMatchObject({ direction: "flat" });
    expect(periodDelta(10_006, 10_000)).toMatchObject({ direction: "up" });
  });
});

describe("deltaTone", () => {
  it("is the caller's verdict: up is bad for spend and good for MPG (D-DT8)", () => {
    const up = periodDelta(12, 10)!;
    expect(deltaTone(up, false)).toBe("bad");
    expect(deltaTone(up, true)).toBe("good");
    const down = periodDelta(10, 12)!;
    expect(deltaTone(down, false)).toBe("good");
    expect(deltaTone(down, true)).toBe("bad");
  });

  it("is neutral when flat, whichever way is good", () => {
    const flat = periodDelta(10, 10)!;
    expect(deltaTone(flat, true)).toBe("neutral");
    expect(deltaTone(flat, false)).toBe("neutral");
  });
});

describe("deltaLabel", () => {
  it("prints whole percents from 10 up and one decimal below, with no sign or arrow", () => {
    expect(deltaLabel(periodDelta(1_120, 1_000)!)).toBe("12%");
    expect(deltaLabel(periodDelta(1_034, 1_000)!)).toBe("3.4%");
    expect(deltaLabel(periodDelta(966, 1_000)!)).toBe("3.4%");
  });

  it("prints the measure's own unit when asked, which is how MPG reads", () => {
    expect(deltaLabel(periodDelta(7.72, 7.42)!, "abs")).toBe("0.3");
  });

  it("falls back to the absolute change when there is no previous to take a percent of", () => {
    expect(deltaLabel(periodDelta(40, 0)!)).toBe("40");
  });

  it("is empty when flat — the pill draws a dash alone (D-DT4)", () => {
    expect(deltaLabel(periodDelta(10, 10)!)).toBe("");
  });
});
