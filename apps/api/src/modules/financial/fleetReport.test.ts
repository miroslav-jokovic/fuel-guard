import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { getFleetReport } from "./fleetReport.js";

const ORG = "11111111-1111-1111-1111-111111111111";
const mi = (miles: number) => miles * 1609.344;

const ACCOUNTS = [
  { glid: "30000001", descr: "Gross Trucking Income", type_id: "Revenue" },
  { glid: "40000001", descr: "Subcontracted Labor: Driver", type_id: "Operating Expenses" },
  { glid: "40050000", descr: "Fuel for Hired Vehicles", type_id: "Operating Expenses" },
  // The four classes a contractor deduction can post to. Only the first is income to the carrier.
  { glid: "40100000", descr: "Equipment Rental", type_id: "Revenue" },
  { glid: "17000000", descr: "Fuel Advance", type_id: "Current Assets" },
  { glid: "20500010", descr: "Company Driver Payable", type_id: "Current Liabilities" },
  { glid: "40150000", descr: "Repairs and Maintenance", type_id: "Operating Expenses" },
];

const GL_TOTALS = [
  { period_start: "2026-07-01", period_end: "2026-08-01", swept_at: "2026-08-03 04:00:00+00", post_module: "BILL", glid: "30000001", line_count: 1415, net_amount: "-4828189.24", abs_amount: "4828189.24" },
  // July's expenses, split across two families so the summary has something to group. The two
  // still sum to the measured 4,058,143.38 every assertion below is written against.
  { period_start: "2026-07-01", period_end: "2026-08-01", swept_at: "2026-08-03 04:00:00+00", post_module: "SET", glid: "40000001", line_count: 10254, net_amount: "3085322.76", abs_amount: "3085322.76" },
  { period_start: "2026-07-01", period_end: "2026-08-01", swept_at: "2026-08-03 04:00:00+00", post_module: "FUEL", glid: "40050000", line_count: 5777, net_amount: "972820.62", abs_amount: "972820.62" },
];

/**
 * August as production held it on 2026-09-03 — swept on the 28th, four days before the month ended,
 * so the ledger holds one expense line and no revenue at all. The finance page opens on the last
 * full calendar month, which on that date is August, so this row IS what the page showed (G11).
 */
const AUGUST_PARTIAL = [
  { period_start: "2026-08-01", period_end: "2026-09-01", swept_at: "2026-08-28 21:02:56.551+00", post_module: "RJ", glid: "40150000", line_count: 11, net_amount: "8430.00", abs_amount: "8430.00" },
];

const SAMSARA = [
  { id: "1", vehicle_id: "vA", period_year: 2026, period_month: 7, total_meters: mi(1_480_417) },
  { id: "2", vehicle_id: "vB", period_year: 2026, period_month: 7, total_meters: mi(71_920) },
];
const VEHICLES = [
  { id: "vA", unit_number: "101" },
  { id: "vB", unit_number: "601" },
];

/**
 * Truck 601 is MIXED — it ran order o1 for a contractor and o4 for a company driver — because four
 * of this carrier's eight contractor tractors are, and a fixture without one cannot tell
 * attribution-by-order from attribution-by-truck.
 */
const SETTLEMENTS = [
  { id: "s1", payee_type: "owner_operator", tractor_unit: "601", order_external_id: "o1", total_pay: "212492.09", is_void: false },
  { id: "s2", payee_type: "company_driver", tractor_unit: "101", order_external_id: "o3", total_pay: "1000000.00", is_void: false },
  { id: "s3", payee_type: "company_driver", tractor_unit: "601", order_external_id: "o4", total_pay: "44445.08", is_void: false },
  // Voided: never paid, so it must not swell the contractor column.
  { id: "s4", payee_type: "owner_operator", tractor_unit: "601", order_external_id: "o5", total_pay: "99999.00", is_void: true },
];

const BILLS = [
  { id: "b1", order_external_id: "o1", tractor_unit: "601", total_charges: "203192.01", other_charge: "0", post_key: "k1", post_module: "BILL", bill_date: "2026-07-10", delivery_date: "2026-07-08", distance: 71_920, canceled: false },
  { id: "b2", order_external_id: "o3", tractor_unit: "101", total_charges: "4300000.00", other_charge: "0", post_key: "k2", post_module: "BILL", bill_date: "2026-07-12", delivery_date: "2026-07-10", distance: 1_100_000, canceled: false },
  { id: "b3", order_external_id: "o4", tractor_unit: "601", total_charges: "200000.00", other_charge: "0", post_key: "k3", post_module: "BILL", bill_date: "2026-07-14", delivery_date: "2026-07-12", distance: 217_894, canceled: false },
  // Staged but never booked by the GL: excluded, like every other revenue figure (D-MC12).
  { id: "b4", order_external_id: "o1", tractor_unit: "601", total_charges: "50000.00", other_charge: "0", post_key: null, post_module: null, bill_date: "2026-07-20", delivery_date: "2026-07-18", distance: 0, canceled: false },
];

const DEDUCTIONS = [
  { payee_id: "p1", glid: "40100000", amount: "34384.28" },
  { payee_id: "p1", glid: "17000000", amount: "53917.64" },
  { payee_id: "p1", glid: "20500010", amount: "31356.61" },
  { payee_id: "p1", glid: "40150000", amount: "11064.71" },
  { payee_id: "p1", glid: null, amount: "500.00" },
];

const between = (q: RecordedQuery, col: string, v: string) => {
  const gte = q.ops.find((o) => o.method === "gte" && o.args[0] === col)?.args[1] as string | undefined;
  const lt = q.ops.find((o) => o.method === "lt" && o.args[0] === col)?.args[1] as string | undefined;
  return (!gte || v >= gte) && (!lt || v < lt);
};

