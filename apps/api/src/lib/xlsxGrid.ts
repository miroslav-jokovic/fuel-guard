import ExcelJS from "exceljs";

/**
 * A real `.xlsx` → the raw cell grid the shared report parsers take, on the SERVER.
 *
 * The same conversion as the browser's `apps/web/src/lib/reportGrid.ts` (`cellToScalar` + `sheetToGrid`), so
 * a Pilot quote the API fetches from the mailbox reaches `parsePilotPriceReport` in exactly the shape a manual
 * upload of the same file does (PILOT-PRICE-MAIL-PLAN §3). The browser keeps its own copy because it runs in
 * a different bundle; the two are held together by the test "turns each ExcelJS cell kind into a scalar the way
 * the browser decoder does".
 * Only modern OOXML: Pilot's emailed quote is one (measured 2026-11-18); the legacy `.xls` decoder stays
 * browser-only until a server reader needs it.
 */
export type Cell = string | number | null;

function cellToScalar(v: ExcelJS.CellValue | undefined): Cell {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("result" in v) {
      const r = (v as { result?: ExcelJS.CellValue }).result;
      return typeof r === "number" || typeof r === "string" ? r : null;
    }
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((rt) => rt.text).join("");
    if ("text" in v) return String((v as ExcelJS.CellHyperlinkValue).text);
  }
  return null;
}

/** First worksheet as rows of scalars, blank rows kept so row positions match the file. */
export async function readXlsxGrid(bytes: Buffer): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The workbook has no sheets.");
  const grid: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const raw = (row.values as (ExcelJS.CellValue | undefined)[]).slice(1);
    // `Array.from`, not `.map`: ExcelJS leaves a hole for an empty cell between filled ones, and `.map` keeps
    // the hole. The browser's grid crosses the wire as JSON, which writes every hole as `null` — so `null` is
    // what `ingestPilotPrices` receives from a manual upload, and what it receives from here.
    grid.push(Array.from(raw, cellToScalar));
  });
  return grid;
}
