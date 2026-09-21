import { describe, it, expect } from "vitest";
import {
  deriveFuelSpendRollup,
  businessDate,
  MAX_INTERVAL_MILES,
  type SpendFill,
  type SpendEngineDay,
  type DeriveInput,
} from "./rollupDerive.js";

/**
 * The allocation rules are the part of this feature that can be wrong without anyone noticing: the
 * totals still tie to the fuel bill, the page still renders, and only MPG quietly moves. So these tests
 * are about WHERE things land, not just how much of them there is.
 */

const fill = (o: Partial<SpendFill> & { fueledAt: string }): SpendFill => ({
  vehicleId: "v1",
  state: "TX",
  tank: "tractor",
  gallons: 120,
  totalCost: 620.4,
  milesSinceLast: null,
  ...o,
});

const engine = (day: string, driveSec: number, vehicleId = "v1"): SpendEngineDay => ({
  vehicleId, day, driveSec, idleSec: 0, offSec: 0, coverageSec: 86400,
});

const derive = (i: Partial<DeriveInput> & { from: string; to: string }) =>
  deriveFuelSpendRollup({ fills: [], defLines: [], engineDays: [], ...i });

const row = (r: ReturnType<typeof derive>, day: string, vehicleId: string | null = "v1") =>
  r.rows.find((x) => x.day === day && x.vehicleId === vehicleId);

describe("businessDate", () => {
  it("uses the station's local day, not the UTC one", () => {
    // 05:00 UTC on the 18th is 22:00 on the 17th in Nevada — the day the vendor prints.
    expect(businessDate("2026-08-18T05:00:00Z", "NV")).toBe("2026-08-17");
    expect(businessDate("2026-08-18T05:00:00Z", null)).toBe("2026-08-18"); // no state, no shift
  });

  it("returns null for an unparseable instant rather than inventing a day", () => {
    expect(businessDate("not a date", "TX")).toBeNull();
  });
});

describe("money lands on the fill's own day", () => {
  it("separates tractor from reefer, because dyed off-road fuel is not propulsion", () => {
    const r = derive({
      from: "2026-08-17", to: "2026-08-23",
      fills: [
        fill({ fueledAt: "2026-08-17T14:00:00Z", gallons: 120, totalCost: 620 }),
        fill({ fueledAt: "2026-08-17T15:00:00Z", tank: "reefer", gallons: 40, totalCost: 180 }),
      ],
    });
    const d = row(r, "2026-08-17")!;
    expect(d.gallonsTractor).toBe(120);
    expect(d.spendTractor).toBe(620);
    expect(d.gallonsReefer).toBe(40);
    expect(d.spendReefer).toBe(180);
    expect(d.fills).toBe(2);
  });

  it("keeps fuel nobody's truck bought, on its own row, so the total still ties to the bill", () => {
    const r = derive({
      from: "2026-08-17", to: "2026-08-23",
      fills: [
        fill({ fueledAt: "2026-08-17T14:00:00Z", gallons: 100, totalCost: 500 }),
        fill({ fueledAt: "2026-08-17T16:00:00Z", vehicleId: null, gallons: 60, totalCost: 300 }),
      ],
    });
    expect(r.unattributedFills).toBe(1);
    expect(row(r, "2026-08-17", null)!.gallonsTractor).toBe(60);
    expect(r.rows.reduce((a, x) => a + x.spendTractor, 0)).toBe(800);
  });
});

