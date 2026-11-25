/**
 * Pilot's weekly direct-bill INVOICE, the layout Pilot switched to for the week of 2026-11-16 — pure parser.
 *
 * ── WHY A SECOND READER, NOT A CHANGE TO THE FIRST ───────────────────────────────────────────────
 * Until 2026-11-09 the weekly bill was the Reporting Services `StatementDBS_US` statement that
 * `pilotStatement.ts` reads. From the week of 11/16 Pilot Receivables sends
 * `Standard_Invoice_Gen_Template_INV-#####.pdf` instead: a Microsoft Word template exported through
 * DocuSign. It is a different document, not a moved column (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §1):
 *
 *   • 13 columns — Card#, Unit Number, Date (4-digit year), Transaction #, Store Location ("475 Moriarty NM",
 *     wrapping onto a second line), Vehicle ID, Driver ID, Odometer, Product (a NAME, not a code), Qty,
 *     Sales Tax, Retail $, Invoice $. No Fuel Cost, no Misc./Disc., no Auth or P.O. number.
 *   • The column header is printed on PAGE 1 ONLY; pages 2…88 are bare rows.
 *   • No billing period — only "Cycle: Weekly - Mon" and the billing date — and an invoice number with a
 *     prefix (`INV-59656`).
 *   • Its only printed totals are `Amount Purchased`, `USD Total`, `Transaction Tax` and `Amount Due`. No
 *     per-product total, no Retail Total, no Savings Total.
 *
 * The old statement's 21-token header line is absent, so `parsePilotStatement` reports `headerFound: false`
 * and every upload since 11/09 was refused as "not a Pilot statement". Old statements keep their own reader
 * untouched; `parsePilotWeeklyBill` below picks whichever layout the file is.
 *
 * ── HOW COLUMNS ARE BOUND ───────────────────────────────────────────────────────────────────────
 * By x position, like the old reader, because a value cell holds several words ("Truck Diesel", "1061
 * Springfield") that a text dump would run together. Measured on INV-59656: all 960 dated rows start every
 * cell at the same x (to 0.1pt) on all 88 pages; the 7 rows without a Vehicle ID simply have no word there.
 * The bounds are those measured value edges, taken relative to the page-1 `Card#` label so a shifted page
 * moves them together, and the header labels are checked against their measured spacing so a redesigned
 * template is reported rather than silently mis-bound.
 *
 * ── WHAT MAKES THAT SAFE IS THE TOTAL ───────────────────────────────────────────────────────────
 * The sum of every line's Invoice $ must reproduce the printed `Amount Purchased` to the cent, or the file
 * is refused (D-FR3, the same rule the old statement is held to). On INV-59656: 960 lines, $341,127.06 =
 * $341,127.06. It is not a formality — two lines there carry a `DB` suffix on the Transaction #
 * (`0929800378DB`), and a reader that expected digits dropped them and missed the total by $787.77. This
 * layout prints no retail or savings total, so those cannot be gated; Retail $ is carried per line as printed.
 */

import type { ReportProduct } from "./pilotFuelReport.js";
import {
  classifyStatementProduct,
  numOf,
  parsePilotStatement,
  toRows,
  type PilotStatementParse,
  type StatementLine,
  type StatementPrintedTotals,
  type StatementWord,
} from "./pilotStatement.js";
import type { TieOutResult } from "./pilotStatementTieOut.js";

// ── column model ────────────────────────────────────────────────────────────────────────────────
const FIELDS = [
  "card", "unit", "date", "txn", "loc", "vehicle", "driver", "odometer", "product", "qty", "tax", "retail", "invoice",
] as const;
type Field = (typeof FIELDS)[number];

