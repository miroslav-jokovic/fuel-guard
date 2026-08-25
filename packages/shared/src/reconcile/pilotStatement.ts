/**
 * Pilot / Flying J WEEKLY direct-bill statement (`StatementDBS_US`) — pure parser.
 *
 * A different document from the monthly "All Transactions" export that `pilotFuelReport.ts` reads: this
 * is the billing statement Pilot Receivables mails every week, rendered by Microsoft Reporting Services
 * as a positioned-text PDF. There are no column headers in the spreadsheet sense — the layout is words at
 * (x, y). So the caller decodes the PDF to words at the UI edge (pdfjs in the browser, a fixture in
 * tests) and this module turns those words into statement lines. Pure + dataset-free, like every other
 * `reconcile/` module.
 *
 * WHY column bands rather than a text dump: `pdftotext -layout` interleaves wrapped city and driver-name
 * fragments into neighbouring columns, which silently corrupts `Units` and `Amount`. Binding each word to
 * a column by its x-position cannot do that.
 *
 * HOW columns are bound. The statement's SECOND header line is exactly 21 tokens naming every column in
 * order ("Number Number Loc. City State … Total Total"), which identifies the layout and locates the body
 * on each page. The header token positions are NOT usable as column boundaries, though: value alignment
 * differs from label alignment per column, most sharply for `P.O. Number`, whose values start ~25pt LEFT
 * of its header token and would otherwise bind into `AUTH. Number`. So the boundaries below are the
 * measured left edge of each column's VALUE region, taken from the five real statements, and the header
 * match is used to confirm the layout and to detect drift.
 *
 * What makes that safe is not the constants — it is `tieOutStatement`. A column bound one place off
 * cannot reproduce the statement's own printed `** Customer Total`, per-product `Customer Total`,
 * `Retail Total` and `Savings Total` to the cent, so a mis-parse is rejected rather than believed.
 * Verified across all 125 pages of the five 2026-07-20 → 2026-08-23 statements (invoices 790722856 /
 * 791794052 / 793170296 / 794335795 / 795506105): one stable layout, and money ties exactly on each.
 *
 * Product codes are NOT inferred: every statement prints its own legend on the summary page ("020 Truck
 * Diesel", "033 Reefer", "140 Diesel Exhaust Fluid", …), which this module parses and uses. The built-in
 * table below is only a fallback for a statement whose legend fails to parse, and it is cross-checked
 * against the printed legend on every upload so a divergence is reported rather than absorbed.
 * The table was independently confirmed against `efs_transactions.item` for the same week (020↔ULSD
 * 478/483 lines, 033↔ULSR 23/23, 140↔DEFD 342/342, 021↔DSL1 1/1). `033` is REEFER fuel — dyed, off-road —
 * which is why it must never be reconciled against tractor fills.
 */

import type { PilotReportFill, ReportProduct } from "./pilotFuelReport.js";
import { tieOutStatement } from "./pilotStatementTieOut.js";

/** One word from the decoded PDF, with its position on the page. Origin top-left, PDF points. */
export interface StatementWord {
  text: string;
  x: number; // left edge
  y: number; // top edge
  page: number; // 1-based
}

/** Which physical tank a statement line filled — mirrors `fuel_transactions.tank_type`. */
export type StatementTank = "tractor" | "reefer" | "none";

export interface StatementLine extends PilotReportFill {
  /** Pilot product code exactly as printed ("020", "021", "033", "140"), or null on a merchandise line. */
  productCode: string | null;
  tank: StatementTank;
  /** Posted price per unit from the `Fuel Cost` column — Pilot prints it to 4 dp. */
  unitCost: number | null;
  /** Odometer as keyed at the pump. An independent odometer source; drivers mistype it, so it is
   *  carried for cross-checking and never trusted as authoritative. */
  odometer: number | null;
  ticket: string | null;
  poNumber: string | null;
  /**
   * Non-fuel charges on the SAME ticket: the `Misc./Disc.` column (in-store merchandise) and `Sales Tax`.
   *
   * These are not confined to standalone merchandise lines — a fuel line can carry them too (2026-08-17
   * statement, p13: 170.5 gal of 020 with $10.98 misc + $0.99 tax on the same ticket). Missing that is
   * what made an early prototype's savings figure disagree with Pilot's printed `Savings Total` by
   * exactly the bundled amount, so `amount` and `invoiceTotal` are kept strictly separate below.
   */
  miscAmount: number | null;
  salesTax: number | null;
  /**
   * What Pilot actually bills for this line = fuel `amount` + `miscAmount` + `salesTax`.
   * `netAmount` (inherited from PilotReportFill) stays FUEL-ONLY, because that is what
   * `fuel_transactions.total_cost` holds and therefore what the reconciler must compare against.
   */
  invoiceTotal: number | null;
}

