import { describe, it, expect } from "vitest";
import { robustWindowMiles, type WindowOdoRow } from "./anomalyRules/learning.js";
import {
  aggregateWindowOdo,
  windowMilesFromAggregate,
  windowMilesViaAggregate,
} from "./anomalyRules/windowMilesAggregate.js";

/**
 * FUEL-T3b's spike, as an executable answer.
 *
 * The question was whether the Fuel Log's "total miles" tile can be fed from a SQL aggregate without
 * any of `robustWindowMiles`'s constants moving into SQL — D-AG1's *"THIS SUMS. IT DOES NOT DERIVE"*.
 * The answer is yes, and the load-bearing claim is that these two implementations agree. So this suite
 * does not check a handful of hand-picked shapes: it ENUMERATES every combination of the row features
 * that matter and asserts equality on all of them. A seam is only worth having if the thing it replaces
 * is provably the same thing.
 */

const row = (entered: number | null, samsara: number | null, source: string | null): WindowOdoRow => ({
  enteredOdometer: entered,
  samsaraOdometer: samsara,
  samsaraSource: source,
});

describe("windowMilesFromAggregate — the same verdict, from a measurement instead of the rows", () => {
  // The features that change which branch `robustWindowMiles` takes: how many OBD readings there are,
  // whether the OBD span advances, how many entered readings there are, whether they regress, and by
  // how much relative to the ±1 tolerance. Enumerated rather than sampled.
  const CASES: { name: string; rows: WindowOdoRow[] }[] = [
    { name: "no rows at all", rows: [] },
    { name: "one row, nothing to span", rows: [row(1000, 1000, "obd")] },
    { name: "two OBD readings that advance", rows: [row(1000, 1000, "obd"), row(1100, 1100, "obd")] },
    { name: "two OBD readings that do NOT advance — null, never 0", rows: [row(1000, 1000, "obd"), row(1000, 1000, "obd")] },
    { name: "OBD advancing by exactly the tolerance — not more than, so suppressed", rows: [row(1000, 1000, "obd"), row(1001, 1001, "obd")] },
    { name: "OBD advancing by just over the tolerance", rows: [row(1000, 1000, "obd"), row(1001.5, 1001.5, "obd")] },
    { name: "one OBD reading only — falls through to entered", rows: [row(1000, 1000, "obd"), row(1100, null, null)] },
    { name: "GPS source is not OBD, so the entered branch decides", rows: [row(1000, 1000, "gps"), row(1200, 1200, "gps")] },
    { name: "reconstructed source is not OBD either", rows: [row(1000, 1000, "reconstructed"), row(1200, 1200, "reconstructed")] },
    { name: "entered rising cleanly", rows: [row(1000, null, null), row(1100, null, null), row(1200, null, null)] },
    { name: "entered with a backward step inside the tolerance", rows: [row(1000, null, null), row(999.5, null, null), row(1200, null, null)] },
    { name: "entered with a backward step exactly at the tolerance", rows: [row(1000, null, null), row(999, null, null), row(1200, null, null)] },
    { name: "entered with a backward step past the tolerance — a bad entry, so null", rows: [row(1000, null, null), row(900, null, null), row(1200, null, null)] },
    { name: "entered constant — monotonic but carries no distance", rows: [row(736, null, null), row(736, null, null), row(736, null, null)] },
    { name: "entered nulls interleaved, so the sequence is the non-null one", rows: [row(1000, null, null), row(null, null, null), row(1100, null, null)] },
    { name: "one entered reading only", rows: [row(1000, null, null), row(null, null, null)] },
    { name: "OBD present but null odometer — not a reading", rows: [row(1000, null, "obd"), row(1100, null, "obd")] },
    { name: "OBD readings out of order in value, span is max−min", rows: [row(null, 1200, "obd"), row(null, 1000, "obd")] },
    { name: "mixed sources, only two are OBD", rows: [row(1000, 1000, "obd"), row(1050, 1050, "gps"), row(1100, 1100, "obd")] },
    { name: "OBD did not move but entered did — OBD still decides, and suppresses", rows: [row(1000, 500, "obd"), row(1500, 500, "obd")] },
    // ── the coverage shapes (2026-09-05) ─────────────────────────────────────────────────────────
    { name: "OBD misses the OLDEST row — the window's start is not its start", rows: [row(1000, null, null), row(1400, 1400, "obd"), row(1800, 1800, "obd")] },
    { name: "OBD misses the NEWEST row", rows: [row(1000, 1000, "obd"), row(1400, 1400, "obd"), row(1800, null, null)] },
    { name: "OBD misses both ends but sits in the middle", rows: [row(1000, null, null), row(1400, 1400, "obd"), row(1600, 1600, "obd"), row(1800, null, null)] },
    { name: "OBD covers the ends with a gap in the middle — harmless", rows: [row(1000, 1000, "obd"), row(1400, null, null), row(1800, 1800, "obd")] },
    { name: "neither source reaches both ends", rows: [row(1000, null, null), row(null, 1400, "obd"), row(null, 1800, "obd")] },
    { name: "a row carrying nothing does not define an end", rows: [row(null, null, null), row(1000, 1000, "obd"), row(1800, 1800, "obd")] },
    { name: "the real 2026-08 window this fix came from", rows: [row(217390, null, null), row(218342, 218341.9, "obd"), row(219132, 219132.4, "obd")] },
  ];

  for (const c of CASES) {
    it(`agrees with robustWindowMiles: ${c.name}`, () => {
      expect(windowMilesViaAggregate(c.rows)).toEqual(robustWindowMiles(c.rows));
    });
  }

  // Beyond the enumerated shapes, a deterministic sweep over odometer sequences — no randomness, so a
  // failure is always reproducible (and `Math.random` is not available in this package's rule code).
  it("agrees on 4,096 generated sequences", () => {
    let checked = 0;
    for (let mask = 0; mask < 4096; mask++) {
      const rows: WindowOdoRow[] = [];
      let odo = 1000;
      for (let i = 0; i < 4; i++) {
        const bits = (mask >> (i * 3)) & 0b111;
        // bit 0: is this an OBD reading; bit 1: does the odometer step backwards; bit 2: is it null
        odo += bits & 0b010 ? -50 : 40;
        const isNull = Boolean(bits & 0b100);
        rows.push(row(isNull ? null : odo, bits & 0b001 ? odo : null, bits & 0b001 ? "obd" : null));
      }
      expect(windowMilesViaAggregate(rows)).toEqual(robustWindowMiles(rows));
      checked++;
    }
    expect(checked).toBe(4096);
  });
});

