import { describe, expect, it } from "vitest";
import { bucketsOf, monthsOfSpan, rollUp, weekStart, type RollupRepair, type RollupUnit } from "./fleetpalRollup.js";

const units: RollupUnit[] = [
  { fleetpalId: "u-777", number: "777", vehicleId: "truck-777", trailerId: null },
  // The duplicate-unit case: an old FleetPal record and its replacement, both mapped to one truck.
  { fleetpalId: "u-777-old", number: "777 OLD", vehicleId: "truck-777", trailerId: null },
  { fleetpalId: "u-t9", number: "T9", vehicleId: null, trailerId: "trailer-9" },
  { fleetpalId: "u-sold", number: "SOLD", vehicleId: null, trailerId: null },
];
const repair = (unitFleetpalId: string | null, day: string, total: number | null, labor: number | null = null): RollupRepair => ({
  unitFleetpalId,
  day,
  total,
  labor,
});

describe("buckets", () => {
  it("weeks start on Monday", () => {
    expect(weekStart("2026-11-16")).toBe("2026-11-16"); // a Monday
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // the Sunday after
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
  });

  it("a week that straddles a month end carries BOTH months' bounds, clipped to the window (Q10 (a))", () => {
    const weeks = bucketsOf("2026-07-01", "2026-08-01", "week");
    expect(weeks[0]).toMatchObject({ key: "2026-06-29", from: "2026-07-01", to: "2026-07-06", months: ["2026-07"] });
    expect(weeks.at(-1)).toMatchObject({ key: "2026-07-27", from: "2026-07-27", to: "2026-08-01", months: ["2026-07"] });
    const straddle = bucketsOf("2026-07-20", "2026-08-10", "week").find((w) => w.key === "2026-07-27")!;
    expect(straddle.months).toEqual(["2026-07", "2026-08"]);
  });

  it("a year bucket names every month it spans, so a missing one can be named", () => {
    const [year] = bucketsOf("2026-01-01", "2026-04-01", "year");
    expect(year).toMatchObject({ key: "2026", from: "2026-01-01", to: "2026-04-01", months: ["2026-01", "2026-02", "2026-03"] });
  });

  it("months of a span", () => {
    expect(monthsOfSpan("2025-12-15", "2026-02-01")).toEqual(["2025-12", "2026-01"]);
  });
});

describe("rollUp", () => {
  const window = { from: "2026-07-01", to: "2026-09-01", bucket: "month" as const, kind: "all" as const };

  it("prints both values on every row: operational with labour, external without (D-FP18)", () => {
    const r = rollUp([repair("u-777", "2026-07-10", 1000, 300), repair("u-777", "2026-07-11", 200)], units, window);
    expect(r.buckets[0]!.fleet).toEqual({ operational: 1200, external: 900, repairs: 2, unpriced: 0 });
  });

  it("an unpriced repair is counted and never summed as zero; a bucket with nothing priced stays null", () => {
    const r = rollUp([repair("u-777", "2026-08-03", null)], units, window);
    expect(r.buckets[1]!.fleet).toEqual({ operational: null, external: null, repairs: 1, unpriced: 1 });
    expect(r.buckets[0]!.fleet).toEqual({ operational: null, external: null, repairs: 0, unpriced: 0 });
  });

  it("splits tractors, trailers and unmatched from FleetPal's own mapping (D-FP19, D-FP14)", () => {
    const r = rollUp(
      [repair("u-777", "2026-07-10", 100), repair("u-t9", "2026-07-10", 40, 10), repair("u-sold", "2026-07-10", 7), repair(null, "2026-07-10", 3)],
      units,
      window,
    );
    expect(r.buckets[0]!.byKind).toMatchObject({
      tractor: { operational: 100 },
      trailer: { operational: 40, external: 30 },
      unmatched: { operational: 10, repairs: 2 },
    });
  });

  it("folds every FleetPal unit mapped to one truck into that truck's row — never half its spend", () => {
    const r = rollUp([repair("u-777", "2026-07-10", 100), repair("u-777-old", "2026-08-10", 50)], units, window);
    const truck = r.units.find((u) => u.vehicleId === "truck-777")!;
    expect(truck.total.operational).toBe(150);
    expect(truck.fleetpalUnitIds.sort()).toEqual(["u-777", "u-777-old"]);
    expect(truck.buckets).toMatchObject({ "2026-07": { operational: 100 }, "2026-08": { operational: 50 } });
  });

  it("a kind filter narrows the fleet line and the rows, but byKind still says what it left out", () => {
    const r = rollUp([repair("u-777", "2026-07-10", 100), repair("u-t9", "2026-07-10", 40)], units, { ...window, kind: "trailer" });
    expect(r.buckets[0]!.fleet.operational).toBe(40);
    expect(r.buckets[0]!.byKind.tractor.operational).toBe(100);
    expect(r.units.map((u) => u.kind)).toEqual(["trailer"]);
  });

  it("drops a repair outside the window and orders rows costliest first", () => {
    const r = rollUp([repair("u-777", "2026-06-30", 999), repair("u-t9", "2026-07-02", 5), repair("u-777", "2026-07-02", 9)], units, window);
    expect(r.units.map((u) => u.total.operational)).toEqual([9, 5]);
  });

  it("a unit mapped to both a truck and a trailer is unmatched, not counted twice", () => {
    const r = rollUp([repair("u-both", "2026-07-10", 10)], [{ fleetpalId: "u-both", number: "X", vehicleId: "v", trailerId: "t" }], window);
    expect(r.buckets[0]!.byKind).toMatchObject({ unmatched: { operational: 10 }, tractor: { operational: null }, trailer: { operational: null } });
  });
});
