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
 *
 * `total_pay` differs from `posted_pay` on s1 as it does on real contractor rows (an adjustment after
 * the accrual posted): the report reads what the ledger booked, `posted_pay` (Q-TP6).
 */
const SETTLEMENTS = [
  { id: "s1", payee_type: "owner_operator", tractor_unit: "601", order_external_id: "o1", total_pay: "210000.00", posted_pay: "212492.09", is_void: false, accrual_key: "A1", accrued_at: "2026-07-05T00:00:00Z" },
  { id: "s2", payee_type: "company_driver", tractor_unit: "101", order_external_id: "o3", total_pay: "1000000.00", posted_pay: "1000000.00", is_void: false, accrual_key: "A3", accrued_at: "2026-07-06T00:00:00Z" },
  { id: "s3", payee_type: "company_driver", tractor_unit: "601", order_external_id: "o4", total_pay: "44445.08", posted_pay: "44445.08", is_void: false, accrual_key: "A4", accrued_at: "2026-07-07T00:00:00Z" },
  // Voided and re-issued as s1 on the same accrual key: the ledger's SET books the key once, for the
  // live row, so this one must not swell the contractor column.
  { id: "s4", payee_type: "owner_operator", tractor_unit: "601", order_external_id: "o5", total_pay: "99999.00", posted_pay: "99999.00", is_void: true, accrual_key: "A1", accrued_at: "2026-07-05T00:00:00Z" },
];

type Settlement = (typeof SETTLEMENTS)[number] & { post_key?: string; transferred_at?: string; void_date?: string; payee_id?: string };

/** Answers the accrual-window read and the void-date read on the columns each actually filters. */
const settlementsTable = (rows: Settlement[]) => (q: RecordedQuery) =>
  q.filters().some((f) => f.col === "is_void" && f.val === true)
    ? rows.filter((s) => s.is_void && s.void_date && between(q, "void_date", s.void_date))
    : rows.filter((s) => between(q, "accrued_at", s.accrued_at));