describe("miles are allocated across the interval they were driven over", () => {
  const twoFills = {
    from: "2026-08-17", to: "2026-08-23",
    fills: [
      fill({ fueledAt: "2026-08-17T12:00:00Z", milesSinceLast: null }),
      fill({ fueledAt: "2026-08-20T12:00:00Z", gallons: 150, milesSinceLast: 900 }),
    ],
  };

  it("splits them by drive time, not evenly, when the engine feed covers the interval", () => {
    const r = derive({
      ...twoFills,
      engineDays: [engine("2026-08-18", 3600), engine("2026-08-19", 7200), engine("2026-08-20", 7200)],
    });
    // 1:2:2 of 900 miles. Nothing on the 17th: the interval is (17th, 20th].
    expect(row(r, "2026-08-17")!.miles).toBe(0);
    expect(row(r, "2026-08-18")!.miles).toBe(180);
    expect(row(r, "2026-08-19")!.miles).toBe(360);
    expect(row(r, "2026-08-20")!.miles).toBe(360);
    expect(row(r, "2026-08-19")!.milesBasis).toBe("drive_time");
  });

  it("carries the gallons with the miles, so a day driven through can have both and no fill", () => {
    const r = derive({
      ...twoFills,
      engineDays: [engine("2026-08-18", 3600), engine("2026-08-19", 7200), engine("2026-08-20", 7200)],
    });
    const through = row(r, "2026-08-19")!;
    expect(through.fills).toBe(0);
    expect(through.gallonsTractor).toBe(0); // bought nothing that day
    expect(through.miles).toBeGreaterThan(0);
    expect(through.mpgGallons).toBeGreaterThan(0); // …but the miles brought their gallons
    // The pair invariant migration 0244 enforces holds on every row.
    for (const x of r.rows) expect(x.miles === 0).toBe(x.mpgGallons === 0);
  });

  it("preserves total miles and total mpg gallons exactly, wherever they land", () => {
    const r = derive({
      ...twoFills,
      engineDays: [engine("2026-08-18", 3600), engine("2026-08-19", 7200), engine("2026-08-20", 7200)],
    });
    expect(r.rows.reduce((a, x) => a + x.miles, 0)).toBeCloseTo(900, 1);
    expect(r.rows.reduce((a, x) => a + x.mpgGallons, 0)).toBeCloseTo(150, 2);
  });

  it("falls back to an even spread, and says so, when the engine feed has nothing", () => {
    const r = derive(twoFills);
    expect(row(r, "2026-08-18")!.miles).toBe(300);
    expect(row(r, "2026-08-19")!.miles).toBe(300);
    expect(row(r, "2026-08-20")!.miles).toBe(300);
    expect(row(r, "2026-08-18")!.milesBasis).toBe("even");
  });

  it("counts each day once — two consecutive intervals never overlap", () => {
    const r = derive({
      from: "2026-08-17", to: "2026-08-23",
      fills: [
        fill({ fueledAt: "2026-08-17T12:00:00Z" }),
        fill({ fueledAt: "2026-08-19T12:00:00Z", milesSinceLast: 600 }),
        fill({ fueledAt: "2026-08-21T12:00:00Z", milesSinceLast: 600 }),
      ],
    });
    expect(r.rows.reduce((a, x) => a + x.miles, 0)).toBeCloseTo(1200, 1);
    expect(row(r, "2026-08-17")!.miles).toBe(0); // no interval ends before it
  });

  it("puts both on the fill's day when two fills share one date", () => {
    const r = derive({
      from: "2026-08-17", to: "2026-08-23",
      fills: [
        fill({ fueledAt: "2026-08-17T06:00:00Z" }),
        fill({ fueledAt: "2026-08-17T20:00:00Z", milesSinceLast: 400 }),
      ],
    });
    expect(row(r, "2026-08-17")!.miles).toBe(400);
  });
});

/**
 * Migration 0244 stores `miles` at 2dp and `mpg_gallons` at 3dp and then asserts
 * `check ((miles = 0) = (mpg_gallons = 0))`. A slice that rounds away on one side and survives on the
 * other therefore writes a row the database refuses — and `writeRows` upserts in chunks, so the throw
 * takes the rest of the batch with it and `sweepStale` never runs.
 *
 * That is not hypothetical. `fuel_spend_days` was frozen from 2026-09-13 to 2026-09-20 for the whole
 * carrier on ONE truck-day, which made fleet MPG read 8.61 against a true ~6.9, and the only evidence
 * anywhere was a line in the API log (`docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md` D-PREC1).
 *
 * Both directions are pinned, because the obvious half-fix — "skip a day whose miles round to zero" —
 * passes the first of these and fails the second.
 */
