import { describe, it, expect } from "vitest";
import { computeFleetReport, type FleetReportInputs } from "./fleetReport.js";
import { assessMileageCoverage, periodDenominator } from "./mileageCoverage.js";

/**
 * The acceptance fixture is July 2026, as production holds it (FINANCE-FLEET-REPORT-PLAN §2.5).
 * The aggregates are the measured ones — ledger revenue 4,828,189.24 and expenses 4,058,143.38
 * against the owner's printed statement, 172 measured trucks over 1,552,337 miles, nine contractor
 * trucks paid 212,492.09 across 69 settlements, 203,192.01 of revenue on their orders, and
 * deductions that sort by the account they post to into 34,384.28 of carrier income, 53,917.64 of
 * fuel advances repaid, 31,356.61 of pass-through and 11,064.71 of cost charged back.
 *
 * The rows below are the smallest set that sums to those figures. What is being pinned is the
 * arithmetic and the classification, so the row count is not the point; the totals are.
 */

const JULY_MONTH = assessMileageCoverage([
  { month: "2026-07", measuredTrucks: 172, measuredMiles: 1_552_337, deliveringTrucks: 160, billedMiles: 1_389_814 },
]);
const FEB_MONTH = assessMileageCoverage([
  { month: "2026-02", measuredTrucks: 135, measuredMiles: 1_179_719, deliveringTrucks: 151, billedMiles: 1_234_486 },
]);

const ledger = {
  accounts: [
    { glid: "30000001", descr: "Gross Trucking Income", type_id: "Revenue" },
    { glid: "40000001", descr: "Subcontracted Labor: Driver", type_id: "Operating Expenses" },
  ],
  period: [
    { glid: "30000001", post_module: "BILL", net_amount: -4_828_189.24, line_count: 1415 },
    { glid: "40000001", post_module: "SET", net_amount: 4_058_143.38, line_count: 10_254 },
  ],
};

/**
 * Truck 601 is MIXED: it ran order o1 for a contractor and order o4 for a company driver. Four of
 * this carrier's eight contractor tractors were mixed in the measured month, so a fixture without
 * one cannot tell attribution-by-order from attribution-by-truck — both give the same answer, and
 * every assertion passes while proving nothing. Mutating the harness to attribute by truck is the
 * check: with o4 present it fails, without o4 it does not.
 */
const settlements = [
  { payee_type: "owner_operator", payee_id: "SCORELIL", tractor_unit: "601", order_external_id: "o1", total_pay: 112_492.09 },
  { payee_type: "owner_operator", payee_id: "IVETJOIL", tractor_unit: "602", order_external_id: "o2", total_pay: 100_000.0 },
  { payee_type: "company_driver", payee_id: "DRV101", tractor_unit: "101", order_external_id: "o3", total_pay: 1_000_000.0 },
  { payee_type: "company_driver", payee_id: "DRV601", tractor_unit: "601", order_external_id: "o4", total_pay: 44_445.08 },
];

const bills = [
  { order_external_id: "o1", tractor_unit: "601", revenue: 103_192.01 },
  { order_external_id: "o2", tractor_unit: "602", revenue: 100_000.0 },
  { order_external_id: "o3", tractor_unit: "101", revenue: 4_300_000.0 },
  // The mixed truck's company-driver load. By order it is the company's; by truck it would be
  // wrongly handed to the contractor column along with the tractor.
  { order_external_id: "o4", tractor_unit: "601", revenue: 200_000.0 },
];

/** One of each class, at July's measured totals — the derivation R2 replaced a code table with. */
const deductions = [
  { payee_type: "owner_operator", payee_id: "SCORELIL", account_type: "Revenue", amount: 34_384.28 },
  { payee_type: "owner_operator", payee_id: "SCORELIL", account_type: "Current Assets", amount: 53_917.64 },
  { payee_type: "owner_operator", payee_id: "SCORELIL", account_type: "Current Liabilities", amount: 31_356.61 },
  { payee_type: "owner_operator", payee_id: "SCORELIL", account_type: "Operating Expenses", amount: 11_064.71 },
  { payee_type: "company_driver", payee_id: "DRV101", account_type: "Revenue", amount: 9_999.0 },
];

const july = (o: Partial<FleetReportInputs> = {}): FleetReportInputs => ({
  period: { from: "2026-07-01", to: "2026-07-31" },
  ledger,
  mileage: { months: JULY_MONTH, ...periodDenominator(JULY_MONTH) },
  settlements,
  bills,
  deductions,
  billedMiles: 1_389_814,
  ...o,
});