/** The totals Pilot prints on the last page — the statement checking its own arithmetic, for us to reuse. */
export interface StatementPrintedTotals {
  /** Per product code: [units, amount]. */
  byProduct: Record<string, { units: number; amount: number }>;
  units: number | null;
  amount: number | null;
  retail: number | null;
  savings: number | null;
}

export type { TieOutResult as StatementTieOut } from "./pilotStatementTieOut.js";
type StatementTieOut = import("./pilotStatementTieOut.js").TieOutResult;

export interface PilotStatementParse {
  headerFound: boolean;
  account: string | null;
  invoiceNumber: string | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  billingDate: string | null;
  lines: StatementLine[]; // every dated line, fuel and merchandise alike
  fills: StatementLine[]; // tractor diesel (020/021) — the reconciliation unit
  reeferLines: StatementLine[]; // 033
  defLines: StatementLine[]; // 140
  merchandise: StatementLine[]; // Misc./Disc. lines: units 0, charge in the misc column
  totalGallons: number;
  totalNet: number;
  totalRetail: number;
  printed: StatementPrintedTotals;
  tieOut: StatementTieOut;
  pages: number;
  /** How many distinct column-anchor sets were seen. >1 means the layout drifted mid-document. */
  anchorSets: number;
}

// ── column model ────────────────────────────────────────────────────────────────────────────────
/**
 * The statement's second header line, verbatim and in order. `Number` repeats four times and `Total`
 * twice — which is exactly why the match is positional over the whole run rather than per-token.
 */
const HEADER_TOKENS = [
  "Number", "Number", "Loc.", "City", "State", "Number", "Number", "Number", "Date", "Reading",
  "Prod", "Units", "Cost", "Amount", "Qts", "Amount", "Advance", "Disc.", "Tax", "Total", "Total",
] as const;

/** Field each header token introduces, same order. */
const FIELDS = [
  "card", "unit", "loc", "city", "state", "ticket", "auth", "po", "date", "odometer",
  "prod", "units", "cost", "amount", "qts", "oilAmount", "cashAdvance", "misc", "tax", "invoiceTotal", "retail",
] as const;
type Field = (typeof FIELDS)[number];
type Row = Partial<Record<Field, string>>;

/**
 * Left edge of each column's VALUE region, in PDF points, in `FIELDS` order — measured from the five
 * real statements, not from the header tokens (see the module comment). A word belongs to the last
 * column whose bound it has reached.
 */
const COLUMN_BOUNDS = [
  19, 61, 93, 112, 155, 175, 219, 258, 330, 358, 405, 430, 465, 495, 538, 560, 596, 632, 666, 696, 738,
] as const;
/** Absorbs the point or two of jitter in right-aligned numerics between renderings. */
const BOUND_SLACK = 6;
/** How far a header token may sit from where we expect it before we call the layout changed. */
const HEADER_DRIFT_TOLERANCE = 12;
/** Words within this many points of each other vertically are the same printed line. Statement rows are
 *  ~11pt apart and wrapped continuation lines ~9pt, so 1.2 keeps them distinct. */
const ROW_TOLERANCE = 1.2;

// ── product classification ──────────────────────────────────────────────────────────────────────
const PRODUCTS: Record<string, { product: ReportProduct; tank: StatementTank; label: string }> = {
  "002": { product: "other", tank: "none", label: "Unleaded Regular" },
  "003": { product: "other", tank: "none", label: "Unleaded Plus" },
  "004": { product: "other", tank: "none", label: "Unleaded Premium" },
  "019": { product: "diesel", tank: "tractor", label: "Auto Diesel" },
  "020": { product: "diesel", tank: "tractor", label: "Truck Diesel" },
  "021": { product: "diesel", tank: "tractor", label: "Truck Diesel #1" },
  "033": { product: "diesel", tank: "reefer", label: "Reefer" },
  "071": { product: "diesel", tank: "reefer", label: "Dyed Diesel" },
  "099": { product: "other", tank: "none", label: "Misc Fuel" },
  "101": { product: "other", tank: "none", label: "Oil" },
  "138": { product: "def", tank: "none", label: "Diesel Exhaust Fluid" },
  "140": { product: "def", tank: "none", label: "Diesel Exhaust Fluid" },
  "400": { product: "other", tank: "none", label: "Miscellaneous" },
};