/** Left edge of each column's VALUE cells, relative to the `Card#` label (x 19.0 on INV-59656). */
const VALUE_OFFSETS = [0, 38.6, 88.3, 149.3, 222.8, 294.5, 353.3, 412.4, 471.2, 530.3, 570.9, 626.3, 688.5] as const;
/** Where each header label sits relative to `Card#`, same order (Invoice $ is on the line above). */
const LABELS = ["Card#", "Unit", "Date", "Transaction", "Store", "Vehicle", "Driver", "Odometer", "Product", "Qty", "Sales", "Retail"] as const;
const LABEL_OFFSETS = [0, 38.9, 106.1, 159.6, 230.4, 303.4, 364.4, 421, 483.5, 539.9, 579.2, 640.7] as const;
/** The header line read as text — what identifies this layout. */
const HEADER_TEXT = "Card# Unit Number Date Transaction # Store Location Vehicle ID Driver ID Odometer Product Qty Sales Tax Retail $";
const BOUND_SLACK = 6;
const HEADER_DRIFT_TOLERANCE = 12;
/** A wrapped Store Location / Product line sits ~8.4pt under its row; rows are ~36pt apart. */
const CONTINUATION_MAX_DY = 20;
const MONEY_EPSILON = 0.011;

/**
 * Pilot's product NAMES on this layout, mapped to the codes the old statement printed — so a line from
 * either layout classifies the same way (`classifyStatementProduct`). `null` = a non-fuel charge, read as
 * merchandise exactly like the old statement's Misc./Disc. lines. A name not listed here is reported and
 * kept out of every fuel bucket — never guessed into diesel.
 */
const PRODUCT_CODES: Record<string, string | null> = {
  "TRUCK DIESEL": "020",
  "TRUCK DIESEL #1": "021",
  "AUTO DIESEL": "019",
  DIESEL: "019",
  REEFER: "033",
  "DYED DIESEL": "071",
  "DIESEL EXHAUST FLUID": "140",
  "DIESEL EXHAUST": "140",
  DEF: "140",
  MISCELLANEOUS: null,
  TAX: null,
};

/** Money as printed: "$1,058.94", "-$12.00" or "($12.00)". */
function money(s: string | undefined): number | null {
  if (s == null) return null;
  const neg = /^\(.*\)$/.test(s.trim());
  const n = numOf(s.replace(/[()]/g, ""));
  return n == null ? null : neg ? -n : n;
}

const isoDate = (s: string | undefined): string | null => {
  const m = s ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s) : null;
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

const shiftDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The week a weekly invoice BILLS: the seven days before its billing date.
 *
 * This layout prints no period, and the first reader (#2637) took the span of the line dates instead. That is
 * wrong the moment Pilot bills one fill late or early: INV-59656 (billed Monday 11/23, "Cycle: Weekly - Mon")
 * carries lines dated 11/23, so its period read 11/16–11/23, and the check filed 62 of our 11/23 fills as "in
 * our records, not on Pilot's bill" — fills that belong to the NEXT week's invoice (measured on production
 * 2026-11-25, PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §5). The old statement printed its period and it was
 * always the Monday–Sunday before the billing Monday, which is what this reproduces.
 *
 * Lines dated outside the week are still read and still matched; they only stop deciding which of OUR fills
 * should have been on the bill. Any cycle other than weekly returns null and the caller keeps the span.
 */
export function invoiceBillingWeek(cycle: string | null, billingDate: string | null): { from: string; to: string } | null {
  if (!billingDate || !cycle || !/^weekly\b/i.test(cycle.trim())) return null;
  return { from: shiftDays(billingDate, -7), to: shiftDays(billingDate, -1) };
}

type Bound = Partial<Record<Field, string[]>>;

function bind(cells: StatementWord[], bounds: readonly number[], into: Bound = {}): Bound {
  for (const w of cells) {
    let field: Field | null = null;
    for (let i = 0; i < bounds.length; i++) if (w.x >= bounds[i]! - BOUND_SLACK) field = FIELDS[i]!;
    if (field) (into[field] ??= []).push(w.text);
  }
  return into;
}
const text = (b: Bound, f: Field): string | undefined => (b[f] ? b[f]!.join(" ") : undefined);

/** "1061 Springfield IL" → site 1061, city Springfield, state IL. The state is the last token when it is one. */
function splitLocation(loc: string | undefined): { site: string | null; city: string | null; state: string | null } {
  const parts = (loc ?? "").split(/\s+/).filter(Boolean);
  const site = parts[0] && /^\d+$/.test(parts[0]) ? parts.shift()!.replace(/^0+(?=\d)/, "") : null;
  const state = parts.length && /^[A-Z]{2}$/.test(parts[parts.length - 1]!) ? parts.pop()! : null;
  return { site, city: parts.length ? parts.join(" ") : null, state };
}

interface InvoiceHeader {
  page: number;
  y: number;
  bounds: number[];
  drift: number;
}

function findHeader(byPage: Map<number, StatementWord[]>): InvoiceHeader | null {
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    for (const r of toRows(byPage.get(page)!)) {
      if (!r.cells.map((w) => w.text).join(" ").startsWith(HEADER_TEXT)) continue;
      const at = (label: string) => r.cells.find((w) => w.text === label)?.x ?? null;
      const base = at("Card#")!;
      const drift = Math.max(...LABELS.map((l, i) => Math.abs((at(l) ?? Infinity) - base - LABEL_OFFSETS[i]!)));
      return { page, y: r.y, bounds: VALUE_OFFSETS.map((o) => base + o), drift };
    }
  }
  return null;
}

