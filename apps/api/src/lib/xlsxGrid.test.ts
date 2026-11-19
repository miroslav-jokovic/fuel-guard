import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parsePilotPriceReport } from "@silvicom/shared";
import { readXlsxGrid } from "./xlsxGrid.js";

/** Pilot's emailed quote, rebuilt from the measured layout of pq-…-11192026.xlsx (2026-11-18). Prices are invented. */
async function pilotQuote(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Daily Price Quote - Better Of -");
  ws.addRow([]); // row 1 is blank in the real file
  ws.addRow(Array(5).fill("RETAIL PRICES ARE SUBJECT TO CHANGE AT ANY TIME").concat([null, null], Array(8).fill("Pilot Travel Centers LLC"), Array(5).fill("Retail Price @ 2026-11-18 08:24 PM")));
  ws.addRow(Array(5).fill("Account: 139445 - Silvicom Inc").concat(Array(3).fill("Price Source: OPIS Contract Avg."), Array(6).fill("Better Of Pricing Report"), [null], Array(5).fill("Effective Date: 11/19/2026 to 11/19/2026")));
  ws.addRow(["Site", "City", "ST", "Prod", "Rack ID", "Rack City", "Rack ST", "Cost", "Federal Tax/Fees", "State Tax/ Fees", "Sales Tax/ Fees", "Local Taxes", "Freight", "Pump Fee", "Other", "Total Cost", "Retail Price", "Disc Retail", "Your Price", "Savings Total"]);
  ws.addRow(["706", "Tulsa", "OK", "Truck Diesel", 560, "TULSA", "OK", 4.1, 0.25, 0.2, 0, 0, 0.08, -0.04, 0, 4.59, 5.5, 5.45, 4.59, 0.91]);
  ws.addRow(["652", "Lebanon", "IN", "Truck Diesel", 375, "INDIANAPOLIS", "IN", 4.2, 0.25, 0.64, 0, 0, 0.06, -0.04, 0, 5.11, 6.4, 6.35, 5.11, 1.29]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("readXlsxGrid", () => {
  it("hands parsePilotPriceReport the emailed quote in the shape it loads — date, account, every Truck Diesel row", async () => {
    const parsed = parsePilotPriceReport(await readXlsxGrid(await pilotQuote()));
    expect(parsed.headerFound).toBe(true);
    expect(parsed.effectiveDate).toBe("2026-11-19");
    expect(parsed.skipped).toBe(0);
    expect(parsed.rows.map((r) => [r.site, r.product, r.postedPrice, r.netPrice])).toEqual([
      ["706", "diesel", 5.5, 4.59],
      ["652", "diesel", 6.4, 5.11],
    ]);
  });

  it("keeps the blank first row, so row positions match the file", async () => {
    const grid = await readXlsxGrid(await pilotQuote());
    expect(grid[0]).toEqual([]);
    expect(grid[3]![0]).toBe("Site");
  });

  it("turns each ExcelJS cell kind into a scalar the way the browser decoder does", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow([
      { formula: "1+1", result: 2 },
      { richText: [{ text: "Truck " }, { text: "Diesel" }] },
      { text: "portal", hyperlink: "https://example.test" },
      new Date("2026-11-19T00:00:00Z"),
      true,
      null,
      "x",
    ]);
    const [row] = await readXlsxGrid(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(row).toEqual([2, "Truck Diesel", "portal", "2026-11-19T00:00:00.000Z", 1, null, "x"]);
  });

  it("refuses bytes that are not a workbook", async () => {
    await expect(readXlsxGrid(Buffer.from("PK not really a zip"))).rejects.toThrow();
  });
});
