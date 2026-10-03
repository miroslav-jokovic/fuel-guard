import { describe, expect, it } from "vitest";
import { fuelReportTotals, type FuelReport, type FuelReportDay } from "./reportDays.js";
import type { FleetMpgPeriod } from "./fleetEfficiency.js";
import { brandList, costCards, costDayRows, costDaysCsv, networkLine, reeferLine, relativeChange, spendChangeLine } from "./fuelCostView.js";

/**
 * The Fuel Costs page's words and comparisons (FS2). The sums are SQL's and the ratios
 * `fuelReportTotals`' — what is only testable here is which figure goes on which card, which way a
 * change counts as good, and that a day with no fuel is still a row.
 */
const day = (d: string, o: Partial<FuelReportDay> = {}): FuelReportDay => ({
  day: d, network: "in", tank: "tractor", fills: 1, gallons: 100, spend: 400,
  retailFills: 0, retailGallons: 0, retailSpend: 0, retail: 0,
  contractFills: 0, contractGallons: 0, contractSpend: 0, contract: 0, ...o,
});

const mpg = (o: Partial<FleetMpgPeriod>): FleetMpgPeriod => ({
  mpg: 6.5, ratio: 6.5, milesSource: "measured", miles: 6500, gallons: 1000, gallonsWithMiles: 1000,
  measuredShare: 1, truckCoverage: 1, trucksMeasured: 3, trucksUnmeasured: 0, reason: null,
  from: "2026-09-01", to: "2026-09-03", requestedTo: "2026-09-03", partial: false, fuelThrough: "2026-09-30",
  timezone: "America/Chicago", trucksFuelled: 3, unattributedGallons: 0, readings: 10, ...o,
});

/** Three days now, three before; the current range spends MORE and gets FEWER miles to the gallon. */
function report(o: { station?: boolean } = {}): FuelReport {
  const cur = [
    day("2026-09-01", { contractFills: 1, contractGallons: 100, contractSpend: 400, contract: 390 }),
    day("2026-09-01", { network: "out", spend: 500 }),
    day("2026-09-03", { tank: "reefer", gallons: 20, spend: 90 }),
    day("2026-09-03", { network: "unknown", spend: 300 }),
  ];
  const prev = [day("2026-08-29", { spend: 300 }), day("2026-08-30", { network: "out", spend: 100 })];
  return {
    current: {
      from: "2026-09-01", to: "2026-09-03", days: cur, totals: fuelReportTotals(cur),
      efficiency: o.station ? null : { mpg: mpg({ mpg: 6.2, miles: 1860 }), costPerMile: 0.645 },
    },
    previous: {
      from: "2026-08-29", to: "2026-08-31", days: prev, totals: fuelReportTotals(prev),
      efficiency: o.station ? null : { mpg: mpg({ mpg: 6.8, miles: 1360 }), costPerMile: 0.294 },
    },
    trailingMpg: o.station ? null : [
      { day: "2026-09-01", mpg: 6.4, measuredShare: 1, reason: null },
      { day: "2026-09-02", mpg: null, measuredShare: 0.4, reason: "Only 40% of this period's fuel…" },
      { day: "2026-09-03", mpg: 6.2, measuredShare: 1, reason: null },
    ],
    inNetworkBrands: ["pilot", "flying_j"],
    sites: [],
  };
}

const byKey = (r: FuelReport) => Object.fromEntries(costCards(r).map((c) => [c.key, c]));

describe("costCards", () => {
  it("puts each figure on its card with the change against the previous range, naming that range", () => {
    const c = byKey(report());
    expect(c.spend!.value).toBe("$1,200");
    expect(c.spend!.sub).toBe("+200.0% vs 08/29–08/31");
    expect(c.spend!.previous).toBe("08/29–08/31: $400");
    expect(c.mpg!.value).toBe("6.20");
    expect(c.cpm!.value).toBe("$0.645");
    expect(c.out!.value).toBe("$500");
    expect(c.quote!.value).toBe("$10");
  });

  it("calls a rise bad where less is better, and a fall bad where more is better", () => {
    const c = byKey(report());
    expect(c.price!.tone).not.toBeNull(); // a price per gallon has a direction
    expect(c.mpg!.tone).toBe("bad"); // 6.8 → 6.2
    expect(c.cpm!.tone).toBe("bad");
    expect(c.gallons!.tone).toBeNull(); // neither direction is good news on its own
  });

  it("gives dollars no direction, because they move with how much the fleet drove (Q-FSV15)", () => {
    // Spend and out-of-network spend both change between the fixture's two ranges; a quieter month
    // must not be painted green.
    const c = byKey(report());
    expect(c.spend!.sub).toMatch(/vs /);
    expect(c.spend!.tone).toBeNull();
    expect(c.out!.tone).toBeNull();
  });

  it("drops miles, MPG and cost per mile under a station filter rather than dashing them", () => {
    const keys = costCards(report({ station: true })).map((c) => c.key);
    expect(keys).toEqual(["spend", "gallons", "price", "quote", "out"]);
  });

  it("says why when MPG is withheld, and withholds cost per mile with it", () => {
    const r = report();
    r.current.efficiency = { mpg: mpg({ mpg: null, reason: "Only 40% of this period's fuel…" }), costPerMile: null };
    const c = byKey(r);
    expect(c.mpg!.value).toBe("—");
    expect(c.mpg!.sub).toBe("Only 40% of this period's fuel…");
    expect(c.cpm!.sub).toBe("Only 40% of this period's fuel…");
  });

  it("prints a net that rounds to nothing as $0, never -$0", () => {
    const r = report();
    r.current.totals.tractor.paidVsQuote = -0.3;
    expect(byKey(r).quote!.value).toBe("$0");
  });

  it("has nothing to compare against a previous range of zero, and says so", () => {
    const r = report();
    r.previous.totals = fuelReportTotals([]);
    expect(byKey(r).spend!.sub).toBe("nothing to compare in 08/29–08/31");
  });
});