function readPrinted(flat: string) {
  const grab = (re: RegExp) => {
    const m = re.exec(flat);
    return m ? money(m[1]) : null;
  };
  return {
    purchased: grab(/Amount Purchased:\s*(\S+)/),
    usdTotal: grab(/USD Total:\s*(\S+)/),
    tax: grab(/Transaction Tax:\s*(\S+)/),
    due: grab(/Amount Due for Billing Date \d{2}\/\d{2}\/\d{4}:\s*(\S+)/),
  };
}

/** Parse the 2026-11 invoice layout, or `null` when the words are not that layout. */
export function parsePilotInvoice(words: StatementWord[]): (PilotStatementParse & { layout: "invoice" }) | null {
  const byPage = new Map<number, StatementWord[]>();
  for (const w of words) {
    const b = byPage.get(w.page);
    if (b) b.push(w);
    else byPage.set(w.page, [w]);
  }
  const header = findHeader(byPage);
  if (!header) return null;

  const flat = words.map((w) => w.text).join(" ");
  const lines: StatementLine[] = [];
  const unknownProducts = new Set<string>();
  const unreadable: string[] = [];
  let rowNumber = 0;
  let columnTaxTotal = 0;

  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    let last: { y: number; bound: Bound } | null = null;
    const rows: { y: number; bound: Bound }[] = [];
    for (const r of toRows(byPage.get(page)!)) {
      if (page === header.page && r.y <= header.y) continue;
      const bound = bind(r.cells, header.bounds);
      if (isoDate(text(bound, "date")) && /^\d+$/.test(text(bound, "card") ?? "")) {
        last = { y: r.y, bound };
        rows.push(last);
        continue;
      }
      // A wrapped Store Location or Product line belongs to the row just above it.
      const fields = Object.keys(bound);
      if (last && r.y - last.y < CONTINUATION_MAX_DY && fields.length && fields.every((f) => f === "loc" || f === "product")) {
        bind(r.cells, header.bounds, last.bound);
      }
    }

    for (const { bound: b } of rows) {
      rowNumber += 1;
      const name = (text(b, "product") ?? "").toUpperCase();
      const known = name in PRODUCT_CODES;
      if (!known) unknownProducts.add(text(b, "product") ?? "(blank)");
      const code = known ? PRODUCT_CODES[name]! : null;
      const cls = classifyStatementProduct(code);
      const isFuel = code != null && cls.product !== "other";
      // A `Tax` line is the sales tax on the same ticket's in-store items — the old statement printed it
      // in that ticket's Sales Tax column (measured on INV-59656: all 10 `Tax` lines share a ticket with a
      // `Miscellaneous` line). So its charge is TAX, not merchandise; the Sales Tax column is kept apart
      // because the printed `Transaction Tax` totals only that column.
      const isTaxLine = name === "TAX";
      const qty = money(text(b, "qty"));
      const columnTax = money(text(b, "tax")) ?? 0;
      columnTaxTotal += columnTax;
      const invoice = money(text(b, "invoice"));
      const tax = isTaxLine && invoice != null ? r2(invoice) : columnTax;
      const retail = money(text(b, "retail"));
      if (qty == null || invoice == null || retail == null) unreadable.push(`${text(b, "date")} card ${text(b, "card")}`);
      const loc = splitLocation(text(b, "loc"));
      lines.push({
        rowNumber,
        cardRef: text(b, "card") ?? null,
        unit: text(b, "unit") ?? null,
        tranDate: isoDate(text(b, "date")),
        time: null,
        ticket: text(b, "txn") ?? null,
        authNo: null, // this layout prints no authorization number
        poNumber: null,
        ...loc,
        vehicleId: text(b, "vehicle") ?? null,
        driverId: text(b, "driver") ?? null,
        odometer: numOf(text(b, "odometer")),
        productCode: code,
        productDescription: text(b, "product") ?? null,
        product: (isFuel ? cls.product : "other") as ReportProduct,
        tank: isFuel ? cls.tank : "none",
        // A non-fuel charge reads like the old statement's merchandise line: no units, the charge in misc.
        gallons: isFuel ? (qty ?? 0) : 0,
        // This layout prints no per-gallon price; the rebuilt report derives it, the parse does not invent it.
        unitCost: null,
        netAmount: isFuel && invoice != null ? r2(invoice - tax) : null,
        miscAmount: !isFuel && !isTaxLine && invoice != null ? r2(invoice - tax) : null,
        salesTax: tax,
        invoiceTotal: invoice,
        retailAmount: retail,
      });
    }
  }

  const printedTotals = readPrinted(flat);
  const printed: StatementPrintedTotals = { byProduct: {}, units: null, amount: printedTotals.purchased, retail: null, savings: null };
  const dates = lines.map((l) => l.tranDate).filter((d): d is string => d != null).sort();
  const billingDate = isoDate(/Billing Date:\s*(\S+)/.exec(flat)?.[1]);
  const week = invoiceBillingWeek(/Cycle:\s*([A-Za-z]+)/.exec(flat)?.[1] ?? null, billingDate);
  const isFuelLine = (l: StatementLine) => l.productCode != null && l.gallons > 0;
  const fills = lines.filter((l) => isFuelLine(l) && l.tank === "tractor");
  const reeferLines = lines.filter((l) => isFuelLine(l) && l.tank === "reefer");
  const sum = (xs: StatementLine[], pick: (l: StatementLine) => number | null) => xs.reduce((a, l) => a + (pick(l) ?? 0), 0);
  const totalInvoice = sum(lines, (l) => l.invoiceTotal);
  const totalRetail = sum(lines, (l) => l.retailAmount);

  return {
    layout: "invoice",
    headerFound: true,
    account: /Acct No:\s*(\d+)/.exec(flat)?.[1] ?? null,
    invoiceNumber: /Invoice No:\s*(\S+)/.exec(flat)?.[1] ?? null,
    // No period is printed: the billing week when the cycle is weekly, else the span of the lines' own dates.
    startDate: week?.from ?? dates[0] ?? null,
    endDate: week?.to ?? dates[dates.length - 1] ?? null,
    billingDate,
    lines,
    fills,
    reeferLines,
    defLines: lines.filter((l) => isFuelLine(l) && l.product === "def"),
    merchandise: lines.filter((l) => !isFuelLine(l)),
    totalGallons: sum(fills.concat(reeferLines), (l) => l.gallons),
    totalNet: sum(lines, (l) => l.netAmount),
    totalRetail,
    printed,
    tieOut: tieOutInvoice({
      lines: lines.length, totalInvoice, totalTax: columnTaxTotal, printedTotals, unknownProducts, unreadable, drift: header.drift,
      billingWeek: week != null,
      outsideWeek: week ? lines.filter((l) => l.tranDate != null && (l.tranDate < week.from || l.tranDate > week.to)).length : 0,
    }),
    pages: byPage.size,
    anchorSets: 1,
  };
}