/** Every code the built-in table knows, for cross-checking the statement's printed legend. */
export const KNOWN_PRODUCT_CODES = Object.keys(PRODUCTS);

/** Classify a Pilot product code. Unknown codes are reported as `other`, never folded into diesel —
 *  an unmapped code silently counted as tractor fuel would corrupt both spend and MPG. */
export function classifyStatementProduct(code: string | null): { product: ReportProduct; tank: StatementTank; known: boolean } {
  const p = code ? PRODUCTS[code] : undefined;
  return p ? { product: p.product, tank: p.tank, known: true } : { product: "other", tank: "none", known: false };
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
const numOf = (s: string | undefined): number | null => {
  if (s == null) return null;
  const t = s.replace(/[$,\s]/g, "");
  if (t === "" || !/^-?\.?\d/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** "08/17" + the statement's own year window → YYYY-MM-DD. The statement prints no year on a line, and
 *  a week can straddle New Year, so the year comes from whichever window endpoint shares the month. */
function lineDate(mmdd: string, start: string | null, end: string | null): string | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(mmdd);
  if (!m) return null;
  const [, mm, dd] = m;
  for (const w of [start, end]) {
    if (w && w.slice(5, 7) === mm) return `${w.slice(0, 4)}-${mm}-${dd}`;
  }
  return start ? `${start.slice(0, 4)}-${mm}-${dd}` : null;
}

const usDate = (s: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(s);
  return m ? `20${m[3]}-${m[1]}-${m[2]}` : null;
};

/** Group words into printed lines by y, each line's words ordered left-to-right. */
function toRows(words: StatementWord[]): { y: number; cells: StatementWord[] }[] {
  const bands = new Map<number, StatementWord[]>();
  for (const w of words) {
    const k = Math.round(w.y / ROW_TOLERANCE);
    const bucket = bands.get(k);
    if (bucket) bucket.push(w);
    else bands.set(k, [w]);
  }
  return [...bands.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, cells]) => ({ y: k * ROW_TOLERANCE, cells: cells.sort((a, b) => a.x - b.x) }));
}

/**
 * Locate this page's header line and report whether the layout still matches. Returns the y to start
 * reading the body from, plus how far the header has drifted from the geometry COLUMN_BOUNDS assumes.
 */
function findHeader(rows: { y: number; cells: StatementWord[] }[]): { y: number; drift: number } | null {
  for (const r of rows) {
    if (r.cells.length < HEADER_TOKENS.length) continue;
    const head = r.cells.slice(0, HEADER_TOKENS.length);
    if (!head.every((w, i) => w.text === HEADER_TOKENS[i])) continue;
    // Header tokens sit at their own x, not the value bounds; what matters is that the SPACING between
    // them is unchanged, so drift is measured against the first token rather than absolutely.
    const base = head[0]!.x - COLUMN_BOUNDS[0];
    const drift = Math.max(...head.map((w, i) => Math.abs(w.x - base - HEADER_TOKEN_OFFSETS[i]!)));
    return { y: r.y, drift };
  }
  return null;
}

/** Where each header token sits relative to the first, in the layout COLUMN_BOUNDS was measured from. */
const HEADER_TOKEN_OFFSETS = [
  24, 61, 97, 115, 156, 184, 227, 283, 339, 370, 409, 437, 472, 503, 543, 566, 600, 641, 674, 704, 744,
] as const;

function bindRow(cells: StatementWord[]): Row {
  const acc: Partial<Record<Field, string[]>> = {};
  for (const w of cells) {
    let field: Field | null = null;
    for (let i = 0; i < COLUMN_BOUNDS.length; i++) if (w.x >= COLUMN_BOUNDS[i]! - BOUND_SLACK) field = FIELDS[i]!;
    if (!field) continue;
    (acc[field] ??= []).push(w.text);
  }
  const out: Row = {};
  for (const [k, v] of Object.entries(acc)) out[k as Field] = v.join(" ");
  return out;
}

// ── document metadata ───────────────────────────────────────────────────────────────────────────
interface StatementMeta {
  account: string | null;
  invoiceNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  billingDate: string | null;
}