describe("aggregateWindowOdo — exactly what the SQL has to compute, stated executably", () => {
  it("measures the worst backward step without knowing what tolerance will judge it", () => {
    const agg = aggregateWindowOdo([row(1000, null, null), row(980, null, null), row(1200, null, null)]);
    expect(agg.enteredWorstStep).toBe(-20); // the measurement…
    // …and nothing in the aggregate says whether -20 is acceptable. That comparison is TypeScript's.
    expect(windowMilesFromAggregate(agg)).toEqual({ miles: null, basis: "none" });
    expect(windowMilesFromAggregate({ ...agg, enteredWorstStep: -0.5 })).toEqual({ miles: 220, basis: "entered" });
  });

  it("reports a never-decreasing sequence as a worst step of 0, not as its largest climb", () => {
    expect(aggregateWindowOdo([row(1000, null, null), row(1900, null, null)]).enteredWorstStep).toBe(0);
  });

  it("has no step to measure when there is at most one reading", () => {
    expect(aggregateWindowOdo([row(1000, null, null)]).enteredWorstStep).toBeNull();
    expect(aggregateWindowOdo([]).enteredWorstStep).toBeNull();
  });

  it("counts only OBD readings that actually carry an odometer", () => {
    const agg = aggregateWindowOdo([row(null, 1000, "obd"), row(null, null, "obd"), row(null, 1100, "gps")]);
    expect(agg).toMatchObject({ obdCount: 1, obdMin: 1000, obdMax: 1000 });
  });
});


/**
 * The coverage precondition (2026-09-05) — a source may only answer for a window whose ENDS it covers.
 *
 * ── THE DEFECT, MEASURED BEFORE IT WAS FIXED ────────────────────────────────────────────────────
 * `robustWindowMiles` preferred the OBD span as soon as TWO rows carried an OBD reading, whether or
 * not those rows reached the window's ends. Where the OLDEST fill had no OBD reading, everything the
 * truck drove before the first OBD reading vanished — and nothing contradicted it, because the number
 * that came back was a real span of real readings, just not of this window.
 *
 * On production 2026-09-05: across the 64 `cumulative_overfuel` cases a human had already dismissed as
 * false positives, this function returned **815 miles on average where the window's own odometers span
 * 1,552**. `burnable = windowMiles ÷ MPG` was therefore about half what it should have been, the
 * over-fuel ceiling fell by ~100 gallons, and ordinary two-day fuelling cleared it. Recomputed with
 * the coverage rule, 2 of the 51 testable cases still fire.
 *
 * The first test below is that exact window, to the decimal. It is the regression this suite exists to
 * hold, and it fails on the old implementation.
 */
