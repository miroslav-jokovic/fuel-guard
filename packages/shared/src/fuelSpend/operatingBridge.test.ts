import { describe, it, expect } from "vitest";
import {
  BRIDGE_TIE_TOLERANCE,
  periodTotals,
  operatingBridge,
  PLAUSIBLE_FLEET_MPG,
  MIN_MEASURED_SHARE,
  type SpendDay,
} from "./operatingBridge.js";
import { spendSeries, periodBounds, comparablePeriods } from "./spendPeriods.js";

/**
 * This bridge exists to be shown to somebody who did not build it, so its bars have to ADD UP to the
 * number they claim to explain. Every test here asserts a residual, including on shapes chosen to break
 * it: efficiency moving against volume, a fleet that grew, a period whose odometer is contaminated, and
 * pseudo-random data.
 *
 * The fixtures in the first block are the REAL figures for the two weeks the carrier asked about, read
 * off production on 2026-08-24, so a change that quietly alters the attribution fails here rather than
 * in front of a boss.
 */

let seq = 7;
/** Deterministic pseudo-random in [0,1) — no Math.random, so a failure is always reproducible. */
const rnd = () => {
  seq = (seq * 1103515245 + 12345) % 2147483648;
  return seq / 2147483648;
};

const day = (o: Partial<SpendDay> & { day: string }): SpendDay => ({
  vehicleId: "v1",
  fills: 1,
  gallonsTractor: 0,
  gallonsReefer: 0,
  gallonsDef: 0,
  spendTractor: 0,
  spendReefer: 0,
  spendDef: 0,
  miles: 0,
  mpgGallons: 0,
  milesRejected: 0,
  driveSec: 0,
  idleSec: 0,
  offSec: 0,
  coverageSec: 0,
  ...o,
});

/**
 * Spread a period's totals over `n` trucks on one date. The bridge only ever reads sums and a distinct
 * truck count, so this reproduces a real week faithfully without inventing 480 rows.
 */
const week = (
  date: string,
  t: { trucks: number; fills: number; gallons: number; spend: number; miles: number; mpgGallons: number; rejected?: number },
): SpendDay[] =>
  Array.from({ length: t.trucks }, (_, i) =>
    day({
      day: date,
      vehicleId: `truck-${i}`,
      fills: i === 0 ? t.fills : 0,
      gallonsTractor: t.gallons / t.trucks,
      spendTractor: t.spend / t.trucks,
      miles: t.miles / t.trucks,
      mpgGallons: t.mpgGallons / t.trucks,
      milesRejected: i === 0 ? (t.rejected ?? 0) : 0,
      // Every truck in these fixtures DROVE, which is what makes it count toward `activeTrucks`. A row
      // with no fills and no drive time is a parked truck, and periodTotals deliberately ignores it.
      driveSec: 28800,
    }),
  );

// Production, 2026-08-24: fuel_transactions, tank_type='tractor', odometer intervals gated to 50–2500 mi.
const AUG10 = week("2026-08-10", { trucks: 138, fills: 460, gallons: 53857.62, spend: 263631.46, miles: 375349.5, mpgGallons: 49668.21, rejected: 6 });
const AUG17 = week("2026-08-17", { trucks: 143, fills: 480, gallons: 57695.77, spend: 301056.59, miles: 433541.2, mpgGallons: 56247.42, rejected: 13 });