/** Read the header block. Every page repeats it, so page 1 is enough and later pages are a free check. */
function readMeta(words: StatementWord[]): StatementMeta {
  const flat = words.map((w) => w.text).join(" ");
  const acct = /Acct No: (\d+)/.exec(flat);
  const inv = /Invoice Number: (\d+)/.exec(flat);
  const period = /Beginning (\d{2}\/\d{2}\/\d{2}), Ending (\d{2}\/\d{2}\/\d{2})/.exec(flat);
  const billing = /Billing Date: (\d{2}\/\d{2}\/\d{2})/.exec(flat);
  return {
    account: acct?.[1] ?? null,
    invoiceNumber: inv?.[1] ?? null,
    startDate: period ? usDate(period[1]!) : null,
    endDate: period ? usDate(period[2]!) : null,
    billingDate: billing ? usDate(billing[1]!) : null,
  };
}

/**
 * The product-code legend Pilot prints on the summary page ("020 Truck Diesel"). Read as a
 * three-digit code followed by its words, on the right-hand side of the page where the legend sits.
 */
function readLegend(rows: { cells: StatementWord[] }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const [first, ...rest] = r.cells;
    if (!first || rest.length === 0) continue;
    if (!/^\d{3}$/.test(first.text) || first.x < 600) continue;
    out[first.text] ??= rest.map((w) => w.text).join(" ");
  }
  return out;
}

/**
 * The totals Pilot prints for itself. Reporting Services renders the per-product `Customer Total`
 * VALUES on a baseline ~2pt above their label, so the label row and the value row are read as a pair
 * rather than assumed to share a band.
 */
function readPrintedTotals(rows: { y: number; cells: StatementWord[] }[]): StatementPrintedTotals {
  const totals: StatementPrintedTotals = { byProduct: {}, units: null, amount: null, retail: null, savings: null };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const text = r.cells.map((w) => w.text).join(" ");

    // "020 Customer Total" — its numbers sit on the preceding row.
    const perProduct = /^(\d{3}) Customer Total$/.exec(text);
    if (perProduct) {
      const vals = rows[i - 1];
      if (vals) {
        const b = bindRow(vals.cells);
        const units = numOf(b.units);
        const amount = numOf(b.amount);
        if (units != null && amount != null) totals.byProduct[perProduct[1]!] = { units, amount };
      }
      continue;
    }
    // "** Customer Total" — label and numbers share a row.
    if (text.startsWith("** Customer Total")) {
      const b = bindRow(r.cells);
      totals.units = numOf(b.units);
      totals.amount = numOf(b.amount);
      totals.retail = numOf(b.retail);
      continue;
    }
    if (text.startsWith("Savings Total")) {
      const n = r.cells.map((w) => numOf(w.text)).filter((v): v is number => v != null);
      totals.savings = n.length ? n[n.length - 1]! : null;
      continue;
    }
  }
  return totals;
}

// ── parser ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Parse a decoded weekly statement. `words` is every word in the document with its page and position;
 * the caller supplies them (pdfjs in the browser, a fixture in tests) so this stays pure.
 */
