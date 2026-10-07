import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { metersFromMiles } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { pdfDrawnLines, pdfText } from "../../testing/pdfText.js";
import { readIftaReturn } from "./returnReads.js";
import { iftaReturnWorkbook } from "./returnWorkbook.js";
import { iftaReturnPdf } from "./returnPdf.js";

/**
 * One quarter's IFTA return export (IP9), read through the recorder and rendered both ways. The
 * property that matters: every total in the workbook is the figure on the return tab, the fuel tab is
 * exactly the fills listed, and a receipt the duplicate rule dropped is on "Needs a look" rather than
 * gone. The arithmetic is `buildIftaReturnReport`'s and is tested in `@silvicom/shared`.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const V101 = "5a1b2c3d-4e5f-4a6b-8c7d-000000000101";
const V512 = "5a1b2c3d-4e5f-4a6b-8c7d-000000000512";
const VEHICLES = [
  { id: V101, unit_number: "101", mcleod_tractor_id: "101" },
  { id: V512, unit_number: "512", mcleod_tractor_id: "512" },
];
const META = { orgName: "Test Carrier LLC", generatedAt: "2026-10-07T18:00:00.000Z" };

const opsOf = (q: RecordedQuery) => q.ops.map((o) => [o.method, ...o.args] as unknown[]);
const inList = (q: RecordedQuery, col: string) => opsOf(q).find((o) => o[0] === "in" && o[1] === col)?.[2] as string[] | undefined;

const mi = (vehicle_id: string, jurisdiction: string, period_month: number, miles: number) => ({
  vehicle_id, jurisdiction, period_month, taxable_meters: metersFromMiles(miles), total_meters: metersFromMiles(miles + 10),
});
const fill = (id: string, vehicle_id: string | null, state: string, gallons: number, business_date = "2026-08-02") => ({
  id, vehicle_id, state, gallons, business_date, fueled_at: `${business_date}T15:00:00Z`,
  price_per_gal: 3.5, total_cost: Math.round(gallons * 350) / 100, location_text: "Pilot #1", tank_type: "tractor",
});

function recorder(ledgerTxGallons = 420) {
  return createSupabaseRecorder({
    tables: {
      // 101 in Texas across two months (summed); 512's Oklahoma miles on two devices (summed).
      samsara_ifta_jurisdiction_miles: [
        mi(V101, "TX", 7, 2_000), mi(V101, "TX", 8, 1_000.4), mi(V101, "OK", 8, 500.3),
        mi(V512, "OK", 8, 700), mi(V512, "OK", 9, 700.3),
      ],
      fuel_transactions: [
        fill("f1", V101, "TX", 400), fill("f2", V101, "OK", 100.25), fill("f3", null, "TX", 20),
        fill("f4", V512, "OK", 100.3, "2026-08-03"),
      ],
      // u1 is f4 again (dropped); u2 is a fill the card never saw (kept).
      ifta_fuel_receipts: [
        { id: "u1", vehicle_id: V512, jurisdiction: "OK", fueled_on: "2026-08-03", gallons: 100, price_per_gal: null, amount_paid: null, station: "OnCue", city: "Yukon", unit_as_filed: null, ifta_fuel_receipt_uploads: { format: "fuel_app_csv" } },
        { id: "u2", vehicle_id: V512, jurisdiction: "OK", fueled_on: "2026-08-10", gallons: 120, price_per_gal: 3.4, amount_paid: 408, station: "OnCue", city: "Yukon", unit_as_filed: null, ifta_fuel_receipt_uploads: { format: "fuel_app_csv" } },
      ],
      // m1 is u2 keyed again in McLeod (dropped: the upload ranks first); m2 names a unit we do not have.
      mcleod_fuel_tax_receipts: [
        { external_id: "m1", tractor_unit: "512", jurisdiction: "OK", receipt_date: "2026-08-10", gallons: 120, processed_at: null },
        { external_id: "m2", tractor_unit: "999", jurisdiction: "AR", receipt_date: "2026-08-12", gallons: 50, processed_at: null },
      ],
      vehicles: (q) => {
        for (const col of ["id", "mcleod_tractor_id", "unit_number"] as const) {
          const list = inList(q, col);
          if (list) return VEHICLES.filter((v) => list.includes(v[col]));
        }
        return [];
      },
      organizations: [{ name: "Test Carrier LLC" }],
    },
    rpc: {
      ifta_period_jurisdictions: [
        { jurisdiction: "TX", taxable_meters: metersFromMiles(3_000.4), total_meters: metersFromMiles(3_020.4), tax_paid_liters: 0, purchased_gallons: ledgerTxGallons },
        { jurisdiction: "OK", taxable_meters: metersFromMiles(1_900.6), total_meters: metersFromMiles(1_930.6), tax_paid_liters: 0, purchased_gallons: 200.55 },
      ],
      ifta_period_summary: [{}],
    },
  });
}

const read = (rec: ReturnType<typeof recorder>) => readIftaReturn(rec.client as unknown as SupabaseClient, ORG, 2026, 3);

async function workbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}
/** A cell's value, or a formula cell's cached result. */
function val(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  return v && typeof v === "object" && "formula" in (v as object) ? (v as { result: unknown }).result : v;
}
function rowOf(ws: ExcelJS.Worksheet, first: string): ExcelJS.Row {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((r) => { if (r.getCell(1).value === first) found = r; });
  if (!found) throw new Error(`no row "${first}" on ${ws.name}`);
  return found;
}
function byHeader(ws: ExcelJS.Worksheet, headerRow: number, row: ExcelJS.Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  ws.getRow(headerRow).eachCell((c, i) => { out[String(c.value)] = val(row.getCell(i)); });
  return out;
}

