import { describe, it, expect } from "vitest";
import { buildFamilySummary, GL_FAMILIES, UNASSIGNED_FAMILY } from "./glFamilies.js";
import { buildIncomeStatement, type LedgerTotalRow, type LedgerAccount } from "./incomeStatement.js";

/**
 * The acceptance fixture is production's own fiscal year to date, 2026-01-01 to 2026-07-31, as
 * measured on 2026-09-03 and reviewed by the owner before the map was signed: revenue
 * 28,687,090.14, fuel and fluids 6,399,386.60 over four accounts, company driver pay 7,346,088.87
 * over five, IRP 317,971.96, Tolls OO 990.42, and 9,956,348 measured miles behind them.
 *
 * Those are the figures the map was signed against, so they are what the tests assert. The two
 * cross-class accounts are in the fixture on purpose: they are the reason the map exists.
 */

const ACCOUNTS: LedgerAccount[] = [
  { glid: "30000001", descr: "Gross Trucking Income", type_id: "Revenue" },
  // A revenue account with an expense-shaped code. McLeod's codes do not encode side either.
  { glid: "40100000", descr: "Equipment Rental", type_id: "Revenue" },
  { glid: "40050000", descr: "Fuel for Hired Vehicles", type_id: "Operating Expenses" },
  { glid: "30220000", descr: "DEF", type_id: "Operating Expenses" },
  { glid: "30340000", descr: "Reefer Fuel", type_id: "Operating Expenses" },
  { glid: "30210000", descr: "Additives", type_id: "Operating Expenses" },
  { glid: "40000001", descr: "Subcontracted Labor: Driver", type_id: "Operating Expenses" },
  { glid: "40000000", descr: "Subcontracted Labor", type_id: "Operating Expenses" },
  { glid: "40800000", descr: "Travel Expense for Drivers", type_id: "Operating Expenses" },
  { glid: "40000031", descr: "Subcontracted Labor: Bonus", type_id: "Operating Expenses" },
  { glid: "40000032", descr: "Subcontracted Labor: Bonus", type_id: "Operating Expenses" },
  // The two accounts whose McLeod class disagrees with the family the owner put them in.
  { glid: "40230000", descr: "IRP", type_id: "General & Admin Expenses" },
  { glid: "40790002", descr: "Tolls OO", type_id: "Income Tax Expense" },
  // An account the signed map has never seen — the bookkeeper's next invention.
  { glid: "49999999", descr: "Drone Inspection Fees", type_id: "Operating Expenses" },
  // A CLASS this build has never seen. The statement reports it in its own section and counts it
  // into neither total, so a family summary that swept it up would stop agreeing with the totals
  // it summarises.
  { glid: "99000000", descr: "Suspense", type_id: "Suspense" },
];

/** Revenue posts as a credit; expenses as debits. The statement flips revenue once. */
const row = (glid: string, amount: number, revenue = false): LedgerTotalRow => ({
  glid,
  post_module: "GL",
  net_amount: revenue ? -amount : amount,
  line_count: 1,
});

const PERIOD: LedgerTotalRow[] = [
  row("30000001", 28_613_476.26, true),
  row("40100000", 73_613.88, true),
  row("40050000", 6_026_211.92),
  row("30220000", 300_463.89),
  row("30340000", 65_113.89),
  row("30210000", 7_596.9),
  row("40000001", 6_869_763.95),
  row("40000000", 411_931.37),
  row("40800000", 41_933.28),
  row("40000031", 22_360.27),
  row("40000032", 100.0),
  row("40230000", 317_971.96),
  row("40790002", 990.42),
  row("49999999", 5_000.0),
  row("99000000", 1_234.0),
];

const MILES = 9_956_348;
const statement = (period = PERIOD) => buildIncomeStatement({ period, accounts: ACCOUNTS });
const summary = (miles: number | null = MILES, period = PERIOD) =>
  buildFamilySummary(statement(period), miles);
const family = (label: string) => {
  const s = summary();
  const hit = [...s.revenue, ...s.expense].find((f) => f.label === label);
  if (!hit) throw new Error(`no family ${label}`);
  return hit;
};

describe("GL_FAMILIES", () => {
  /** A code in two families would be counted twice and the tie-out would still be zero. */
  it("names every account exactly once", () => {
    const seen = new Set<string>();
    const twice: string[] = [];
    for (const f of GL_FAMILIES) {
      for (const g of f.glids) {
        if (seen.has(g)) twice.push(g);
        seen.add(g);
      }
    }
    expect(twice).toEqual([]);
  });

  it("groups ten families of expense and four of income", () => {
    expect(GL_FAMILIES.filter((f) => f.isRevenue)).toHaveLength(4);
    expect(GL_FAMILIES.filter((f) => !f.isRevenue)).toHaveLength(10);
  });

  /**
   * The five calls the data could not make, signed 2026-09-03. They are asserted here rather than
   * left in a document because each one is a place where McLeod's own class says otherwise, and a
   * later reader "correcting" the map back to the class would be undoing a ruling.
   */
  it("keeps the owner's five rulings", () => {
    const of = (glid: string) => GL_FAMILIES.find((f) => f.glids.includes(glid))?.key;
    expect(of("40000002")).toBe("contractor_pay"); // contractors are their own family
    expect(of("40230000")).toBe("jurisdictional"); // IRP, though McLeod files it under G&A
    expect(of("43220000")).toBe("recruiting"); // drug tests belong with recruiting, not office
    expect(of("40650000")).toBe("financing"); // quick pay is the cost of getting paid
    expect(of("40700000")).toBe("road_charges"); // unloading rides with tolls and scales
  });
});