export function parsePilotStatement(words: StatementWord[]): PilotStatementParse {
  const byPage = new Map<number, StatementWord[]>();
  for (const w of words) {
    const b = byPage.get(w.page);
    if (b) b.push(w);
    else byPage.set(w.page, [w]);
  }
  const meta = readMeta(words);
  const empty: PilotStatementParse = {
    headerFound: false, account: meta.account, invoiceNumber: meta.invoiceNumber,
    startDate: meta.startDate, endDate: meta.endDate, billingDate: meta.billingDate,
    lines: [], fills: [], reeferLines: [], defLines: [], merchandise: [],
    totalGallons: 0, totalNet: 0, totalRetail: 0,
    printed: { byProduct: {}, units: null, amount: null, retail: null, savings: null },
    tieOut: { ok: false, failures: ["No statement header row was found."], notes: [], amountDelta: null, retailDelta: null, unitsDelta: null, savingsDelta: null },
    pages: byPage.size, anchorSets: 0,
  };

  const lines: StatementLine[] = [];
  const anchorSets = new Set<string>();
  let printed: StatementPrintedTotals = empty.printed;
  const legend: Record<string, string> = {};
  let rowNumber = 0;
  const drifted: number[] = [];

  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const rows = toRows(byPage.get(page)!);
    const header = findHeader(rows);
    Object.assign(legend, readLegend(rows));
    if (!header) continue;
    if (header.drift > HEADER_DRIFT_TOLERANCE) drifted.push(page);
    anchorSets.add(Math.round(header.drift).toString());

    const body = rows.filter((r) => r.y > header.y + 4);
    for (const r of body) {
      const b = bindRow(r.cells);
      if (!b.date || !/^\d{2}\/\d{2}$/.test(b.date)) continue; // only dated transaction lines
      rowNumber += 1;
      const code = b.prod && /^\d{2,3}$/.test(b.prod) ? b.prod.padStart(3, "0") : null;
      const cls = classifyStatementProduct(code);
      const gallons = numOf(b.units) ?? 0;
      const amount = numOf(b.amount);
      const misc = numOf(b.misc);
      const tax = numOf(b.tax);
      lines.push({
        authNo: b.auth ?? null,
        unit: b.unit ?? null,
        cardRef: b.card ?? null,
        site: b.loc ? b.loc.replace(/^0+(?=\d)/, "") : null,
        city: b.city ?? null,
        state: b.state && /^[A-Z]{2}$/.test(b.state) ? b.state : null,
        gallons,
        netAmount: amount, // FUEL ONLY — matches fuel_transactions.total_cost
        retailAmount: numOf(b.retail),
        tranDate: lineDate(b.date, meta.startDate, meta.endDate),
        time: null, // the weekly statement prints no time-of-day; the monthly export does
        product: cls.product,
        rowNumber,
        productCode: code,
        // The statement prints a legend rather than a description column; the code IS the identity
        // here, so the description is left null and `classifyPilotProduct` resolves on the code alone.
        productDescription: null,
        tank: cls.tank,
        unitCost: numOf(b.cost),
        odometer: numOf(b.odometer),
        ticket: b.ticket ?? null,
        poNumber: b.po ?? null,
        miscAmount: misc,
        salesTax: tax,
        invoiceTotal: (amount ?? 0) + (misc ?? 0) + (tax ?? 0),
      });
    }
    const t = readPrintedTotals(rows);
    if (t.amount != null) printed = t;
    else if (Object.keys(t.byProduct).length) printed = { ...printed, byProduct: { ...printed.byProduct, ...t.byProduct } };
  }

  if (lines.length === 0) return empty;

  const isFuelLine = (l: StatementLine) => l.productCode != null && l.gallons > 0;
  const fills = lines.filter((l) => isFuelLine(l) && l.tank === "tractor");
  const reeferLines = lines.filter((l) => isFuelLine(l) && l.tank === "reefer");
  const defLines = lines.filter((l) => isFuelLine(l) && l.product === "def");
  const merchandise = lines.filter((l) => !isFuelLine(l));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const totalNet = sum(lines.map((l) => l.netAmount ?? 0));
  const totalRetail = sum(lines.map((l) => l.retailAmount ?? 0));
  const totalInvoice = sum(lines.map((l) => l.invoiceTotal ?? 0));

  return {
    headerFound: true,
    account: meta.account, invoiceNumber: meta.invoiceNumber,
    startDate: meta.startDate, endDate: meta.endDate, billingDate: meta.billingDate,
    lines, fills, reeferLines, defLines, merchandise,
    totalGallons: sum(fills.concat(reeferLines).map((l) => l.gallons)),
    totalNet, totalRetail,
    printed,
    tieOut: tieOutStatement({ lines, totalNet, totalRetail, totalInvoice, printed, legend, driftedPages: drifted }, KNOWN_PRODUCT_CODES),
    pages: byPage.size,
    anchorSets: anchorSets.size,
  };
}

/**
 * Split one PDF text run into positioned words.
 *
 * PDF viewers hand back text RUNS, not words, and a renderer is free to merge cells that happen to abut:
 * pdfjs returns `"699 037"` for the statement's Unit and Loc. columns and `"IN 089272986"` for State and
 * Ticket, because Reporting Services emits them with no gap. Feeding those to the column binder would put
 * two columns' values in one column. So a run is split on whitespace and each word's x is interpolated
 * across the run's advance width by character index.
 *
 * The interpolation is approximate for a proportional font — measured against `pdftotext`'s true glyph
 * positions on the 2026-08-17 statement, the error is ≤3.2pt, comfortably inside the binder's 6pt slack —
 * and any residual mis-binding is caught by `tieOutStatement`, not shipped.
 */
export function splitTextRun(run: { text: string; x: number; y: number; page: number; width: number }): StatementWord[] {
  const { text, x, y, page, width } = run;
  if (text.trim() === "") return [];
  if (!/\s/.test(text.trim())) return [{ text: text.trim(), x, y, page }];
  const out: StatementWord[] = [];
  const perChar = text.length > 0 ? width / text.length : 0;
  for (const m of text.matchAll(/\S+/g)) {
    out.push({ text: m[0], x: x + perChar * m.index, y, page });
  }
  return out;
}