describe("computeFleetReport", () => {
  it("takes the totals from the ledger, unaltered", () => {
    const r = computeFleetReport(july());
    expect(r.total.revenue).toBe(4_828_189.24);
    expect(r.total.expenses).toBe(4_058_143.38);
    expect(r.total.net).toBe(770_045.86);
    expect(r.total.trucks).toBe(172);
    expect(r.total.miles).toBe(1_552_337);
  });

  it("divides by measured miles to the cent", () => {
    const r = computeFleetReport(july());
    expect(r.total.revenuePerMile).toBe(3.11);
    expect(r.total.costPerMile).toBe(2.61);
    expect(r.total.netPerMile).toBe(0.5);
  });

  it("derives the contractor column from the subledgers, by order and not by truck", () => {
    const r = computeFleetReport(july());
    expect(r.ownerOperator.trucks).toBe(2);
    expect(r.ownerOperatorBasis.settlements).toBe(2);
    expect(r.ownerOperatorBasis.pay).toBe(212_492.09);
    expect(r.ownerOperatorBasis.loadRevenue).toBe(203_192.01);
    expect(r.ownerOperator.revenue).toBe(237_576.29);
    expect(r.ownerOperator.net).toBe(25_084.2);
    // The mixed truck's company-driver load stays on the company side, where its pay is.
    expect(r.ownerOperatorBasis.loadRevenue).not.toBe(303_192.01);
  });

  it("keeps a mixed truck's company load out of the contractor column", () => {
    const r = computeFleetReport(july());
    // Truck 601 ran for both. Attributing revenue by TRUCK would move the company driver's
    // $200,000 load into the contractor column along with the tractor; attributing by ORDER, which
    // is what the settlement actually says, leaves it where its pay is.
    expect(r.ownerOperatorBasis.loadRevenue).toBe(203_192.01);
    expect(r.company.revenue).toBe(4_590_612.95);
  });

  it("counts only deductions that posted to a revenue account as carrier income", () => {
    const r = computeFleetReport(july());
    // 34,384.28 in, and the 53,917.64 of fuel advances repaid stays out — it is a receivable
    // settling. Counting it would overstate contractor earnings by roughly a quarter.
    expect(r.ownerOperatorBasis.deductionIncome).toBe(34_384.28);
    expect(r.ownerOperator.revenue).not.toBe(291_493.93);
  });

  it("ignores a company driver's deductions when building the contractor column", () => {
    const r = computeFleetReport(july());
    expect(r.ownerOperatorBasis.deductionIncome).toBe(34_384.28);
  });

  it("reports a deduction that posted nowhere as unruled instead of guessing its class", () => {
    const r = computeFleetReport(
      july({
        deductions: [
          ...deductions,
          { payee_type: "owner_operator", payee_id: "SCORELIL", account_type: null, amount: 500 },
        ],
      }),
    );
    expect(r.ownerOperatorBasis.unruledDeductions).toBe(500);
    expect(r.ownerOperatorBasis.deductionIncome).toBe(34_384.28);
  });

  it("makes the company column the remainder, so the two sides always equal the ledger", () => {
    const r = computeFleetReport(july());
    expect(r.company.revenue).toBe(4_590_612.95);
    expect(r.company.expenses).toBe(3_845_651.29);
    expect(r.company.net).toBe(744_961.66);
    expect(r.tieOut.revenue).toBe(0);
    expect(r.tieOut.expenses).toBe(0);
    expect(r.company.net + r.ownerOperator.net).toBeCloseTo(r.total.net, 2);
  });

  it("gives contractors no rate when per-unit miles were not supplied, rather than inventing one", () => {
    const r = computeFleetReport(july());
    expect(r.ownerOperator.miles).toBeNull();
    expect(r.ownerOperator.netPerMile).toBeNull();
    // And the company column keeps the whole measured denominator rather than a partial one.
    expect(r.company.miles).toBe(1_552_337);
  });

  it("splits the denominator exactly when per-unit miles are supplied", () => {
    const r = computeFleetReport(july({ milesByUnit: { "601": 40_000, "602": 31_920, "101": 500_000 } }));
    expect(r.ownerOperator.miles).toBe(71_920);
    expect(r.company.miles).toBe(1_480_417);
    expect(r.ownerOperator.revenuePerMile).toBe(3.3);
    expect(r.company.netPerMile).toBe(0.5);
  });

  it("returns no rate at all for a period whose mileage coverage is short", () => {
    const r = computeFleetReport(
      july({ mileage: { months: FEB_MONTH, ...periodDenominator(FEB_MONTH) } }),
    );
    // The money still reports — it is complete and it ties.
    expect(r.total.revenue).toBe(4_828_189.24);
    expect(r.total.net).toBe(770_045.86);
    // Every rate is absent, and the reason travels with the report.
    expect(r.total.costPerMile).toBeNull();
    expect(r.company.netPerMile).toBeNull();
    expect(r.total.miles).toBeNull();
    expect(r.mileageReason).toContain("2026-02");
    expect(r.emptyMiles).toBeNull();
    expect(r.emptyPct).toBeNull();
  });

  it("even with per-unit miles, a short period gets no rate", () => {
    const r = computeFleetReport(
      july({
        mileage: { months: FEB_MONTH, ...periodDenominator(FEB_MONTH) },
        milesByUnit: { "601": 40_000, "602": 31_920 },
      }),
    );
    expect(r.ownerOperator.miles).toBeNull();
    expect(r.company.miles).toBeNull();
  });

  it("reports the second denominator and what is left over between them", () => {
    const r = computeFleetReport(july());
    expect(r.billedMiles).toBe(1_389_814);
    expect(r.emptyMiles).toBe(162_523);
    expect(r.emptyPct).toBe(10.5);
    // Priced per billed mile, which is the higher figure and a different question.
    expect(r.revenuePerBilledMile).toBe(3.47);
    expect(r.revenuePerBilledMile!).toBeGreaterThan(r.total.revenuePerMile!);
  });

  it("carries the period through untouched — nothing here computes a month boundary", () => {
    const r = computeFleetReport(july({ period: { from: "2026-07-14", to: "2026-08-03" } }));
    expect(r.period).toEqual({ from: "2026-07-14", to: "2026-08-03" });
  });

  it("carries the income statement, so one call serves every tab", () => {
    const r = computeFleetReport(july());
    expect(r.statement.revenue).toBe(4_828_189.24);
    expect(r.statement.sections.map((s) => s.typeId)).toEqual(["Revenue", "Operating Expenses"]);
  });
});