describe("a slice too small to round is taken whole or not at all", () => {
  /** Every emitted row must satisfy the database's own predicate. */
  const pairHolds = (r: ReturnType<typeof derive>) =>
    r.rows.every((x) => (x.miles === 0) === (x.mpgGallons === 0));

  it("drops a day whose miles round away, rather than leaving its gallons behind", () => {
    // The real thing, from vehicle 1f8dcd84 on 2026-09-13: a 158-gallon fill taken 0.2 miles after
    // the previous one — a second pump, or a re-swipe. Spread over four days by drive time, the
    // 13th's share of 0.2 miles is 0.0015 (rounds to 0.00) and of 158.06 gallons is 1.156 (survives).
    const r = derive({
      from: "2026-09-06", to: "2026-09-20",
      fills: [
        fill({ fueledAt: "2026-09-12T16:17:00Z", state: null, gallons: 134.39, milesSinceLast: 857 }),
        fill({ fueledAt: "2026-09-16T12:00:00Z", state: null, gallons: 158.06, milesSinceLast: 0.2 }),
      ],
      engineDays: [
        engine("2026-09-13", 600), engine("2026-09-14", 24857),
        engine("2026-09-15", 35127), engine("2026-09-16", 21458),
      ],
    });

    expect(pairHolds(r)).toBe(true);
    const thirteenth = row(r, "2026-09-13")!;
    expect(thirteenth.miles).toBe(0);
    expect(thirteenth.mpgGallons).toBe(0);

    // The three days whose share DOES survive still carry it — the guard drops a slice, not an interval.
    for (const day of ["2026-09-14", "2026-09-15", "2026-09-16"]) {
      expect(row(r, day)!.miles).toBeGreaterThan(0);
      expect(row(r, day)!.mpgGallons).toBeGreaterThan(0);
    }

    // ⚠ And no FUEL is lost: the gallons live on the fill's own day independently of the allocation,
    // so the period still ties to the bill. Only the MPG denominator gives up the rounding artefact.
    expect(row(r, "2026-09-16")!.gallonsTractor).toBe(158.06);
  });

  it("drops a day whose gallons round away, which is the mirror case a miles-only guard misses", () => {
    // The partner of the fill above: 2.59 gallons against 940.5 miles, because the odometer was
    // mis-paired across the split. At a 0.017% drive-time share the gallons round to 0.000 while the
    // miles round to 0.16 — the violation pointing the other way.
    const r = derive({
      from: "2026-09-16", to: "2026-09-18",
      fills: [
        fill({ fueledAt: "2026-09-16T12:00:00Z", state: null, gallons: 100, milesSinceLast: 600 }),
        fill({ fueledAt: "2026-09-18T12:00:00Z", state: null, gallons: 2.59, milesSinceLast: 940.5 }),
      ],
      engineDays: [engine("2026-09-17", 5), engine("2026-09-18", 30000)],
    });

    expect(pairHolds(r)).toBe(true);
    const seventeenth = row(r, "2026-09-17")!;
    expect(seventeenth.miles).toBe(0);
    expect(seventeenth.mpgGallons).toBe(0);
    expect(row(r, "2026-09-18")!.miles).toBeGreaterThan(0);
  });

  it("leaves an ordinary allocation untouched — the guard is a floor, not a filter", () => {
    const r = derive({
      from: "2026-08-17", to: "2026-08-23",
      fills: [
        fill({ fueledAt: "2026-08-17T12:00:00Z", milesSinceLast: null }),
        fill({ fueledAt: "2026-08-20T12:00:00Z", gallons: 150, milesSinceLast: 900 }),
      ],
      engineDays: [engine("2026-08-18", 3600), engine("2026-08-19", 7200), engine("2026-08-20", 7200)],
    });
    expect(pairHolds(r)).toBe(true);
    expect(r.rows.reduce((a, x) => a + x.miles, 0)).toBeCloseTo(900, 1);
    expect(r.rows.reduce((a, x) => a + x.mpgGallons, 0)).toBeCloseTo(150, 2);
  });
});

