import { describe, it, expect } from "vitest";
import { spendBridge, compareTrailing, weeklySpendSeries, discountMarketLink } from "./varianceBridge.js";
import type { SpendLine } from "./types.js";

/**
 * The bridge's whole claim is that its bars ADD UP to the number they explain. A waterfall whose
 * components miss Δspend by even a few dollars invites the reader to distrust the attribution, and the
 * attribution is the product. So the residual is asserted everywhere, including on adversarial shapes:
 * sites that appear in only one period, a period with a single site, and pseudo-random data.
 */

let seq = 0;
/** Deterministic pseudo-random in [0,1) — no Math.random, so a failure is always reproducible. */
const rnd = () => {
  seq = (seq * 1103515245 + 12345) % 2147483648;
  return seq / 2147483648;
};

const fill = (o: Partial<SpendLine> & { tranDate: string; gallons: number; netAmount: number; retailAmount: number }): SpendLine => ({
  brand: "pilot", state: "TX", site: "1", city: "Somewhere", unit: "100", driver: null,
  product: "diesel", tank: "tractor", ...o,
});

describe("spendBridge", () => {
  const before = [
    fill({ tranDate: "2026-06-01", gallons: 100, netAmount: 400, retailAmount: 480, state: "TX" }),
    fill({ tranDate: "2026-06-02", gallons: 100, netAmount: 420, retailAmount: 500, state: "OK" }),
  ];
  const after = [
    fill({ tranDate: "2026-08-17", gallons: 120, netAmount: 600, retailAmount: 660, state: "TX" }),
    fill({ tranDate: "2026-08-18", gallons: 80, netAmount: 400, retailAmount: 452, state: "OK" }),
  ];

  it("its four components sum to the change in spend, exactly", () => {
    const b = spendBridge({ label: "before", weeks: 1, lines: before }, { label: "after", weeks: 1, lines: after });
    expect(b.residual).toBe(0);
    expect(b.volume.dollars + b.market.dollars + b.discountRate.dollars + b.discountMix.dollars).toBeCloseTo(b.deltaSpend, 2);
  });

  it("separates a deal getting worse from gallons moving to worse sites", () => {
    // Same two states, same shares, but the discount rate halves at both: pure RATE, no MIX.
    const rateOnly = [
      fill({ tranDate: "2026-08-17", gallons: 100, netAmount: 440, retailAmount: 480, state: "TX" }),
      fill({ tranDate: "2026-08-18", gallons: 100, netAmount: 460, retailAmount: 500, state: "OK" }),
    ];
    const b = spendBridge({ label: "b", weeks: 1, lines: before }, { label: "a", weeks: 1, lines: rateOnly });
    // Sign convention: a POSITIVE component ADDS to spend. The discount halving from $0.80 to $0.40 on
    // 200 gallons costs $80, and all of it is rate — the two states kept identical gallon shares.
    expect(b.discountRate.dollars).toBeCloseTo(80, 2);
    expect(Math.abs(b.discountMix.dollars)).toBeLessThan(0.02);

    // MIX needs the groups to differ in RATE — shuffling gallons between two sites with the same deal
    // costs nothing, and the decomposition says so. So this pair gives TX $0.80/gal and OK $0.40/gal,
    // then moves every gallon to OK while each site keeps exactly the rate it had.
    const splitRates = [
      fill({ tranDate: "2026-06-01", gallons: 100, netAmount: 400, retailAmount: 480, state: "TX" }), // $0.80/gal
      fill({ tranDate: "2026-06-02", gallons: 100, netAmount: 460, retailAmount: 500, state: "OK" }), // $0.40/gal
    ];
    const allToOk = [fill({ tranDate: "2026-08-18", gallons: 200, netAmount: 920, retailAmount: 1000, state: "OK" })];
    const m = spendBridge({ label: "b", weeks: 1, lines: splitRates }, { label: "a", weeks: 1, lines: allToOk });
    expect(Math.abs(m.discountRate.dollars)).toBeLessThan(0.02); // OK's own rate never moved
    expect(m.discountMix.dollars).toBeCloseTo(40, 2); // 200 gal × ($0.60 blended − $0.40 OK)
    expect(m.residual).toBe(0);
  });

  it("stays exact when a site exists in only one of the two periods", () => {
    const withNewSite = [...after, fill({ tranDate: "2026-08-19", gallons: 50, netAmount: 260, retailAmount: 270, state: "NM" })];
    const b = spendBridge({ label: "b", weeks: 1, lines: before }, { label: "a", weeks: 1, lines: withNewSite });
    expect(b.residual).toBe(0);
    const dropped = spendBridge({ label: "b", weeks: 1, lines: before }, { label: "a", weeks: 1, lines: after.slice(0, 1) });
    expect(dropped.residual).toBe(0);
  });

  it("stays exact on 200 pseudo-random shapes, grouped by state or by site", () => {
    const states = ["TX", "OK", "CA", "AZ", "NM", "WY"];
    for (let trial = 0; trial < 200; trial++) {
      seq = trial + 1;
      const make = (day: string, n: number) =>
        Array.from({ length: n }, () => {
          const gal = 20 + rnd() * 180;
          const retailPpg = 3 + rnd() * 3;
          const disc = rnd() * 0.9;
          return fill({
            tranDate: day, gallons: gal,
            netAmount: gal * (retailPpg - disc), retailAmount: gal * retailPpg,
            state: states[Math.floor(rnd() * states.length)]!,
            site: String(1 + Math.floor(rnd() * 8)),
          });
        });
      const b = spendBridge(
        { label: "b", weeks: 1, lines: make("2026-06-01", 1 + Math.floor(rnd() * 9)) },
        { label: "a", weeks: 1, lines: make("2026-08-17", 1 + Math.floor(rnd() * 9)) },
      );
      expect(Math.abs(b.residual), `trial ${trial} by state`).toBeLessThanOrEqual(0.01);
      const bySite = spendBridge(
        { label: "b", weeks: 1, lines: make("2026-06-01", 1 + Math.floor(rnd() * 9)) },
        { label: "a", weeks: 1, lines: make("2026-08-17", 1 + Math.floor(rnd() * 9)) },
        (l) => l.site, "site",
      );
      expect(Math.abs(bySite.residual), `trial ${trial} by site`).toBeLessThanOrEqual(0.01);
    }
  });

  it("reports no share rather than 0% when spend did not move", () => {
    const b = spendBridge({ label: "b", weeks: 1, lines: before }, { label: "a", weeks: 1, lines: before });
    expect(b.deltaSpend).toBe(0);
    expect(b.volume.share).toBeNull();
  });

  it("ignores reefer and DEF — a $/gal must be tractor fuel only", () => {
    const withReefer = [...after, fill({ tranDate: "2026-08-17", gallons: 500, netAmount: 100, retailAmount: 100, tank: "reefer" })];
    const a = spendBridge({ label: "b", weeks: 1, lines: before }, { label: "a", weeks: 1, lines: after });
    const b = spendBridge({ label: "b", weeks: 1, lines: before }, { label: "a", weeks: 1, lines: withReefer });
    expect(b.after.gallons).toBe(a.after.gallons);
  });
});

