import { describe, expect, it } from "vitest";
import { readFile } from "./readFile";

/**
 * The EFS import's reader across every spreadsheet format an office can hand it (TOLLS-PER-TRUCK-PLAN
 * TL3). It used to send any `.xls` to ExcelJS, which reads only real `.xlsx`, so a genuine Excel
 * 97-2003 file failed with a message about a zip.
 *
 * ⚠ The workbooks are written by SheetJS, not by EFS: this proves each decode path reaches the same
 * rows, not that a particular EFS export's quirks parse.
 */

const ROWS = [
  ["EFS Transaction Report"],
  ["Card #", "Tran Date", "Invoice", "Unit", "Item", "Qty", "Amt"],
  ["7083051234", "2026-06-05", "INV-1", "654", "ULSD", 120.5, 512.13],
];

async function workbook(bookType: "xls" | "ods" | "xlsx"): Promise<ArrayBuffer> {
  const XLSX = (await import("@vendor/sheetjs/xlsx.mjs")) as unknown as {
    utils: { aoa_to_sheet(a: unknown[][]): unknown; book_new(): unknown; book_append_sheet(wb: unknown, ws: unknown, n: string): void };
    write(wb: unknown, o: { bookType: string; type: string }): ArrayBuffer;
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ROWS), "Sheet1");
  return XLSX.write(wb, { bookType, type: "array" });
}

/** A File whose `arrayBuffer()` hands back exactly these bytes, whatever jsdom's File does. */
function fileOf(name: string, buf: ArrayBuffer): File {
  const f = new File([new Uint8Array(buf)], name);
  Object.defineProperty(f, "arrayBuffer", { value: async () => buf });
  return f;
}

describe("readFile across spreadsheet formats", () => {
  for (const [label, bookType, name] of [
    ["a genuine Excel 97-2003 .xls", "xls", "efs.xls"],
    ["a Google Sheets / LibreOffice .ods", "ods", "efs.ods"],
    ["a modern .xlsx", "xlsx", "efs.xlsx"],
  ] as const) {
    it(`reads ${label} to the same header and row`, async () => {
      const parsed = await readFile(fileOf(name, await workbook(bookType)));
      expect(parsed.headers).toEqual(["Card #", "Tran Date", "Invoice", "Unit", "Item", "Qty", "Amt"]);
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.rows[0]?.["Unit"]).toBe("654");
      expect(Number(parsed.rows[0]?.["Amt"])).toBe(512.13);
    });
  }

  it("reads an HTML table saved with an .xls name", async () => {
    const html = `<html><body><table>${ROWS.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table></body></html>`;
    const bytes = new TextEncoder().encode(html);
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    const parsed = await readFile(fileOf("efs.xls", buf));
    expect(parsed.rows[0]?.["Invoice"]).toBe("INV-1");
  });
});
