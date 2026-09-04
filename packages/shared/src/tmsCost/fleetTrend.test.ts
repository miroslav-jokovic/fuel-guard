import { describe, it, expect } from "vitest";
import { computeFleetTrend, type FleetTrendMonthInput } from "./fleetTrend.js";
import { assessMileageCoverage, periodDenominator, type MonthMileage } from "./mileageCoverage.js";

/**
 * The acceptance fixture is the seven months production actually holds, as measured on 2026-09-03
 * (FINANCE-FLEET-REPORT-PLAN §1.5).
 *
 * **Measured, and therefore load-bearing:** the Samsara coverage counts — January measured 130 of
 * the 139 trucks that delivered, February 135 of 151, March 149/149, April 157/155, July 172/160 —
 * the driven and billed miles for March through July, and July's ledger totals of 4,828,189.24 and
 * 4,058,143.38, which reproduce the owner's printed statement to the cent. The fiscal year to date
 * on that statement, 28,687,090.14 against 25,126,042.28, is what the six earlier months are chosen
 * to sum to.
 *
 * **Chosen, and therefore not evidence of anything:** how those six months divide that total, and
 * January and February's mileage — both months are refused a rate whatever their miles say, which
 * is the rule being pinned.
 */

const COVERAGE: MonthMileage[] = assessMileageCoverage([
  { month: "2026-01", measuredTrucks: 130, measuredMiles: 1_100_000, deliveringTrucks: 139, billedMiles: 1_050_000 },
  { month: "2026-02", measuredTrucks: 135, measuredMiles: 1_179_719, deliveringTrucks: 151, billedMiles: 1_234_486 },
  { month: "2026-03", measuredTrucks: 149, measuredMiles: 1_370_444, deliveringTrucks: 149, billedMiles: 1_391_350 },
  { month: "2026-04", measuredTrucks: 157, measuredMiles: 1_492_407, deliveringTrucks: 155, billedMiles: 1_348_180 },
  { month: "2026-05", measuredTrucks: 165, measuredMiles: 1_563_003, deliveringTrucks: 158, billedMiles: 1_322_679 },
  { month: "2026-06", measuredTrucks: 169, measuredMiles: 1_574_109, deliveringTrucks: 161, billedMiles: 1_438_262 },
  { month: "2026-07", measuredTrucks: 172, measuredMiles: 1_552_337, deliveringTrucks: 160, billedMiles: 1_389_814 },
]);
const coverageFor = (month: string) => COVERAGE.find((m) => m.month === month);

const accounts = [
  { glid: "30000001", descr: "Gross Trucking Income", type_id: "Revenue" },
  { glid: "40000001", descr: "Subcontracted Labor: Driver", type_id: "Operating Expenses" },
];

/** Revenue posts as a credit and expense as a debit — the ledger's own signs, flipped once inside. */
const rows = (revenue: number, expenses: number) => [
  { glid: "30000001", post_module: "BILL", net_amount: -revenue, line_count: 1 },
  { glid: "40000001", post_module: "SET", net_amount: expenses, line_count: 1 },
];

const MONEY: Array<[string, number, number]> = [
  ["2026-01", 3_500_000.0, 3_300_000.0],
  ["2026-02", 3_600_000.0, 3_400_000.0],
  ["2026-03", 4_000_000.0, 3_500_000.0],
  ["2026-04", 4_100_000.0, 3_600_000.0],
  ["2026-05", 4_200_000.0, 3_700_000.0],
  ["2026-06", 4_458_900.9, 3_567_898.9],
  ["2026-07", 4_828_189.24, 4_058_143.38],
];

const months = (over = MONEY): FleetTrendMonthInput[] =>
  over.map(([month, revenue, expenses]) => ({
    month,
    ledger: rows(revenue, expenses),
    mileage: coverageFor(month),
  }));

const trend = (over?: FleetTrendMonthInput[]) =>
  computeFleetTrend({ months: over ?? months(), accounts });

const at = (month: string) => {
  const p = trend().points.find((x) => x.month === month);
  if (!p) throw new Error(`no point for ${month}`);
  return p;
};