describe("the IFTA return export", () => {
  it("reads one org's quarter, folds the receipts, and ties to the IFTA page", async () => {
    const rec = recorder();
    const { report, orgName } = await read(rec);
    expect(orgName).toBe("Test Carrier LLC");
    expect(report.trucks.map((t) => t.truck)).toEqual(["101", "512", "No truck"]);
    expect(report.fills.map((f) => f.id)).toEqual(["f1", "f2", "f4", "receipt:fuel_app:u2", "f3", "receipt:mcleod:m2"]);
    expect(report.issues.map((i) => [i.kind, i.truck])).toEqual([
      ["fuel_without_truck", "No truck"],
      ["fuel_without_truck", "No truck (unit 999 as filed)"],
      ["duplicate_dropped", "512"],
      ["duplicate_dropped", "512"],
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("lists a state where the page shows different gallons", async () => {
    const { report } = await read(recorder(430));
    expect(report.issues.filter((i) => i.kind === "ledger_disagrees").map((i) => i.jurisdiction)).toEqual(["TX"]);
  });

  it("writes five tabs whose totals are the return's own figures", async () => {
    const { report } = await read(recorder());
    const wb = await workbook(await iftaReturnWorkbook(report, META));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Return by state", "Miles by truck", "Fuel by truck", "Every fill", "Needs a look"]);

    const ret = wb.getWorksheet("Return by state")!;
    const headerAt = rowOf(ret, "State").number;
    const line = (code: string) => byHeader(ret, headerAt, rowOf(ret, code));
    expect(line("OK")).toMatchObject({ "Taxable miles": 1_901, "Gallons bought": 320.6, "of which driver-paid": 120 });
    expect(line("AR")).toMatchObject({ "Taxable miles": 0, "Gallons bought": 50 });

    const miles = wb.getWorksheet("Miles by truck")!;
    const milesTotal = byHeader(miles, 1, rowOf(miles, "Total"));
    expect(Math.round(milesTotal.OK as number)).toBe(1_901);
    expect(Math.round(milesTotal.TX as number)).toBe(3_000);
    expect(Math.round(milesTotal["Taxable miles"] as number)).toBe(4_901);
    expect((miles.getRow(rowOf(miles, "Total").number).getCell(2).value as ExcelJS.CellFormulaValue).formula).toBe("SUM(B2:B4)");

    const fuel = wb.getWorksheet("Fuel by truck")!;
    const fuelTotal = byHeader(fuel, 1, rowOf(fuel, "Total"));
    expect(fuelTotal).toMatchObject({ AR: 50, TX: 420 });
    expect(fuelTotal.OK as number).toBeCloseTo(320.55, 9);
    expect(byHeader(fuel, 1, rowOf(fuel, "101")).MPG as number).toBeCloseTo(3_500.7 / 500.25, 9);

    const fills = wb.getWorksheet("Every fill")!;
    expect(fills.rowCount).toBe(1 + report.fills.length + 1);
    expect(val(rowOf(fills, "Total").getCell(4)) as number).toBeCloseTo(fuelTotal["Gallons bought"] as number, 9);
    expect(rowOf(fills, "101").getCell(2).value).toEqual(new Date("2026-08-02T00:00:00Z"));

    const look = wb.getWorksheet("Needs a look")!;
    expect(look.getColumn(1).values.filter((v) => v === "Duplicate not counted")).toHaveLength(2);
  });

  it("prints the return, what needs a look, and a block per truck, with page numbers", async () => {
    const { report } = await read(recorder());
    const { pdf, pages } = await iftaReturnPdf(report, META);
    const text = await pdfText(pdf);
    for (const s of ["IFTA return, Q3 2026", "Return by state", "Needs a look before filing (4)", "Unit 101", "Unit 512", "No truck", "Oklahoma", `page ${pages} of ${pages}`]) {
      expect(text).toContain(s);
    }
    expect(pages).toBeGreaterThanOrEqual(2);
    // One block per truck, the no-truck fuel included: its gallons are in the return too.
    const blockHeads = (await pdfDrawnLines(pdf)).filter((l) => l.size === 10.5).map((l) => l.text);
    expect(blockHeads).toEqual(["Unit 101", "Unit 512", "No truck"]);
  });
});