const recorder = (glTotals: unknown[] = GL_TOTALS) =>
  createSupabaseRecorder({
    tables: {
      mcleod_gl_totals: glTotals,
      mcleod_gl_accounts: ACCOUNTS,
      mcleod_settlements: SETTLEMENTS,
      mcleod_deductions: DEDUCTIONS,
      vehicles: VEHICLES,
      samsara_ifta_jurisdiction_miles: (q) => {
        const f = q.filters();
        const y = f.find((x) => x.col === "period_year")?.val;
        const m = f.find((x) => x.col === "period_month")?.val;
        return SAMSARA.filter((r) => r.period_year === y && r.period_month === m);
      },
      // Two readers hit this table on different columns, so the fixture answers on whichever the
      // caller actually windowed — a flat array would give the coverage read July's invoices and
      // the report read July's deliveries indistinguishably.
      mcleod_billing: (q) =>
        BILLS.filter(
          (b) =>
            between(q, "bill_date", b.bill_date) && between(q, "delivery_date", b.delivery_date),
        ),
    },
  });

describe("getFleetReport", () => {
  it("reports the ledger's totals and divides them by measured miles, org-scoped", async () => {
    const rec = recorder();
    const r = await getFleetReport(rec.client, ORG, "2026-07-01", "2026-07-31");
    expect(r.total.revenue).toBe(4_828_189.24);
    expect(r.total.expenses).toBe(4_058_143.38);
    expect(r.total.net).toBe(770_045.86);
    expect(r.total.miles).toBe(1_552_337);
    expect(r.total.trucks).toBe(2);
    expect(r.total.costPerMile).toBe(2.61);
    expectOrgScoped(rec, ORG);
  });

  it("splits contractors out by order, leaving a mixed truck's company load on the company side", async () => {
    const rec = recorder();
    const r = await getFleetReport(rec.client, ORG, "2026-07-01", "2026-07-31");
    expect(r.ownerOperatorBasis.loadRevenue).toBe(203_192.01);
    expect(r.ownerOperatorBasis.pay).toBe(212_492.09);
    expect(r.company.revenue).toBe(4_590_612.95);
    expect(r.tieOut.revenue).toBe(0);
    expect(r.tieOut.expenses).toBe(0);
  });

  it("classifies a contractor deduction by the account it posts to, not by its code", async () => {
    const rec = recorder();
    const r = await getFleetReport(rec.client, ORG, "2026-07-01", "2026-07-31");
    // Only the revenue-account deduction is income. The fuel advance repaid is a receivable.
    expect(r.ownerOperatorBasis.deductionIncome).toBe(34_384.28);
    expect(r.ownerOperatorBasis.unruledDeductions).toBe(500);
  });

  it("leaves a voided settlement out of the contractor column", async () => {
    const rec = recorder();
    const r = await getFleetReport(rec.client, ORG, "2026-07-01", "2026-07-31");
    expect(r.ownerOperatorBasis.settlements).toBe(1);
    expect(r.ownerOperatorBasis.pay).not.toBe(312_491.09);
  });

  it("counts only bills the ledger booked, like every other revenue figure", async () => {
    const rec = recorder();
    const r = await getFleetReport(rec.client, ORG, "2026-07-01", "2026-07-31");
    // b4 is staged but unposted: including it would put contractor load revenue at 253,192.01.
    expect(r.ownerOperatorBasis.loadRevenue).toBe(203_192.01);
  });

  it("splits the denominator by unit once Samsara miles resolve to tractor numbers", async () => {
    const rec = recorder();
    const r = await getFleetReport(rec.client, ORG, "2026-07-01", "2026-07-31");
    expect(r.ownerOperator.miles).toBe(71_920);
    expect(r.company.miles).toBe(1_480_417);
    expect(r.company.netPerMile).toBe(0.5);
  });

  it("names the months it covered and the months no sweep has reached", async () => {
    const rec = recorder();
    const r = await getFleetReport(rec.client, ORG, "2026-07-01", "2026-09-15");
    expect(r.monthsCovered).toEqual(["2026-07"]);
    expect(r.monthsMissing).toEqual(["2026-08", "2026-09"]);
  });

  /**
   * What the page actually showed on the morning of 2026-09-03: the default window is the last full
   * calendar month, August, whose ledger held eleven lines and no revenue because the sweep had run
   * on the 28th. "Earned $0, spent $8,430, kept −$8,430" was arithmetically correct and was not a
   * fact about August.
   */
  it("reports no money at all for a month swept before it ended, and says why", async () => {
    const r = await getFleetReport(recorder([...GL_TOTALS, ...AUGUST_PARTIAL]).client, ORG, "2026-08-01", "2026-08-31");
    expect(r.total.revenue).toBe(0);
    expect(r.total.expenses).toBe(0);
    expect(r.monthsPartial.map((m) => m.month)).toEqual(["2026-08"]);
    expect(r.ledgerReason).toContain("2026-08-28");
    expect(r.monthsCovered).toEqual([]);
  });

  /**
   * The family summary (G6) rides on this call because only it holds both halves: the statement's
   * own lines, and the miles the period measured. July's fuel — $972,820.62 of it in this fixture —
   * is 20.15% of revenue and 63 cents of every mile the fleet ran.
   */
  it("summarises the statement into signed families, priced against revenue and miles", async () => {
    const r = await getFleetReport(recorder().client, ORG, "2026-07-01", "2026-07-31");
    const fuel = r.families.expense.find((f) => f.label === "Fuel and fluids")!;
    expect(fuel.amount).toBe(972_820.62);
    expect(fuel.pctOfRevenue).toBe(20.1);
    expect(fuel.perMile).toBe(0.63);
    expect(r.families.tieOut).toEqual({ revenue: 0, expenses: 0 });
  });
});