describe("buildFamilySummary", () => {
  it("sums each family from its own accounts", () => {
    expect(family("Fuel and fluids").amount).toBe(6_399_386.6);
    expect(family("Fuel and fluids").accounts).toBe(4);
    expect(family("Company driver pay").amount).toBe(7_346_088.87);
    expect(family("Company driver pay").accounts).toBe(5);
  });

  /**
   * The question the summary exists to answer. $6.4M of fuel means nothing until it is 22% of what
   * the fleet earned, and 64 cents of every mile.
   */
  it("states a family against revenue and against the miles", () => {
    const fuel = family("Fuel and fluids");
    expect(fuel.pctOfRevenue).toBe(22.3);
    expect(fuel.perMile).toBe(0.64);
  });

  it("withholds the per-mile figure when the period's mileage cannot support one", () => {
    const withoutMiles = buildFamilySummary(statement(), null);
    expect(withoutMiles.expense.every((f) => f.perMile === null)).toBe(true);
    // The money is untouched — coverage removes rates, never dollars (G10).
    expect(withoutMiles.expense.find((f) => f.label === "Fuel and fluids")!.amount).toBe(6_399_386.6);
  });

  /**
   * The two accounts the map exists for. McLeod files IRP under General & Admin, next to rent, and
   * Tolls OO under Income Tax Expense; the owner put them where the money actually goes.
   */
  it("groups by the signed family, not by McLeod's class", () => {
    expect(family("Permits, IFTA and IRP").amount).toBe(317_971.96);
    expect(family("Tolls, scales and unloading").amount).toBe(990.42);
  });

  it("ranks families by what they cost, largest first", () => {
    const s = summary();
    expect(s.expense.map((f) => f.label).slice(0, 2)).toEqual([
      "Company driver pay",
      "Fuel and fluids",
    ]);
  });

  /**
   * The next account the bookkeeper invents. It is shown, counted, and named as ungrouped — never
   * folded into the nearest plausible family, which is how a map stops being true without saying so.
   */
  it("gives an account the map has never seen its own family, counted and last", () => {
    const s = summary();
    const ungrouped = s.expense[s.expense.length - 1]!;
    expect(ungrouped.label).toBe(UNASSIGNED_FAMILY);
    expect(ungrouped.isUnassigned).toBe(true);
    expect(ungrouped.amount).toBe(5_000);
    // Last despite being the smallest is not the test — this proves it sorts last on being
    // ungrouped, by making it bigger than two real families.
    const big = summary(MILES, [...PERIOD.filter((r) => r.glid !== "49999999"), row("49999999", 900_000)]);
    expect(big.expense[big.expense.length - 1]!.label).toBe(UNASSIGNED_FAMILY);
  });

  it("ties to the statement's own totals on both sides", () => {
    const s = summary();
    expect(s.tieOut).toEqual({ revenue: 0, expenses: 0 });
    // The unrecognised class is in the statement and in no family: it is counted into neither
    // total, so counting it into one would put the summary at odds with the figures above it.
    expect(statement().unrecognisedNet).toBe(1_234);
    expect([...s.revenue, ...s.expense].reduce((n, f) => n + f.accounts, 0)).toBe(14);
    const revenue = s.revenue.reduce((n, f) => n + f.amount, 0);
    expect(Math.round(revenue * 100) / 100).toBe(28_687_090.14);
  });

  /**
   * A revenue account is revenue even if the map filed it under an expense family. It lands
   * ungrouped ON ITS OWN SIDE rather than moving dollars across the statement, because a summary
   * that quietly re-signs a line is worse than one that admits it has no name for it.
   */
  it("takes a line's side from the statement, never from the map", () => {
    const misfiled = buildIncomeStatement({
      period: [row("40050000", 1_000, true)],
      accounts: [{ glid: "40050000", descr: "Fuel booked as income", type_id: "Revenue" }],
    });
    const s = buildFamilySummary(misfiled, null);
    expect(s.expense).toEqual([]);
    expect(s.revenue).toHaveLength(1);
    expect(s.revenue[0]!.label).toBe(UNASSIGNED_FAMILY);
    expect(s.tieOut).toEqual({ revenue: 0, expenses: 0 });
  });

  it("shows a share of nothing as a dash rather than as zero per cent", () => {
    const noRevenue = buildIncomeStatement({
      period: [row("40050000", 1_000)],
      accounts: ACCOUNTS,
    });
    expect(buildFamilySummary(noRevenue, null).expense[0]!.pctOfRevenue).toBeNull();
  });
});