describe("robustWindowMiles — a source may only answer for a window whose ends it covers", () => {
  it("measures the real 2026-08 window at 1,742 miles, not the 790.5 the OBD pair spans", () => {
    // Vehicle window 2026-08-25 → 08-28. The oldest fill has no OBD reading; the two that follow do,
    // and their span is the last 790.5 miles of a 1,742-mile window. The rule read 790.5 and accused
    // the truck of buying 445.53 gal it could not have burned.
    const rows = [
      row(217390, null, null),
      row(218342, 218341.9, "obd"),
      row(219132, 219132.4, "obd"),
    ];
    expect(robustWindowMiles(rows)).toEqual({ miles: 1742, basis: "entered" });
    // …and the OBD pair on its own, which is what the old rule returned.
    expect(219132.4 - 218341.9).toBeCloseTo(790.5, 1);
  });

  it("still prefers OBD when it reaches both ends, gap in the middle or not", () => {
    // Coverage is about the ENDS. A middle fill with no OBD reading changes nothing: the span between
    // two bounding readings already contains it.
    expect(robustWindowMiles([row(1000, 1000, "obd"), row(1400, null, null), row(1800, 1800, "obd")]))
      .toEqual({ miles: 800, basis: "samsara_obd" });
  });

  it("keeps the non-advancing guard, which is the one that must not be lost", () => {
    // A 0-mile span makes `burnable` 0, so every real purchase clears the over-fuel ceiling. OBD
    // reaching both ends and saying the truck did not move is still a suppression, never 0 miles.
    expect(robustWindowMiles([row(1000, 5000, "obd"), row(1900, 5000, "obd")]))
      .toEqual({ miles: null, basis: "none" });
  });

  it("withholds rather than answering with the longer of two partial spans", () => {
    // Neither source reaches both ends. `cumulative_overfuel` suppresses itself on a null and accuses
    // on a short number, so the unmeasurable window must not be answered with a best guess.
    expect(robustWindowMiles([row(1000, null, null), row(null, 1400, "obd"), row(null, 1800, "obd")]))
      .toEqual({ miles: null, basis: "none" });
  });

  it("does not let a row carrying no reading at all define an end", () => {
    // The ends are the first and last READABLE rows. A row with neither odometer says nothing about
    // where the window began, and treating it as the start would suppress a measurable window.
    expect(robustWindowMiles([row(null, null, null), row(1000, 1000, "obd"), row(1800, 1800, "obd")]))
      .toEqual({ miles: 800, basis: "samsara_obd" });
  });

  it("falls to the entered span only under the guard entered has always had", () => {
    // OBD misses the oldest row, so entered answers — and a backward step past the tolerance still
    // disqualifies it. The fix widens WHEN entered is asked, never HOW it is judged.
    expect(robustWindowMiles([row(1000, null, null), row(900, 900, "obd"), row(1800, 1800, "obd")]))
      .toEqual({ miles: null, basis: "none" });
  });
});

/**
 * The aggregate twin carries the same precondition — and the OPTIONALITY of the two new fields is the
 * deploy-window rule, not a convenience.
 */
describe("windowMilesFromAggregate — the ends, and the caller that has not been told about them", () => {
  const base = aggregateWindowOdo([row(1000, 1000, "obd"), row(1800, 1800, "obd")]);

  it("treats `undefined` coverage as the caller that predates the fields, not as 'not covered'", () => {
    // `fuel_range_miles_inputs` (0315) does not return them yet, and a function's return shape is
    // invisible to `lint:migration-ordering` — so a reader can reach production nine minutes before
    // its schema does. Reading `undefined` as `false` would blank the Fuel log's miles tile for that
    // whole window. Same distinction, same reason, as `fills_with_vehicle` reporting null, not 0.
    const { obdCoversEnds, enteredCoversEnds, ...withoutEnds } = base;
    expect(obdCoversEnds).toBe(true);
    expect(enteredCoversEnds).toBe(true);
    expect(windowMilesFromAggregate(withoutEnds)).toEqual({ miles: 800, basis: "samsara_obd" });
  });

  it("honours an explicit `false`, which means the question was asked and answered", () => {
    expect(windowMilesFromAggregate({ ...base, obdCoversEnds: false })).toEqual({ miles: 800, basis: "entered" });
    expect(windowMilesFromAggregate({ ...base, obdCoversEnds: false, enteredCoversEnds: false }))
      .toEqual({ miles: null, basis: "none" });
  });
});
