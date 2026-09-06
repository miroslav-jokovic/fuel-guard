import { describe, it, expect } from "vitest";
import { buildIncomeStatement, type LedgerAccount, type LedgerTotalRow } from "./incomeStatement.js";

/**
 * Fixtures are real staged rows, not invented ones (FINANCE-FLEET-REPORT-PLAN §2.5): a subset of
 * production `mcleod_gl_totals` for 2026-07, chosen to carry every shape the statement has to
 * survive — an account posting through several modules, two accounts sharing a truncated
 * description, a contra balance, a balance-sheet class that must be excluded, and a class the
 * section order does not know.
 */
const ACCOUNTS: LedgerAccount[] = [
  { glid: "30000001", descr: "Gross Trucking Income", type_id: "Revenue" },
  { glid: "30000002", descr: "Gross Trucking Income", type_id: "Revenue" },
  { glid: "30220000", descr: "DEF", type_id: "Operating Expenses" },
  { glid: "40000001", descr: "Subcontracted Labor: Driver", type_id: "Operating Expenses" },
  { glid: "40050000", descr: "Fuel for Hired Vehicles", type_id: "Operating Expenses" },
  { glid: "40200000", descr: "Business Licenses and Permit", type_id: "Operating Expenses" },
  { glid: "42200000", descr: "Salaries & Wages", type_id: "General & Admin Expenses" },
  { glid: "40790002", descr: "Tolls OO", type_id: "Income Tax Expense" },
  { glid: "17000000", descr: "Fuel Advance", type_id: "Current Assets" },
  { glid: "45000000", descr: "Theft", type_id: "Other Expenses and Losses" },
  { glid: "99999999", descr: "Something New", type_id: "Suspense" },
];

/** July 2026, as production holds it — revenue credit-signed, expenses debit-signed. */
const JULY: LedgerTotalRow[] = [
  { glid: "30000001", post_module: "BILL", net_amount: -4_491_402.5, line_count: 1400 },
  { glid: "30000002", post_module: "BILL", net_amount: -214_524.43, line_count: 120 },
  { glid: "30220000", post_module: "FUEL", net_amount: 45_576.84, line_count: 1337 },
  // One account, four modules — the shape that makes a drill-down worth having.
  { glid: "40000001", post_module: "SET", net_amount: 1_129_648.14, line_count: 2581 },
  { glid: "40000001", post_module: "DRS", net_amount: 42_305.64, line_count: 129 },
  { glid: "40000001", post_module: "DED", net_amount: 6_850.0, line_count: 80 },
  { glid: "40000001", post_module: "SETV", net_amount: -47_338.0, line_count: 46 },
  { glid: "40050000", post_module: "FUEL", net_amount: 971_820.62, line_count: 5777 },
  // A refund. It stays negative, because it is.
  { glid: "40200000", post_module: "AP", net_amount: -3_193.93, line_count: 4 },
  { glid: "42200000", post_module: "RJ", net_amount: 70_750.0, line_count: 4 },
  { glid: "40790002", post_module: "GJ", net_amount: 0.0, line_count: 1 },
  // Balance sheet — must not reach the statement at all.
  { glid: "17000000", post_module: "FUEL", net_amount: 51_622.07, line_count: 200 },
];

const build = (period = JULY, toDate?: LedgerTotalRow[]) =>
  buildIncomeStatement({ period, toDate, accounts: ACCOUNTS });