const BILLS = [
  // A contractor load with accessorials. McLeod's total_charges already holds the 12,345.67 of
  // other charges, so the contractor's revenue is 203,192.01 — not 215,537.68.
  { id: "b1", order_external_id: "o1", tractor_unit: "601", total_charges: "203192.01", other_charge: "12345.67", post_key: "k1", post_module: "BILL", bill_date: "2026-07-10", delivery_date: "2026-07-08", distance: 71_920, canceled: false },
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

const recorder = (
  glTotals: unknown[] = GL_TOTALS,
  glControl: unknown[] = [],
  bills: Array<(typeof BILLS)[number] & { bill_type?: string }> = BILLS,
  settlements: Settlement[] = SETTLEMENTS,
) =>
  createSupabaseRecorder({
    tables: {
      mcleod_gl_totals: glTotals,
      mcleod_gl_control: glControl,
      mcleod_gl_accounts: ACCOUNTS,
      mcleod_settlements: settlementsTable(settlements),
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
        bills.filter(
          (b) =>
            between(q, "bill_date", b.bill_date) && between(q, "delivery_date", b.delivery_date),
        ),
    },
  });

describe("getFleetReport", () => {
  // D-TP5: July is reported either way. With McLeod's open period at July it is named as still
  // open; once the pointer moves to August it is final and the note goes away.
  it("names a reported month McLeod has not closed, and drops the note once it has", async () => {
    const open = (start: string) => [{ company_id: "TMS", period_start: start, prior_post_allowed: false, swept_at: "2026-08-28T21:02:56Z" }];
    const stillOpen = await getFleetReport(recorder(GL_TOTALS, open("2026-07-01")).client, ORG, "2026-07-01", "2026-07-31");
    expect(stillOpen.total.revenue).toBe(4_828_189.24);
    expect(stillOpen.monthsOpen).toEqual(["2026-07"]);
    expect(stillOpen.openNote).toContain("2026-07 is still open in McLeod");
    expect(stillOpen.closeKnown).toBe(true);
    const closed = await getFleetReport(recorder(GL_TOTALS, open("2026-08-01")).client, ORG, "2026-07-01", "2026-07-31");
    expect(closed.monthsOpen).toEqual([]);
    expect(closed.openNote).toBeNull();
    const unknown = await getFleetReport(recorder().client, ORG, "2026-07-01", "2026-07-31");
    expect(unknown.closeKnown).toBe(false);
    expect(unknown.monthsOpen).toEqual([]);
  });

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

  /**
   * GL module SETV reverses a voided, transferred settlement on its VOID date (TRUCK-DRIVER-PNL-PLAN
   * §1.3 D3). s5 accrued in June and was voided in July, so July's contractor pay loses its 5,000.00
   * — and it is not a July settlement, so the count and the contractor's trucks do not move.
   */
  it("takes a settlement voided this month off the contractor on its void date, without counting it as a settlement", async () => {
    const s5: Settlement = {
      id: "s5", payee_type: "owner_operator", tractor_unit: "602", order_external_id: "o9", total_pay: "5000.00", posted_pay: "5000.00",
      is_void: true, accrual_key: "A9", accrued_at: "2026-06-20T00:00:00Z", post_key: "P9", transferred_at: "2026-06-25T00:00:00Z", void_date: "2026-07-15T00:00:00Z",
    };
    // Voided in June: June's reversal, not July's, though its row is as old as s5's.
    const juneVoid: Settlement = { ...s5, id: "s7", posted_pay: "333.00", void_date: "2026-06-28T00:00:00Z" };
    const r = await getFleetReport(recorder(GL_TOTALS, [], BILLS, [...SETTLEMENTS, s5, juneVoid]).client, ORG, "2026-07-01", "2026-07-31");
    expect(r.ownerOperatorBasis.pay).toBe(207_492.09);
    expect(r.ownerOperatorBasis.settlements).toBe(1);
    expect(r.ownerOperator.miles).toBe(71_920);
  });

  /**
   * A voided row alone on its accrual key is still booked by SET on its accrual date — the void does
   * not un-post it — and SETV takes it back on the void date. Both in July: the month nets to zero.
   * A void never transferred posts no SETV, so it stays in the month's pay as SET booked it.
   */
  it("books a lone voided settlement on accrual and reverses it on its void date only if it was transferred", async () => {
    const lone: Settlement = {
      id: "s6", payee_type: "owner_operator", tractor_unit: "601", order_external_id: "o6", total_pay: "700.00", posted_pay: "700.00",
      is_void: true, accrual_key: "A6", accrued_at: "2026-07-08T00:00:00Z", post_key: "P6", transferred_at: "2026-07-10T00:00:00Z", void_date: "2026-07-20T00:00:00Z",
    };
    const reversed = await getFleetReport(recorder(GL_TOTALS, [], BILLS, [...SETTLEMENTS, lone]).client, ORG, "2026-07-01", "2026-07-31");
    expect(reversed.ownerOperatorBasis.pay).toBe(212_492.09);

    const untransferred = { ...lone, post_key: undefined, transferred_at: undefined };
    const kept = await getFleetReport(recorder(GL_TOTALS, [], BILLS, [...SETTLEMENTS, untransferred]).client, ORG, "2026-07-01", "2026-07-31");
    expect(kept.ownerOperatorBasis.pay).toBe(213_192.09);
  });

  /**
   * The contractor's load o1 re-billed the way this carrier re-bills (TRUCK-DRIVER-PNL-PLAN §1.3 D2,
   * Q-TP11): a credit memo reversing b1 in full, staged POSITIVE with the load's distance copied onto
   * it, then a new invoice at 203,000.00. The contractor and truck 601 keep the new figure, and 601
   * still ran two loads, not three.
   */
  it("takes a credit memo off the contractor and the truck, load included, so a re-billed load counts once", async () => {
    const credit = { id: "c1", order_external_id: "o1", tractor_unit: "601", total_charges: "203192.01", other_charge: "12345.67", post_key: "kc", post_module: "BILL", bill_date: "2026-07-22", delivery_date: "2026-07-08", distance: 71_920, canceled: false, bill_type: "C" };
    const rebill = { id: "r1", order_external_id: "o1", tractor_unit: "601", total_charges: "203000.00", other_charge: "12345.67", post_key: "kr", post_module: "BILL", bill_date: "2026-07-22", delivery_date: "2026-07-08", distance: 71_920, canceled: false, bill_type: "I" };
    const r = await getFleetReport(recorder(GL_TOTALS, [], [...BILLS, credit, rebill]).client, ORG, "2026-07-01", "2026-07-31");
    expect(r.ownerOperatorBasis.loadRevenue).toBe(203_000);
    const t601 = r.trucks.find((t) => t.tractor_unit === "601")!;
    expect(t601.revenue).toBe(403_000);
    expect(t601.loads).toBe(2);
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