describe("the odometer gate", () => {
  it("refuses an impossible interval, keeps its gallons, and counts the refusal", () => {
    const r = derive({
      from: "2026-08-17", to: "2026-08-23",
      fills: [
        fill({ fueledAt: "2026-08-17T12:00:00Z" }),
        fill({ fueledAt: "2026-08-20T12:00:00Z", gallons: 150, totalCost: 780, milesSinceLast: 12406 }),
      ],
    });
    expect(r.rejectedIntervals).toBe(1);
    const d = row(r, "2026-08-20")!;
    expect(d.miles).toBe(0);
    expect(d.mpgGallons).toBe(0); // the miles took their gallons with them
    expect(d.gallonsTractor).toBe(150); // but the FUEL was still bought and still cost money
    expect(d.spendTractor).toBe(780);
    expect(d.milesRejected).toBe(1);
  });

  it("refuses zero and negative readings, which are a rollback rather than a stationary truck", () => {
    for (const bad of [0, -40]) {
      const r = derive({
        from: "2026-08-17", to: "2026-08-23",
        fills: [fill({ fueledAt: "2026-08-17T12:00:00Z" }), fill({ fueledAt: "2026-08-19T12:00:00Z", milesSinceLast: bad })],
      });
      expect(r.rejectedIntervals).toBe(1);
    }
  });

  it("keeps a short interval, because partial fills average out over many of them", () => {
    const r = derive({
      from: "2026-08-17", to: "2026-08-23",
      fills: [fill({ fueledAt: "2026-08-17T12:00:00Z" }), fill({ fueledAt: "2026-08-18T12:00:00Z", milesSinceLast: 12 })],
    });
    expect(r.rejectedIntervals).toBe(0);
    expect(row(r, "2026-08-18")!.miles).toBe(12);
  });

  it("accepts an interval right at the ceiling and refuses the mile past it", () => {
    const run = (miles: number) =>
      derive({
        from: "2026-08-17", to: "2026-08-23",
        fills: [fill({ fueledAt: "2026-08-17T12:00:00Z" }), fill({ fueledAt: "2026-08-19T12:00:00Z", milesSinceLast: miles })],
      }).rejectedIntervals;
    expect(run(MAX_INTERVAL_MILES)).toBe(0);
    expect(run(MAX_INTERVAL_MILES + 1)).toBe(1);
  });

  it("never lets a reefer fill claim an odometer interval — that tank does not move the truck", () => {
    const r = derive({
      from: "2026-08-17", to: "2026-08-23",
      fills: [fill({ fueledAt: "2026-08-18T12:00:00Z", tank: "reefer", milesSinceLast: 500 })],
    });
    expect(r.rows.reduce((a, x) => a + x.miles, 0)).toBe(0);
  });
});

describe("the other two sources", () => {
  it("brings DEF in from its own feed, since fuel_transactions carries none", () => {
    const r = derive({
      from: "2026-08-17", to: "2026-08-23",
      defLines: [
        { vehicleId: "v1", day: "2026-08-18", gallons: 9.5, amount: 34.2 },
        { vehicleId: null, day: "2026-08-18", gallons: 2, amount: 7.5 },
      ],
    });
    expect(row(r, "2026-08-18")!.gallonsDef).toBe(9.5);
    expect(row(r, "2026-08-18", null)!.spendDef).toBe(7.5); // an unmatched unit still counts
  });

  it("carries engine time for a truck that bought nothing at all that day", () => {
    const r = derive({ from: "2026-08-17", to: "2026-08-23", engineDays: [engine("2026-08-18", 28800)] });
    const d = row(r, "2026-08-18")!;
    expect(d.driveSec).toBe(28800);
    expect(d.fills).toBe(0);
  });
});

describe("the window", () => {
  it("emits no row outside it, while still using outside days to weight the allocation", () => {
    const r = derive({
      // The interval spans the 18th–20th but only the 20th is asked for. The 18th and 19th still carry
      // drive time, so the 20th must get its WEIGHTED share and not the whole 900 miles.
      from: "2026-08-20", to: "2026-08-23",
      fills: [
        fill({ fueledAt: "2026-08-17T12:00:00Z" }),
        fill({ fueledAt: "2026-08-20T12:00:00Z", milesSinceLast: 900 }),
      ],
      engineDays: [engine("2026-08-18", 3600), engine("2026-08-19", 7200), engine("2026-08-20", 7200)],
    });
    expect(r.rows.every((x) => x.day >= "2026-08-20")).toBe(true);
    expect(row(r, "2026-08-20")!.miles).toBe(360); // 2/5 of 900, not 900
  });

  it("does not smear a months-long gap between two fills across every day of it", () => {
    const r = derive({
      from: "2026-01-01", to: "2026-08-23",
      fills: [
        fill({ fueledAt: "2026-02-01T12:00:00Z" }),
        fill({ fueledAt: "2026-08-20T12:00:00Z", milesSinceLast: 800 }),
      ],
    });
    // A truck off the road for six months did not drive a little every day; the miles land on the fill.
    expect(row(r, "2026-08-20")!.miles).toBe(800);
    expect(r.rows.filter((x) => x.miles > 0)).toHaveLength(1);
  });
});