describe("spendChangeLine", () => {
  /** One tractor fill each side, so spend, gallons and price are exactly what the case says. */
  const pair = (cur: { spend: number; gallons: number }, prev: { spend: number; gallons: number }): FuelReport => {
    const r = report();
    const c = [day("2026-09-01", cur)];
    const p = [day("2026-08-29", prev)];
    return { ...r, current: { ...r.current, days: c, totals: fuelReportTotals(c) }, previous: { ...r.previous, days: p, totals: fuelReportTotals(p) } };
  };

  it("splits the change in spend into gallons and average price, naming the range it compares with", () => {
    // 1000 gal at $4.00 → 997 gal at $4.576: spend +14.1%, gallons −0.3%, price +14.4% (the audit's September).
    expect(spendChangeLine(pair({ spend: 4562.27, gallons: 997 }, { spend: 4000, gallons: 1000 }))).toBe(
      "Fuel spend rose 14.1% against 08/29–08/31: 0.3% fewer gallons, at an average price 14.4% higher.",
    );
    expect(spendChangeLine(pair({ spend: 3000, gallons: 800 }, { spend: 4000, gallons: 1000 }))).toBe(
      "Fuel spend fell 25.0% against 08/29–08/31: 20.0% fewer gallons, at an average price 6.3% lower.",
    );
  });

  it("says 'the same' for a change that would print as 0.0%, never 'rose 0.0%'", () => {
    expect(spendChangeLine(pair({ spend: 4000, gallons: 1000 }, { spend: 4000, gallons: 1000 }))).toBe(
      "Fuel spend was the same as in 08/29–08/31: the same gallons, at the same average price.",
    );
  });

  it("has nothing to split with no fuel on either side, and says which side", () => {
    expect(spendChangeLine(pair({ spend: 0, gallons: 0 }, { spend: 4000, gallons: 1000 }))).toBe("No tractor fuel was bought in 09/01–09/03.");
    expect(spendChangeLine(pair({ spend: 4000, gallons: 1000 }, { spend: 0, gallons: 0 }))).toBe(
      "No tractor fuel was bought in 08/29–08/31, so there is nothing to compare with.",
    );
  });

  it("says only how spend moved when one side has spend but no gallons to price it by", () => {
    expect(spendChangeLine(pair({ spend: 4400, gallons: 1000 }, { spend: 4000, gallons: 0 }))).toBe("Fuel spend rose 10.0% against 08/29–08/31.");
  });
});

describe("relativeChange", () => {
  it("is signed against the previous figure and null with nothing to compare", () => {
    expect(relativeChange(110, 100)).toBeCloseTo(0.1);
    expect(relativeChange(90, 100)).toBeCloseTo(-0.1);
    expect(relativeChange(5, 0)).toBeNull();
    expect(relativeChange(null, 3)).toBeNull();
  });
});

describe("costDayRows", () => {
  it("is every day of the range, newest first, a day with no fuel included", () => {
    const rows = costDayRows(report());
    expect(rows.map((r) => r.day)).toEqual(["2026-09-03", "2026-09-02", "2026-09-01"]);
    expect(rows[1]).toMatchObject({ fills: 0, spend: 0, pricePerGal: null });
  });

  it("sums a day across networks for tractor fuel, and keeps reefer and out of network beside it", () => {
    const [d3, , d1] = costDayRows(report());
    expect(d1).toMatchObject({ fills: 2, spend: 900, outOfNetwork: 500, paidVsQuote: 10, reefer: 0 });
    expect(d3).toMatchObject({ fills: 1, spend: 300, reefer: 90 });
  });

  it("carries each day's trailing MPG, and the reason when it was withheld", () => {
    const rows = costDayRows(report());
    expect(rows.map((r) => r.mpg)).toEqual([6.2, null, 6.4]);
    expect(rows[1]!.mpgReason).toMatch(/40%/);
    expect(costDayRows(report({ station: true })).every((r) => r.mpg == null)).toBe(true);
  });

  it("writes the CSV with the MPG column only when there is one", () => {
    const rows = costDayRows(report());
    expect(costDaysCsv(rows, true).headers.at(-1)).toBe("MPG — previous 7 days");
    expect(costDaysCsv(rows, false).headers).not.toContain("MPG — previous 7 days");
    expect(costDaysCsv(rows, true).rows[0]![0]).toBe("09/03/2026");
  });
});

describe("the lines beside the cards", () => {
  it("splits tractor money by network, naming the unidentified stations only when there are some", () => {
    expect(networkLine(report())).toBe(
      "Tractor fuel: $400 in network (33%) · $500 out of network (42%) · $300 at a station we couldn't identify (25%).",
    );
    const r = report();
    r.current.totals = fuelReportTotals(r.current.days.filter((d) => d.network !== "unknown"));
    expect(networkLine(r)).not.toContain("couldn't identify");
  });

  it("reports reefer beside the tractor figures, and nothing when none was bought", () => {
    expect(reeferLine(report().current)).toBe("Reefer fuel, not in the figures above: $90 for 20 gal at $4.500 / gal.");
    expect(reeferLine(report().previous)).toBeNull();
  });

  it("names the carrier's own network brands", () => {
    expect(brandList(["pilot", "flying_j"])).toBe("Pilot / Flying J");
    expect(brandList(["pilot", "flying_j", "one9"])).toBe("Pilot / Flying J / ONE9");
  });
});
