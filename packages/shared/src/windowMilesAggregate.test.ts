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
