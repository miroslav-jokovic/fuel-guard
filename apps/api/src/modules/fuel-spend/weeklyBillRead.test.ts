import ExcelJS from "exceljs";
import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { readWeeklyBill } from "./weeklyBillRead.js";
import { weeklyBillWorkbook } from "./weeklyBillWorkbook.js";

/**
 * Reading a recorded weekly bill back in the old columns (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §3).
 * The arithmetic is `weeklyBillReport.test.ts`'s; this pins what the reader feeds it — the recorded lines,
 * Pilot's quote for the same station and day, every query scoped to the org — and that the workbook carries
 * the old statement's columns in their order.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const STMT = "5e0f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a7b";

const line = (o: Record<string, unknown>) => ({
  line_number: 1, product_code: "020", tank_type: "tractor", tran_date: "2026-11-18", card_ref: "111111",
  unit_number: "700", po_name: null, auth_no: null, ticket_no: "T1", odometer: 1000, site_number: "4599",
  city: "Monteagle", state: "TN", station_id: "st-4599", pilot_vehicle_id: "530001", pilot_driver_id: "1234",
  gallons: 151.37, unit_cost: null, fuel_amount: 765.07, misc_amount: null, sales_tax: 0, invoice_total: 765.07,
  retail_total: 896.11, ...o,
});

function seed(statement: unknown = {
  id: STMT, invoice_no: "INV-59656", account_no: "139445", period_start: "2026-11-16", period_end: "2026-11-23",
  billing_date: "2026-11-23", source_filename: "Standard_Invoice_Gen_Template_INV-59656.pdf",
  printed_amount: 796.86, printed_retail: null, printed_savings: null, superseded_by: null,
}): SupabaseRecorder {
  return createSupabaseRecorder({
    tables: {
      fuel_statements: { data: statement },
      fuel_statement_lines: {
        pages: [[
          line({}),
          line({ line_number: 2, product_code: null, tank_type: "none", gallons: 0, fuel_amount: null, misc_amount: 29.99, invoice_total: 29.99, retail_total: 29.99 }),
          line({ line_number: 3, product_code: null, tank_type: "none", gallons: 0, fuel_amount: null, sales_tax: 1.8, invoice_total: 1.8, retail_total: 1.8 }),
        ]],
      },
      // Quoted the day before the fill — inside the one-day window D-FC4 allows.
      fuel_prices: { pages: [[{ station_id: "st-4599", posted_price: 6.0, net_price: 4.922, observed_at: "2026-11-17T12:00:00Z" }]] },
    },
  });
}

describe("readWeeklyBill", () => {
  it("rebuilds the recorded lines with that station's quote, folding the ticket's items onto its fuel line", async () => {
    const rec = seed();
    const r = await readWeeklyBill(rec.client, ORG, STMT);
    if (!r.ok) throw new Error("expected a bill");
    expect(r.statement).toMatchObject({ invoiceNo: "INV-59656", periodStart: "2026-11-16", printed: { amount: 796.86, savings: null } });
    expect(r.report.rows).toHaveLength(1);
    expect(r.report.rows[0]).toMatchObject({
      lines: [1, 2, 3], misc: 29.99, tax: 1.8, invoiceTotal: 796.86, vehicleId: "530001", driverId: "1234",
      fuelCost: 5.0543, quotedPrice: 4.922, overQuoteUsd: 20.03,
    });
    expect(r.report.totals.invoiceTotal).toBe(796.86);
  });

  it("asks for quotes only for the bill's own stations, diesel, over the bill's window", async () => {
    const rec = seed();
    await readWeeklyBill(rec.client, ORG, STMT);
    const q = rec.queries.find((x) => x.table === "fuel_prices")!;
    expect(q.filters()).toEqual(expect.arrayContaining([
      { col: "org_id", val: ORG }, { col: "product", val: "diesel" }, { col: "station_id", val: ["st-4599"] },
    ]));
  });

  it("answers not-found for a statement that is not this org's", async () => {
    const r = await readWeeklyBill(seed(null).client, ORG, STMT);
    expect(r).toEqual({ ok: false, notFound: true });
  });

  it("scopes every query to the org — the service role bypasses RLS, so the filter IS the boundary", async () => {
    const rec = seed();
    await readWeeklyBill(rec.client, ORG, STMT);
    expectOrgScoped(rec, ORG);
  });
});

describe("weeklyBillWorkbook", () => {
  it("lays the bill out in the old statement's 21 columns, in order, then the IDs and the quote check", async () => {
    const r = await readWeeklyBill(seed().client, ORG, STMT);
    if (!r.ok) throw new Error("expected a bill");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await weeklyBillWorkbook(r.statement, r.report)) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Statement")!;
    const head = (ws.getRow(5).values as unknown[]).slice(1);
    expect(head.slice(0, 21)).toEqual([
      "Card Number", "Unit Number", "Loc.", "City", "State", "Ticket Number", "AUTH. Number", "P.O. Number",
      "Tran Date", "Odometer Reading", "Prod", "Units", "Fuel Cost", "Amount", "Qts", "Oil Amount", "Cash Advance",
      "Misc./Disc.", "Sales Tax", "Invoice Total", "Retail Total",
    ]);
    expect(head.slice(21)).toEqual(["Savings", "Vehicle ID", "Driver ID", "Pilot quote (Your Price)", "Billed − quote $/gal", "Billed − quote $"]);
    const total = ws.getRow(7);
    expect(total.getCell(1).value).toBe("** Customer Total");
    expect((total.getCell(20).value as { result: number }).result).toBe(796.86);
    expect(wb.getWorksheet("Totals")).toBeDefined();
  });
});