describe("periodTotals", () => {
  it("divides MPG by the gallons that carry miles, never by every gallon bought", () => {
    const p = periodTotals(AUG17, "2026-08-17", "2026-08-23");
    // 433,541.2 / 56,247.42 = 7.708. Dividing by all 57,695.77 gallons would read 7.514 — a truck that
    // never existed, and the error grows exactly as odometer coverage falls.
    expect(p.mpg).toBeCloseTo(7.708, 3);
    expect(p.mpg).not.toBeCloseTo(433541.2 / 57695.77, 3);
  });

  it("reports proven miles beside the implied miles it divides cost by", () => {
    const p = periodTotals(AUG17, "2026-08-17", "2026-08-23");
    expect(p.milesMeasured).toBeCloseTo(433541.2, 1);
    expect(p.measuredShare).toBeCloseTo(0.975, 3);
    // Implied miles = gallons × MPG, so gal = miles ÷ MPG holds and the volume split can be exact.
    expect(p.miles).toBeCloseTo(p.gallons * (p.mpg ?? 0), 1);
    expect(p.miles).toBeGreaterThan(p.milesMeasured);
  });

  it("counts trucks, not truck-days, so a week is not five times the fleet", () => {
    const twoDays = [...week("2026-08-17", { trucks: 3, fills: 3, gallons: 300, spend: 1500, miles: 2400, mpgGallons: 300 }),
                     ...week("2026-08-18", { trucks: 3, fills: 3, gallons: 300, spend: 1500, miles: 2400, mpgGallons: 300 })];
    expect(periodTotals(twoDays, "2026-08-17", "2026-08-23").activeTrucks).toBe(3);
  });

  it("ignores a truck that neither fuelled nor drove, so miles per truck is not diluted by the yard", () => {
    const rows = [
      ...week("2026-08-17", { trucks: 2, fills: 2, gallons: 200, spend: 1000, miles: 1600, mpgGallons: 200 }),
      day({ day: "2026-08-17", vehicleId: "parked", fills: 0, driveSec: 0, idleSec: 3600 }),
    ];
    const p = periodTotals(rows, "2026-08-17", "2026-08-23");
    expect(p.activeTrucks).toBe(2);
    expect(p.idleSec).toBe(3600); // its idle still counts; it burned fuel sitting there
  });

  it("leaves derived figures null rather than zero when there is nothing to divide", () => {
    const empty = periodTotals([], "2026-08-17", "2026-08-23");
    expect(empty.pricePerGal).toBeNull();
    expect(empty.mpg).toBeNull();
    expect(empty.costPerMile).toBeNull();
    expect(empty.idleShare).toBeNull();
    expect(empty.mpgUsable).toBe(false);
  });

  it("keeps unattributed fuel in the totals but out of the truck count", () => {
    const rows = [
      day({ day: "2026-08-17", vehicleId: "t1", gallonsTractor: 100, spendTractor: 520 }),
      day({ day: "2026-08-17", vehicleId: null, gallonsTractor: 40, spendTractor: 208 }),
    ];
    const p = periodTotals(rows, "2026-08-17", "2026-08-23");
    expect(p.gallons).toBe(140); // ties to the bill
    expect(p.activeTrucks).toBe(1); // nobody's truck is not a truck
  });
});

describe("operatingBridge — the real 2026-08-10 → 2026-08-17 pair", () => {
  const prior = periodTotals(AUG10, "2026-08-10", "2026-08-16");
  const current = periodTotals(AUG17, "2026-08-17", "2026-08-23");
  const b = operatingBridge(prior, current);

  it("reproduces the change in spend with no residual", () => {
    expect(b.deltaSpend).toBeCloseTo(37425.13, 2);
    expect(b.volume + b.price).toBeCloseTo(b.deltaSpend, 2);
    expect(b.tiesOut).toBe(true);
  });

  it("splits volume into distance and efficiency, and they sum to the volume term", () => {
    const s = b.volumeSplit!;
    expect(s).not.toBeNull();
    expect(s.miles + s.efficiency).toBeCloseTo(b.volume, 2);
    expect(s.tiesOut).toBe(true);
  });

  it("names the answer a boss asked for: more miles, cheaper per mile, dearer per gallon", () => {
    const s = b.volumeSplit!;
    expect(s.miles).toBeGreaterThan(0); // the fleet drove further
    expect(s.efficiency).toBeLessThan(0); // and MPG improved, which SAVED money
    expect(b.price).toBeGreaterThan(0); // against a market that rose
    expect(current.mpg!).toBeGreaterThan(prior.mpg!);
  });

  it("splits the extra distance into a bigger fleet and busier trucks, exactly", () => {
    const m = b.volumeSplit!.milesFrom;
    expect(m.trucks + m.perTruck).toBeCloseTo(current.miles - prior.miles, 1);
    expect(m.residual).toBeCloseTo(0, 1);
    expect(m.trucks).toBeGreaterThan(0); // 138 → 143 trucks
    expect(m.perTruck).toBeGreaterThan(0); // each also covered more ground
  });

  it("puts a term on the board for every bar the chart draws", () => {
    expect(b.terms.map((t) => t.key).sort()).toEqual(["efficiency", "miles", "price"]);
    expect(b.terms.reduce((a, t) => a + t.dollars, 0)).toBeCloseTo(b.deltaSpend, 1);
  });
});

