import { describe, it, expect } from "vitest";
import { daysInRange } from "./calendarDay.js";
import { IDLE_DEFAULT_WINDOW_DAYS, idleWindow } from "./idleTotals.js";

/**
 * The idle views' window with nothing picked. Each of the four readers had computed `today - 30`, which is 31
 * dates under a "last 30 days" label (2026-10-04, design verdict E8 on date-preset cardinality).
 */
describe("idleWindow", () => {
  it("with nothing picked, is the last 30 dates ending on the carrier's today", () => {
    const w = idleWindow({}, "2026-10-04");
    expect(w).toEqual({ from: "2026-09-05", to: "2026-10-04" });
    expect(daysInRange(w.from, w.to)).toBe(IDLE_DEFAULT_WINDOW_DAYS);
    expect(IDLE_DEFAULT_WINDOW_DAYS).toBe(30);
  });

  it("keeps a picked range exactly as picked", () => {
    expect(idleWindow({ from: "2026-09-01", to: "2026-09-30" }, "2026-10-04")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("with only an end picked, counts the 30 dates back from that end, not from today", () => {
    expect(idleWindow({ to: "2026-09-30" }, "2026-10-04")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("with only a start picked, runs to today", () => {
    expect(idleWindow({ from: "2026-09-20" }, "2026-10-04")).toEqual({ from: "2026-09-20", to: "2026-10-04" });
  });
});
