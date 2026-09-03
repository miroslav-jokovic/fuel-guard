import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { getIncomeStatement } from "./incomeStatement.js";

const ORG = "11111111-1111-1111-1111-111111111111";

const ACCOUNTS = [
  { glid: "30000001", descr: "Gross Trucking Income", type_id: "Revenue" },
  { glid: "40050000", descr: "Fuel for Hired Vehicles", type_id: "Operating Expenses" },
  { glid: "42200000", descr: "Salaries & Wages", type_id: "General & Admin Expenses" },
  { glid: "17000000", descr: "Fuel Advance", type_id: "Current Assets" },
];

/** Three months, so the period column and the fiscal-year column can differ. */
const TOTALS = [
  { period_start: "2026-05-01", post_module: "BILL", glid: "30000001", line_count: 1200, net_amount: "-3000000.00", abs_amount: "3000000.00" },
  { period_start: "2026-05-01", post_module: "FUEL", glid: "40050000", line_count: 4000, net_amount: "800000.00", abs_amount: "800000.00" },
  { period_start: "2026-06-01", post_module: "BILL", glid: "30000001", line_count: 1300, net_amount: "-4000000.00", abs_amount: "4000000.00" },
  { period_start: "2026-06-01", post_module: "FUEL", glid: "40050000", line_count: 4500, net_amount: "900000.00", abs_amount: "900000.00" },
  { period_start: "2026-07-01", post_module: "BILL", glid: "30000001", line_count: 1400, net_amount: "-4491402.50", abs_amount: "4491402.50" },
  { period_start: "2026-07-01", post_module: "FUEL", glid: "40050000", line_count: 5777, net_amount: "971820.62", abs_amount: "971820.62" },
  { period_start: "2026-07-01", post_module: "RJ", glid: "42200000", line_count: 4, net_amount: "70750.00", abs_amount: "70750.00" },
  // Balance sheet in the same month — the statement must not see it.
  { period_start: "2026-07-01", post_module: "FUEL", glid: "17000000", line_count: 200, net_amount: "51622.07", abs_amount: "51622.07" },
];

const recorder = () =>
  createSupabaseRecorder({ tables: { mcleod_gl_totals: TOTALS, mcleod_gl_accounts: ACCOUNTS } });

describe("getIncomeStatement", () => {
  it("reports the asked-for month and the fiscal year to it, org-scoped", async () => {
    const rec = recorder();
    const s = await getIncomeStatement(rec.client, ORG, "2026-07-01", "2026-07-31");

    expect(s.revenue).toBe(4_491_402.5);
    expect(s.expenses).toBe(1_042_570.62);
    expect(s.net).toBe(3_448_831.88);

    // Year to date is January through July — here, the three staged months.
    expect(s.toDateRevenue).toBe(11_491_402.5);
    expect(s.toDateExpenses).toBe(2_742_570.62);
    expect(s.toDateFrom).toBe("2026-01-01");

    expectOrgScoped(rec, ORG);
  });

  it("widens a part-month window to the whole month, because GL totals are month-grained", async () => {
    const rec = recorder();
    const s = await getIncomeStatement(rec.client, ORG, "2026-07-14", "2026-07-20");
    // The same figures as the whole month: no proration, and the caller is told what it got.
    expect(s.revenue).toBe(4_491_402.5);
    expect(s.monthsCovered).toEqual(["2026-07"]);
    expect(s.monthsMissing).toEqual([]);
  });

  it("covers every calendar month a window touches", async () => {
    const rec = recorder();
    const s = await getIncomeStatement(rec.client, ORG, "2026-06-20", "2026-07-05");
    expect(s.monthsCovered).toEqual(["2026-06", "2026-07"]);
    expect(s.revenue).toBe(8_491_402.5);
  });

  it("names a month the sweep has not reached instead of silently omitting it", async () => {
    const rec = recorder();
    const s = await getIncomeStatement(rec.client, ORG, "2026-07-01", "2026-09-15");
    expect(s.monthsCovered).toEqual(["2026-07"]);
    expect(s.monthsMissing).toEqual(["2026-08", "2026-09"]);
  });

  it("leaves balance-sheet accounts out of the statement entirely", async () => {
    const rec = recorder();
    const s = await getIncomeStatement(rec.client, ORG, "2026-07-01", "2026-07-31");
    const glids = s.sections.flatMap((sec) => sec.lines.map((l) => l.glid));
    expect(glids).not.toContain("17000000");
    expect(s.unrecognisedNet).toBe(0);
  });

  it("anchors the to-date column on the period's last month when a window crosses a year", async () => {
    const rec = recorder();
    const s = await getIncomeStatement(rec.client, ORG, "2025-12-01", "2026-07-31");
    // The window itself starts before the fiscal year, so the read starts where the window does.
    expect(s.toDateFrom).toBe("2025-12-01");
    expect(s.monthsCovered).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(s.monthsMissing).toContain("2025-12");
  });
});