describe("operatingBridge — when the mileage cannot be trusted", () => {
  const good = periodTotals(AUG17, "2026-08-17", "2026-08-23");

  it("withholds the split rather than publishing an efficiency collapse that never happened", () => {
    // June 2026's real contamination: 4.4m miles against 51.7k gallons reads as 85.7 MPG.
    const junk = periodTotals(
      week("2026-06-01", { trucks: 133, fills: 448, gallons: 51678, spend: 233000, miles: 4427362, mpgGallons: 51678 }),
      "2026-06-01",
      "2026-06-07",
    );
    expect(junk.mpg).toBeGreaterThan(PLAUSIBLE_FLEET_MPG.high);
    expect(junk.mpgUsable).toBe(false);
    const b = operatingBridge(junk, good);
    expect(b.volumeSplit).toBeNull();
    expect(b.withheld).toMatch(/outside what a tractor can do/);
    // The first-order bridge still stands — only the part that needs the odometer is withheld.
    expect(b.volume + b.price).toBeCloseTo(b.deltaSpend, 2);
    expect(b.terms.map((t) => t.key).sort()).toEqual(["price", "volume"]);
  });

  it("withholds it again when coverage is too thin to scale from", () => {
    const thin = periodTotals(
      week("2026-08-10", { trucks: 100, fills: 300, gallons: 40000, spend: 200000, miles: 60000, mpgGallons: 8000 }),
      "2026-08-10",
      "2026-08-16",
    );
    expect(thin.measuredShare).toBeLessThan(MIN_MEASURED_SHARE);
    expect(thin.mpg).toBe(7.5); // plausible on its face — only the coverage gives it away
    expect(thin.mpgUsable).toBe(false);
    expect(operatingBridge(thin, good).withheld).toMatch(/could be paired with usable odometer/);
  });

  it("still bridges spend when a period has no mileage at all", () => {
    const noMiles = periodTotals(
      week("2026-08-10", { trucks: 10, fills: 30, gallons: 1000, spend: 5000, miles: 0, mpgGallons: 0 }),
      "2026-08-10",
      "2026-08-16",
    );
    const b = operatingBridge(noMiles, good);
    expect(b.volumeSplit).toBeNull();
    expect(b.withheld).toMatch(/No usable odometer mileage/);
    expect(b.tiesOut).toBe(true);
  });
});

