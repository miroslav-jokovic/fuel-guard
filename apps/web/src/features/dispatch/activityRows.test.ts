import { describe, expect, it } from "vitest";
import { compareIdle, idleTone, passesIdle } from "./activityRows";

/** LOADS-ACTIVITY-PLAN D-LA7: the Activity view's threshold, order and colour. */
const row = (name: string, days: number | null, onLoad = false) => ({
  name, daysWithoutLoad: onLoad ? 0 : days, currentLoad: onLoad ? { id: "L", ref: "L", empty: false } : null,
});

describe("passesIdle", () => {
  it("keeps rows at or past the threshold, and never a driver with a load on the truck", () => {
    expect(passesIdle(row("a", 3), "3")).toBe(true);
    expect(passesIdle(row("b", 2), "3")).toBe(false);
    expect(passesIdle(row("c", 0, true), "2")).toBe(false);
  });

  it("counts 'no delivery in range' past every threshold, and alone under 'No delivery in range'", () => {
    expect(passesIdle(row("d", null), "7")).toBe(true);
    expect(passesIdle(row("d", null), "none")).toBe(true);
    expect(passesIdle(row("e", 9), "none")).toBe(false);
    expect(passesIdle(row("f", 0, true), "")).toBe(true);
  });
});

describe("compareIdle", () => {
  it("puts no delivery in range first, then the longest, then those on a load, ties by name", () => {
    const rows = [row("Zed", 2), row("On", 0, true), row("Amy", 5), row("None", null), row("Bob", 5)];
    expect(rows.sort(compareIdle((r) => r.name)).map((r) => r.name)).toEqual(["None", "Amy", "Bob", "Zed", "On"]);
  });
});

describe("idleTone", () => {
  it.each([
    [0, true, "success"],
    [2, false, "neutral"],
    [3, false, "warning"],
    [7, false, "danger"],
    [null, false, "danger"],
  ] as const)("%s days, on a load %s → %s", (days, hasLoad, tone) => {
    expect(idleTone(days, hasLoad)).toBe(tone);
  });
});