/**
 * The per-truck and per-contractor rows moved here at G7b, when the close stopped needing the
 * per-truck harness and the harness could go. What they carry is what is PRECISE at that grain —
 * miles and revenue for a truck, pay and revenue for a payee — and nothing that would need a cost
 * attribution the carrier has no source for.
 */
describe("computeFleetReport — the per-truck rows (§2 Tab 4)", () => {
  const miles = { "601": 40_000, "602": 31_920, "101": 1_480_417 };

  it("gives a truck its measured miles, its booked revenue and the rate between them", () => {
    const r = computeFleetReport(july({ milesByUnit: miles }));
    const t = r.trucks.find((x) => x.tractor_unit === "602")!;
    expect(t.miles).toBe(31_920);
    expect(t.revenue).toBe(100_000);
    expect(t.revenuePerMile).toBe(3.13);
    expect(t.loads).toBe(1);
  });

  /** Truck 601 is MIXED — a contractor and a company driver both settled on it. */
  it("marks every truck a contractor settled on, mixed ones included", () => {
    const r = computeFleetReport(july({ milesByUnit: miles }));
    expect(r.trucks.find((x) => x.tractor_unit === "601")!.isOwnerOperator).toBe(true);
    expect(r.trucks.find((x) => x.tractor_unit === "101")!.isOwnerOperator).toBe(false);
  });

  /**
   * A truck's revenue is every bill booked against it — the mixed truck's company load included.
   * The contractor COLUMN splits by order; a truck row is about the truck.
   */
  it("counts every load booked against a tractor, whoever settled it", () => {
    const r = computeFleetReport(july({ milesByUnit: miles }));
    const mixed = r.trucks.find((x) => x.tractor_unit === "601")!;
    expect(mixed.loads).toBe(2);
    expect(mixed.revenue).toBe(303_192.01);
  });

  it("gives no rate to a truck the period did not measure, and keeps its dollars", () => {
    const r = computeFleetReport(july({ milesByUnit: { "601": 40_000 } }));
    const unmeasured = r.trucks.find((x) => x.tractor_unit === "602")!;
    expect(unmeasured.revenue).toBe(100_000);
    expect(unmeasured.miles).toBe(0);
    expect(unmeasured.revenuePerMile).toBeNull();
  });

  it("sorts by what a truck earned, because that is the column being read", () => {
    const r = computeFleetReport(july({ milesByUnit: miles }));
    expect(r.trucks[0]!.tractor_unit).toBe("101");
  });
});

describe("computeFleetReport — the contractor rows", () => {
  it("reports one row per payee, not per truck", () => {
    const r = computeFleetReport(july());
    expect(r.ownerOperators.map((o) => o.payeeId).sort()).toEqual(["IVETJOIL", "SCORELIL"]);
    expect(r.ownerOperators.find((o) => o.payeeId === "SCORELIL")!.units).toEqual(["601"]);
  });

  /**
   * Read back from what settled, never configured: three different splits across five payees were
   * measured in June 2026, so one fleet-wide rate would have been fiction.
   */
  it("reads each payee's deal back out of their own pay and revenue", () => {
    const r = computeFleetReport(july());
    const scorelil = r.ownerOperators.find((o) => o.payeeId === "SCORELIL")!;
    expect(scorelil.revenue).toBe(103_192.01);
    expect(scorelil.pay).toBe(112_492.09);
    expect(scorelil.dealPct).toBe(109.01);
    const ivet = r.ownerOperators.find((o) => o.payeeId === "IVETJOIL")!;
    expect(ivet.dealPct).toBe(100);
  });

  it("credits deduction income to the payee it was deducted from", () => {
    const r = computeFleetReport(july());
    const scorelil = r.ownerOperators.find((o) => o.payeeId === "SCORELIL")!;
    expect(scorelil.deductionIncome).toBe(34_384.28);
    expect(scorelil.netMargin).toBe(round2(scorelil.grossMargin + 34_384.28));
  });

  it("leaves company drivers out of the contractor rows entirely", () => {
    const r = computeFleetReport(july());
    expect(r.ownerOperators.some((o) => o.payeeId.startsWith("DRV"))).toBe(false);
  });
});

const round2 = (n: number) => Math.round(n * 100) / 100;