describe("periods", () => {
  it("starts weeks on Monday, because that is how the fleet is billed and how it talks", () => {
    expect(periodBounds("2026-08-19", "week")).toEqual({ from: "2026-08-17", to: "2026-08-23" });
    expect(periodBounds("2026-08-17", "week").from).toBe("2026-08-17"); // a Monday is its own start
    expect(periodBounds("2026-08-23", "week").from).toBe("2026-08-17"); // a Sunday still belongs back
  });

  it("bounds months on their real last day, including a leap February", () => {
    expect(periodBounds("2026-08-05", "month")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(periodBounds("2026-02-05", "month").to).toBe("2026-02-28");
    expect(periodBounds("2024-02-05", "month").to).toBe("2024-02-29");
  });

  it("buckets a series oldest-first and omits periods with no data instead of drawing a zero bar", () => {
    const s = spendSeries([...AUG10, ...AUG17], "week");
    expect(s.map((p) => p.from)).toEqual(["2026-08-10", "2026-08-17"]);
    expect(s).toHaveLength(2); // no empty week invented between or around them
  });

  it("excludes the period still filling, so a two-day week is not compared with a finished one", () => {
    const s = spendSeries([...AUG10, ...AUG17, ...week("2026-08-24", { trucks: 54, fills: 57, gallons: 6490, spend: 34221, miles: 48000, mpgGallons: 6400 })], "week");
    const c = comparablePeriods(s)!;
    expect(c.current.from).toBe("2026-08-17"); // the complete week, not the two-day stub
    expect(c.prior.from).toBe("2026-08-10");
    expect(comparablePeriods(s, { includePartial: true })!.current.from).toBe("2026-08-24");
  });

  it("clamps an edge bucket to the data, so no row is labelled past the window it belongs to", () => {
    // The bug this fixes: a report covering "to 2026-08-24" printed a row reading "2026-08-24 -
    // 2026-08-30", a week ending six days after the report ends.
    const s = spendSeries([...AUG17, ...week("2026-08-24", { trucks: 10, fills: 10, gallons: 1000, spend: 5000, miles: 7500, mpgGallons: 1000 })], "week");
    const last = s[s.length - 1]!;
    expect(last.from).toBe("2026-08-24");
    expect(last.to).toBe("2026-08-24"); // NOT 2026-08-30
    expect(last.partial).toBe(true);
    expect(s[0]!.partial).toBe(false); // a whole week inside the data is not partial
  });

  it("clamps to the REQUESTED window when one is given, not just to the data", () => {
    const s = spendSeries(AUG17, "week", { from: "2026-08-19", to: "2026-08-21" });
    expect(s[0]!.from).toBe("2026-08-19");
    expect(s[0]!.to).toBe("2026-08-21");
    expect(s[0]!.partial).toBe(true);
  });

  it("marks a leading part-week partial too, which a comparison against today never caught", () => {
    // Data starting mid-week: the first bucket is as incomplete as the last one, and anchoring a
    // comparison on it understates the prior period exactly the way the trailing stub overstates.
    const s = spendSeries([...week("2026-08-13", { trucks: 5, fills: 5, gallons: 500, spend: 2500, miles: 3750, mpgGallons: 500 }), ...AUG17], "week");
    expect(s[0]!.partial).toBe(true);
    expect(s[0]!.from).toBe("2026-08-13"); // not the Monday, 2026-08-10
  });

  it("returns null rather than a bridge against nothing when there is only one period", () => {
    expect(comparablePeriods(spendSeries(AUG17, "week"))).toBeNull();
  });
});

describe("the residual is zero on shapes chosen to break it", () => {
  it("holds when volume rises and efficiency falls at once", () => {
    const p = periodTotals(week("2026-08-10", { trucks: 100, fills: 300, gallons: 40000, spend: 190000, miles: 320000, mpgGallons: 40000 }), "2026-08-10", "2026-08-16");
    const c = periodTotals(week("2026-08-17", { trucks: 100, fills: 340, gallons: 46000, spend: 236000, miles: 322000, mpgGallons: 46000 }), "2026-08-17", "2026-08-23");
    const b = operatingBridge(p, c);
    expect(b.volumeSplit!.efficiency).toBeGreaterThan(0); // MPG got worse: it COST money
    expect(b.volumeSplit!.miles + b.volumeSplit!.efficiency).toBeCloseTo(b.volume, 2);
    expect(b.tiesOut).toBe(true);
  });

  it("holds when the fleet shrank and spend fell", () => {
    const p = periodTotals(week("2026-08-10", { trucks: 150, fills: 400, gallons: 55000, spend: 280000, miles: 420000, mpgGallons: 55000 }), "2026-08-10", "2026-08-16");
    const c = periodTotals(week("2026-08-17", { trucks: 120, fills: 300, gallons: 42000, spend: 205000, miles: 330000, mpgGallons: 42000 }), "2026-08-17", "2026-08-23");
    const b = operatingBridge(p, c);
    expect(b.deltaSpend).toBeLessThan(0);
    expect(b.tiesOut).toBe(true);
    expect(b.volumeSplit!.milesFrom.trucks).toBeLessThan(0);
    expect(b.volumeSplit!.milesFrom.residual).toBeCloseTo(0, 1);
  });

  it("holds over 200 pseudo-random period pairs", () => {
    for (let i = 0; i < 200; i++) {
      const mk = (date: string) => {
        const trucks = 20 + Math.floor(rnd() * 180);
        const gallons = 5000 + rnd() * 60000;
        const mpg = PLAUSIBLE_FLEET_MPG.low + rnd() * (PLAUSIBLE_FLEET_MPG.high - PLAUSIBLE_FLEET_MPG.low);
        const share = MIN_MEASURED_SHARE + rnd() * (1 - MIN_MEASURED_SHARE);
        const mpgGallons = gallons * share;
        return periodTotals(
          week(date, { trucks, fills: trucks * 3, gallons, spend: gallons * (3 + rnd() * 3), miles: mpgGallons * mpg, mpgGallons }),
          date,
          date,
        );
      };
      const b = operatingBridge(mk("2026-08-10"), mk("2026-08-17"));
      expect(b.tiesOut).toBe(true);
      expect(Math.abs(b.residual)).toBeLessThanOrEqual(BRIDGE_TIE_TOLERANCE * 2);
      expect(b.volumeSplit).not.toBeNull();
      expect(b.volumeSplit!.tiesOut).toBe(true);
      expect(b.volumeSplit!.milesFrom.residual).toBeCloseTo(0, 0);
    }
  });
});