describe("buildIncomeStatement", () => {
  it("flips revenue once so every figure reads positive-is-more, and nets to the ledger", () => {
    const s = build();
    expect(s.revenue).toBe(4_705_926.93);
    expect(s.expenses).toBe(2_216_419.31);
    expect(s.net).toBe(2_489_507.62);
  });

  it("excludes balance-sheet classes — a fuel advance is a receivable, never an expense", () => {
    const s = build();
    const glids = s.sections.flatMap((sec) => sec.lines.map((l) => l.glid));
    expect(glids).not.toContain("17000000");
    // And the exclusion is silent by design: a balance-sheet row is expected, not anomalous.
    expect(s.unrecognisedNet).toBe(0);
  });

  it("reports a class it does not recognise instead of dropping its dollars", () => {
    const rows = [...JULY, { glid: "99999999", post_module: "GJ", net_amount: 1_234.56, line_count: 2 }];
    const s = build(rows);
    expect(s.unrecognisedNet).toBe(1_234.56);
    const section = s.sections.find((x) => x.typeId === "Suspense");
    expect(section?.isUnrecognised).toBe(true);
    expect(section?.total).toBe(1_234.56);
    // The dollars are shown and are NOT absorbed into either total.
    expect(s.expenses).toBe(2_216_419.31);
    expect(s.revenue).toBe(4_705_926.93);
  });

  it("orders sections as the printed statement does and accounts by code inside each", () => {
    const s = build();
    expect(s.sections.map((x) => x.typeId)).toEqual([
      "Revenue",
      "Operating Expenses",
      "General & Admin Expenses",
      "Income Tax Expense",
    ]);
    const operating = s.sections.find((x) => x.typeId === "Operating Expenses");
    expect(operating?.lines.map((l) => l.glid)).toEqual([
      "30220000",
      "40000001",
      "40050000",
      "40200000",
    ]);
  });

  it("keeps two accounts that share a truncated description apart by code", () => {
    const s = build();
    const revenue = s.sections.find((x) => x.isRevenue);
    expect(revenue?.lines.map((l) => l.descr)).toEqual([
      "Gross Trucking Income",
      "Gross Trucking Income",
    ]);
    expect(revenue?.lines.map((l) => l.glid)).toEqual(["30000001", "30000002"]);
    expect(revenue?.lines[0]?.amount).not.toBe(revenue?.lines[1]?.amount);
  });

  it("sums an account's modules to its line and lists them biggest first", () => {
    const s = build();
    const pay = s.sections
      .find((x) => x.typeId === "Operating Expenses")
      ?.lines.find((l) => l.glid === "40000001");
    expect(pay?.amount).toBe(1_131_465.78);
    expect(pay?.modules.map((m) => m.post_module)).toEqual(["SET", "SETV", "DRS", "DED"]);
    expect(pay?.modules.reduce((n, m) => n + m.amount, 0)).toBeCloseTo(1_131_465.78, 2);
    expect(pay?.modules.reduce((n, m) => n + m.lines, 0)).toBe(2836);
  });

  it("keeps a contra balance negative — a refund reduces cost, it is not an absolute", () => {
    const s = build();
    const permits = s.sections
      .find((x) => x.typeId === "Operating Expenses")
      ?.lines.find((l) => l.glid === "40200000");
    expect(permits?.amount).toBe(-3_193.93);
  });

  it("expresses each line as a share of the period's own revenue", () => {
    const s = build();
    const fuel = s.sections
      .find((x) => x.typeId === "Operating Expenses")
      ?.lines.find((l) => l.glid === "40050000");
    expect(fuel?.pctOfRevenue).toBe(20.7);
  });

  it("returns null shares rather than zero when the period booked no revenue", () => {
    const noRevenue = JULY.filter((r) => !r.glid.startsWith("3000000"));
    const s = build(noRevenue);
    expect(s.revenue).toBe(0);
    for (const section of s.sections) {
      for (const line of section.lines) expect(line.pctOfRevenue).toBeNull();
    }
  });

  it("omits the to-date column entirely when no wider period is supplied", () => {
    const s = build();
    expect(s.toDateRevenue).toBeNull();
    expect(s.toDateNet).toBeNull();
    for (const section of s.sections) {
      expect(section.toDateTotal).toBeNull();
      for (const line of section.lines) expect(line.toDateAmount).toBeNull();
    }
  });

  it("shows an account that posted only in the wider period, instead of dropping it", () => {
    const wider: LedgerTotalRow[] = [
      ...JULY,
      { glid: "45000000", post_module: "GJ", net_amount: 9_000.0, line_count: 1 },
    ];
    const s = build(JULY, wider);
    const losses = s.sections.find((x) => x.typeId === "Other Expenses and Losses");
    expect(losses?.lines[0]?.glid).toBe("45000000");
    expect(losses?.lines[0]?.amount).toBe(0);
    expect(losses?.lines[0]?.toDateAmount).toBe(9_000);
    expect(s.toDateExpenses).toBe(2_225_419.31);
  });

  it("divides the to-date column by to-date revenue, not by the period's", () => {
    const wider = [...JULY, ...JULY]; // the same month twice: every figure doubles
    const s = build(JULY, wider);
    expect(s.toDateRevenue).toBe(9_411_853.86);
    const fuel = s.sections
      .find((x) => x.typeId === "Operating Expenses")
      ?.lines.find((l) => l.glid === "40050000");
    expect(fuel?.toDateAmount).toBe(1_943_641.24);
    expect(fuel?.toDatePctOfRevenue).toBe(20.7);
  });
});
