/**
 * One entry point for every shape of Pilot fuel report, so the page never asks the user what kind of
 * file they have.
 *
 * Two documents carry the same facts in different containers:
 *   • the WEEKLY direct-bill statement — a positioned-text PDF (`StatementDBS_US`)
 *   • the MONTHLY "All Transactions" export — .xlsx / .csv / an HTML table named .xls
 *
 * Both normalise to the same `LoadedReport`, so everything downstream (matching, the tables, the
 * summary tiles) is format-blind. The format is decided by MAGIC BYTES, never the extension.
 */
import {
  parsePilotFuelReport,
  parsePilotStatement,
  type PilotReportFill,
  type StatementLine,
  type StatementTieOut,
  type StatementWord,
} from "@silvicom/shared";
import { readReportGrid } from "@/lib/reportGrid";
import { looksLikePdf, readPdfWords } from "@/lib/pdfWords";

export type ReportKind = "weekly_statement" | "monthly_export";

export interface LoadedReport {
  kind: ReportKind;
  fileName: string;
  account: string | null;
  /** Present on the weekly statement only — the monthly export has no invoice number. */
  invoiceNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Tractor diesel — the reconciliation unit. */
  fills: PilotReportFill[];
  /** Reefer (dyed / off-road) diesel. Billed to us, but never matched against a tractor fill. */
  reeferLines: PilotReportFill[];
  defLines: PilotReportFill[];
  /** Non-fuel lines: in-store merchandise billed to the card. */
  merchandise: StatementLine[];
  totalGallons: number;
  totalNet: number;
  totalRetail: number;
  /** Only the weekly statement prints totals we can verify the parse against. */
  tieOut: StatementTieOut | null;
  lineCount: number;
  /** The decoded PDF, kept so the server can re-parse and record it. Absent for grid formats. */
  statementSource: { words: StatementWord[]; bytes: ArrayBuffer } | null;
}

/** Thrown when a file decodes but is not a Pilot report we recognise, or fails its own arithmetic. */
export class ReportLoadError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = "ReportLoadError";
  }
}

export async function loadFuelReport(file: File): Promise<LoadedReport> {
  const buf = await file.arrayBuffer();
  return looksLikePdf(buf) ? await loadStatementPdf(buf, file.name) : await loadExportGrid(buf, file.name);
}

async function loadStatementPdf(buf: ArrayBuffer, fileName: string): Promise<LoadedReport> {
  const words = await readPdfWords(buf);
  const parsed = parsePilotStatement(words);
  if (!parsed.headerFound) {
    throw new ReportLoadError(
      "That PDF isn't a Pilot statement",
      "We couldn't find the transaction table. Upload the weekly direct-bill statement from Pilot Receivables.",
    );
  }
  // The statement checks its own arithmetic; if we can't reproduce it, we have mis-read a column and
  // must not pretend otherwise on a quarter-million dollars of fuel.
  if (!parsed.tieOut.ok) {
    throw new ReportLoadError("That statement didn't add up", parsed.tieOut.failures.join(" "));
  }
  return {
    kind: "weekly_statement",
    fileName,
    account: parsed.account,
    invoiceNumber: parsed.invoiceNumber,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    fills: parsed.fills,
    reeferLines: parsed.reeferLines,
    defLines: parsed.defLines,
    merchandise: parsed.merchandise,
    totalGallons: parsed.fills.reduce((a, f) => a + f.gallons, 0),
    totalNet: parsed.fills.reduce((a, f) => a + (f.netAmount ?? 0), 0),
    totalRetail: parsed.fills.reduce((a, f) => a + (f.retailAmount ?? 0), 0),
    tieOut: parsed.tieOut,
    lineCount: parsed.lines.length,
    statementSource: { words, bytes: buf },
  };
}

async function loadExportGrid(buf: ArrayBuffer, fileName: string): Promise<LoadedReport> {
  const parsed = parsePilotFuelReport(await readReportGrid(buf));
  if (!parsed.headerFound) {
    throw new ReportLoadError(
      "Unrecognised report",
      "Expected a Pilot weekly statement (PDF), or the monthly “All Transactions” export with Authorization_No, Card_No and Quantity columns.",
    );
  }
  return {
    kind: "monthly_export",
    fileName,
    account: parsed.account,
    invoiceNumber: null,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    fills: parsed.fills,
    // The export separates reefer since F4. It used to arrive here as `[]` because the parser's
    // description rule could not recognise the word "Reefer", so 120 real fills in the 2026-06/07
    // export were dropped into `other` and the screen then reported "0 reefer".
    reeferLines: parsed.reeferLines,
    defLines: parsed.defLines,
    merchandise: [],
    totalGallons: parsed.totalDieselGallons,
    totalNet: parsed.totalDieselNet,
    totalRetail: parsed.totalDieselRetail,
    tieOut: null,
    lineCount: parsed.fills.length + parsed.defLines.length + parsed.other.length,
    statementSource: null,
  };
}