/** The invoice's own arithmetic, reproduced. A money mismatch refuses the file; everything else is a note. */
function tieOutInvoice(input: {
  lines: number;
  totalInvoice: number;
  totalTax: number;
  printedTotals: ReturnType<typeof readPrinted>;
  unknownProducts: Set<string>;
  unreadable: string[];
  drift: number;
  billingWeek: boolean;
  outsideWeek: number;
}): TieOutResult {
  const { printedTotals: p } = input;
  const failures: string[] = [];
  const notes: string[] = [];
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const amountDelta = p.purchased == null ? null : r2(input.totalInvoice - p.purchased);

  if (input.lines === 0) failures.push("The invoice's header was found but no transaction lines were read.");
  if (p.purchased == null) failures.push("The invoice's own 'Amount Purchased' could not be read, so the parse cannot be verified.");
  else if (Math.abs(amountDelta!) > MONEY_EPSILON) {
    failures.push(`Lines add up to ${usd(input.totalInvoice)}, but the invoice prints Amount Purchased ${usd(p.purchased)} (off by ${usd(amountDelta!)}).`);
  }
  if (p.purchased != null && p.usdTotal != null && Math.abs(p.usdTotal - p.purchased) > MONEY_EPSILON) {
    failures.push(`The invoice disagrees with itself: USD Total ${usd(p.usdTotal)} vs Amount Purchased ${usd(p.purchased)}.`);
  }
  if (p.tax != null && Math.abs(p.tax - input.totalTax) > MONEY_EPSILON) {
    failures.push(`The Sales Tax column adds up to ${usd(input.totalTax)}, but the invoice prints Transaction Tax ${usd(p.tax)}.`);
  }
  if (p.due != null && p.usdTotal != null && Math.abs(p.due - p.usdTotal - (p.tax ?? 0)) > MONEY_EPSILON) {
    notes.push(`Amount Due ${usd(p.due)} is not USD Total plus Transaction Tax — check the invoice for an adjustment.`);
  }
  if (input.unreadable.length) {
    failures.push(`${input.unreadable.length} line(s) have an unreadable quantity or amount (first: ${input.unreadable[0]}).`);
  }
  for (const name of input.unknownProducts) {
    notes.push(`Product "${name}" is not one this build classifies; its lines are counted as non-fuel charges.`);
  }
  if (input.drift > HEADER_DRIFT_TOLERANCE) {
    notes.push("The invoice's column header moved from where it was on 2026-11-23 — the total still ties, but Pilot may have changed the template.");
  }
  notes.push(
    input.billingWeek
      ? "This invoice layout prints no billing period, retail total or savings total; the period is the week before its billing date."
      : "This invoice layout prints no billing period, retail total or savings total; the period is the span of its line dates.",
  );
  if (input.outsideWeek > 0) {
    notes.push(`${input.outsideWeek} line(s) are dated outside that week — billed late or early; they are still matched.`);
  }
  return { ok: failures.length === 0, failures, notes, amountDelta, retailDelta: null, unitsDelta: null, savingsDelta: null };
}

/**
 * The one entry point for a weekly Pilot bill PDF, whichever layout it is. The old statement is tried first
 * and wins when its header is present, so every statement recorded before 2026-11-16 parses exactly as it did.
 */
export function parsePilotWeeklyBill(words: StatementWord[]): PilotStatementParse & { layout: "statement" | "invoice" } {
  const statement = parsePilotStatement(words);
  if (statement.headerFound) return { ...statement, layout: "statement" };
  return parsePilotInvoice(words) ?? { ...statement, layout: "statement" };
}