describe("compareTrailing", () => {
  const weeks = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(2026, 5, 1) + i * 7 * 86400000).toISOString().slice(0, 10);
      return fill({ tranDate: d, gallons: 100, netAmount: 400 + i * 10, retailAmount: 480 + i * 10 });
    });

  it("refuses to bridge when there is not enough history for both blocks", () => {
    expect(compareTrailing(weeks(7), 4)).toBeNull();
    expect(compareTrailing(weeks(8), 4)).not.toBeNull();
  });

  it("compares the last N weeks against the N before them", () => {
    const b = compareTrailing(weeks(8), 4)!;
    expect(b.before.weeks).toBe(4);
    expect(b.after.weeks).toBe(4);
    expect(b.residual).toBe(0);
  });
});

describe("discountMarketLink", () => {
  it("reads a rack-linked deal as a negative slope — discount narrows as the market rises", () => {
    const lines = Array.from({ length: 10 }, (_, i) => {
      const retail = 4.5 + i * 0.1;
      const disc = 0.9 - i * 0.05; // compresses as retail climbs
      return fill({ tranDate: new Date(Date.UTC(2026, 5, 1) + i * 7 * 86400000).toISOString().slice(0, 10), gallons: 100, netAmount: 100 * (retail - disc), retailAmount: 100 * retail });
    });
    const link = discountMarketLink(weeklySpendSeries(lines));
    expect(link.correlation).toBeLessThan(-0.95);
    expect(link.slope).toBeCloseTo(-0.5, 1);
  });

  it("reads a flat cents-off deal as no relationship at all", () => {
    const lines = Array.from({ length: 10 }, (_, i) => {
      const retail = 4.5 + i * 0.1;
      return fill({ tranDate: new Date(Date.UTC(2026, 5, 1) + i * 7 * 86400000).toISOString().slice(0, 10), gallons: 100, netAmount: 100 * (retail - 0.6), retailAmount: 100 * retail });
    });
    // The per-gallon discount is $0.60 every week (to within floating-point noise), so there is no
    // relationship to report — and reporting one derived from that noise would be worse than silence.
    expect(discountMarketLink(weeklySpendSeries(lines)).correlation).toBeNull();
  });

  it("abstains below three weeks rather than reporting a correlation of two points", () => {
    expect(discountMarketLink([]).correlation).toBeNull();
  });
});