describe("computeFleetTrend", () => {
  it("takes each month's money from that month's ledger and its rates from that month's miles", () => {
    const july = at("2026-07");
    expect(july.revenue).toBe(4_828_189.24);
    expect(july.expenses).toBe(4_058_143.38);
    expect(july.net).toBe(770_045.86);
    expect(july.miles).toBe(1_552_337);
    expect(july.trucks).toBe(172);
    // The measured July figures: $3.11 earned and $2.61 spent on every mile the fleet ran.
    expect(july.revenuePerMile).toBe(3.11);
    expect(july.costPerMile).toBe(2.61);
    expect(july.netPerMile).toBe(0.5);
    expect(july.reason).toBeNull();
  });

  /**
   * Kept per mile is the month's OWN net over its own miles, not the difference of the two rounded
   * rates beside it. March is the month where those disagree: 2.92 earned less 2.55 spent is 0.37,
   * and 500,000 over 1,370,444 miles is 0.36. A page that printed 0.37 under a $500,000 net would
   * be off by 3% for no reason a reader could ever find.
   */
  it("divides the month's own net by the month's own miles", () => {
    const march = at("2026-03");
    expect(march.revenuePerMile).toBe(2.92);
    expect(march.costPerMile).toBe(2.55);
    expect(march.netPerMile).toBe(0.36);
  });

  it("keeps a short-coverage month's money and refuses its rates", () => {
    for (const month of ["2026-01", "2026-02"]) {
      const p = at(month);
      expect(p.revenue).toBeGreaterThan(0);
      expect(p.expenses).toBeGreaterThan(0);
      expect(p.miles).toBeNull();
      expect(p.revenuePerMile).toBeNull();
      expect(p.costPerMile).toBeNull();
      expect(p.netPerMile).toBeNull();
      expect(p.reason).toContain(month);
    }
    // February is 16 trucks short of the 151 that delivered — the reason says how many, because
    // "coverage is incomplete" sends a reader looking for a number the page already has.
    expect(at("2026-02").reason).toContain("16");
  });

  /**
   * The month-level reason is the period-level rule applied to one month, not a second wording of
   * it. A mutant that phrases its own message here gives a reader two explanations of one refusal.
   */
  it("states the refusal in the coverage rule's own words", () => {
    const feb = coverageFor("2026-02")!;
    expect(at("2026-02").reason).toBe(periodDenominator([feb]).reason);
  });

  it("refuses a rate for a month Samsara measured nothing for, and says so", () => {
    const t = computeFleetTrend({
      months: [{ month: "2026-07", ledger: rows(4_828_189.24, 4_058_143.38) }],
      accounts,
    });
    expect(t.points[0]!.revenue).toBe(4_828_189.24);
    expect(t.points[0]!.costPerMile).toBeNull();
    expect(t.points[0]!.reason).toBe(periodDenominator([]).reason);
  });

  /**
   * The McLeod sweep lands a month at a time. An unswept month plotted at zero draws a collapse to
   * the axis that never happened, and a chart is read faster than the footnote under it.
   */
  it("leaves a month the ledger has not reached out of the series and names it", () => {
    const t = computeFleetTrend({
      months: [
        { month: "2025-12", ledger: [], mileage: coverageFor("2026-07") },
        ...months(),
      ],
      accounts,
    });
    expect(t.missing).toEqual(["2025-12"]);
    expect(t.points.map((p) => p.month)).not.toContain("2025-12");
    expect(t.points).toHaveLength(7);
    expect(t.points.every((p) => p.revenue > 0)).toBe(true);
  });

  it("orders the series oldest first, whatever order it was handed", () => {
    const t = computeFleetTrend({ months: [...months()].reverse(), accounts });
    expect(t.points.map((p) => p.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
    ]);
  });

  it("counts the months that carry rates, so a page can tell an empty chart from a broken one", () => {
    expect(trend().rated).toBe(5);
    expect(computeFleetTrend({ months: months(MONEY.slice(0, 2)), accounts }).rated).toBe(0);
  });

  /**
   * Nothing is dropped and nothing is counted twice: the seven plotted months sum to the fiscal
   * year to date the owner's own printed July statement carries.
   */
  it("sums to the printed fiscal year to date", () => {
    const points = trend().points;
    expect(points.reduce((n, p) => n + p.revenue, 0)).toBeCloseTo(28_687_090.14, 2);
    expect(points.reduce((n, p) => n + p.expenses, 0)).toBeCloseTo(25_126_042.28, 2);
    expect(points.reduce((n, p) => n + p.net, 0)).toBeCloseTo(3_561_047.86, 2);
  });

  it("has no series at all when no month has been asked for", () => {
    const t = computeFleetTrend({ months: [], accounts });
    expect(t.points).toEqual([]);
    expect(t.missing).toEqual([]);
    expect(t.rated).toBe(0);
  });
});
