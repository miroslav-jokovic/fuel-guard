/**
 * The weekly Pilot bill, rebuilt in the old statement's columns — with the discount Pilot stopped printing
 * (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §3, step 2). Pure: the caller reads the recorded statement lines
 * and the day's Pilot quotes; this turns them into rows and totals.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────────────────────────
 * From the week of 2026-11-16 Pilot's invoice prints Retail $ and Invoice $ per line and nothing else about
 * price: no Fuel Cost, no Misc./Disc. column, no per-product Customer Total, no Retail Total, no Savings
 * Total. The office read the discount off those. Every figure here is derived from what Pilot DID print plus
 * Pilot's own daily price file — nothing is estimated or invented, and a figure that cannot be derived is
 * null and labelled, never 0.
 *
 * ── WHERE EACH OLD COLUMN COMES FROM ────────────────────────────────────────────────────────────
 *   Fuel Cost      the statement's own when printed (old layout); otherwise fuel amount ÷ gallons. Measured
 *                  on INV-59656: that division equals the day's quoted "Your Price" on 346 of 348 quoted
 *                  diesel lines, to half a cent — so it IS the billed per-gallon price, not an approximation.
 *   Misc./Disc.,   the new layout prints in-store items and their tax as their OWN lines on the same ticket
 *   Sales Tax      (`Miscellaneous`, `Tax`). They are folded back onto that ticket's fuel line, as the old
 *                  statement printed them, so a ticket reads as one row again. A ticket with no fuel line
 *                  stays a merchandise row of its own, as it did on the old statement.
 *   Retail Total   Pilot's printed Retail $ for the line — the pump price at the fill. NOT the quote's retail:
 *                  that is Pilot's ~8:24 PM snapshot the evening before and runs a median 4¢/gal above.
 *   Savings        Retail Total − Invoice Total, the same definition the old printed Savings Total used
 *                  (`pilotStatementTieOut.ts` verified it on the 2026-08-17 statement).
 *   Auth, P.O., Qts, Oil, Cash Advance   not on the new invoice; left blank, never 0.
 *
 * ── THE QUOTE CHECK ─────────────────────────────────────────────────────────────────────────────
 * For tractor diesel only — Pilot's price file quotes Truck Diesel, not reefer or DEF. The quote is the one
 * `fuel_spend_lines` uses for the same station (D-FC4, 0247): the newest at or before the line's date, at most
 * a day old. A line billed above its quote by at least `MIN_CONTRACT_OVERBILL_USD` is listed — the same floor
 * the nightly contract scan files a finding at, so this page and the Exceptions queue cannot disagree on what
 * "billed above the quote" means.
 */
import { MIN_CONTRACT_OVERBILL_USD } from "../fuelSpend/exceptions.js";

/** One recorded `fuel_statement_lines` row, in the shape the reader projects. */
export interface WeeklyBillLineIn {
  lineNumber: number;
  productCode: string | null;
  tank: "tractor" | "reefer" | "none" | null;
  tranDate: string | null;
  cardRef: string | null;
  unit: string | null;
  poName: string | null;
  authNo: string | null;
  ticket: string | null;
  odometer: number | null;
  site: string | null;
  city: string | null;
  state: string | null;
  stationId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  gallons: number;
  unitCost: number | null;
  fuelAmount: number | null;
  miscAmount: number | null;
  salesTax: number | null;
  invoiceTotal: number | null;
  retailTotal: number | null;
}

/** Pilot's quote for one station and day. */
export interface PilotQuote {
  posted: number | null;
  net: number | null;
  /** The quote's own date — may be the day before the line's (D-FC4). */
  date: string;
}

export type QuoteLookup = (stationId: string, date: string) => PilotQuote | null;

export interface WeeklyBillRow {
  /** Pilot line numbers this row is built from (several when merchandise was folded onto fuel). */
  lines: number[];
  card: string | null;
  unit: string | null;
  site: string | null;
  city: string | null;
  state: string | null;
  ticket: string | null;
  auth: string | null;
  po: string | null;
  date: string | null;
  odometer: number | null;
  vehicleId: string | null;
  driverId: string | null;
  productCode: string | null;
  tank: "tractor" | "reefer" | "none";
  units: number;
  fuelCost: number | null;
  amount: number;
  misc: number;
  tax: number;
  invoiceTotal: number;
  retailTotal: number | null;
  savings: number | null;
  /** Tractor diesel only; null = no quote that day (or not a quoted product). */
  quotedPrice: number | null;
  /** Billed per-gallon minus quoted; positive = billed above the quote. */
  overQuotePerGal: number | null;
  overQuoteUsd: number | null;
}

export interface WeeklyBillProductTotal {
  code: string;
  units: number;
  amount: number;
  retail: number;
  savings: number;
  lines: number;
}

/**
 * One transaction date's block, as the old statement printed it under each day: a subtotal per product
 * (`020 Subtotal`), the `Date Subtotal`, its `Average Cost Per Gallon` and its `Savings SubTotal`.
 */
export interface WeeklyBillDay {
  /** YYYY-MM-DD; null collects lines the bill printed without a date (none on any statement measured). */
  date: string | null;
  byProduct: { code: string; units: number; amount: number }[];
  units: number;
  amount: number;
  misc: number;
  tax: number;
  invoiceTotal: number;
  retailTotal: number;
  savings: number;
  /** Fuel amount ÷ gallons, every product together. Can differ from Pilot's printed day average (see avgCost). */
  avgCostPerGal: number | null;
}

export interface WeeklyBillReport {
  rows: WeeklyBillRow[];
  byProduct: WeeklyBillProductTotal[];
  /** Oldest day first. */
  byDay: WeeklyBillDay[];
  totals: {
    units: number; amount: number; misc: number; tax: number; invoiceTotal: number; retailTotal: number; savings: number;
    /** The `** Customer Total` line's `Average Cost Per Gallon`: fuel amount ÷ gallons for the week. */
    avgCostPerGal: number | null;
  };
  /** Rows billed above their quote by at least the floor, largest first. */
  overQuote: WeeklyBillRow[];
  quote: { tractorLines: number; quoted: number; unquoted: number; floorUsd: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const isMerch = (l: WeeklyBillLineIn) => l.productCode == null && l.gallons === 0;
const isQuotedProduct = (l: { tank: string | null; productCode: string | null }) => l.tank === "tractor" && l.productCode != null;

function baseRow(l: WeeklyBillLineIn): WeeklyBillRow {
  const amount = l.fuelAmount ?? 0;
  return {
    lines: [l.lineNumber],
    card: l.cardRef, unit: l.unit, site: l.site, city: l.city, state: l.state,
    ticket: l.ticket, auth: l.authNo, po: l.poName, date: l.tranDate, odometer: l.odometer,
    vehicleId: l.vehicleId, driverId: l.driverId,
    productCode: l.productCode, tank: l.tank ?? "none",
    units: l.gallons,
    fuelCost: l.unitCost ?? (l.gallons > 0 && l.fuelAmount != null ? r4(l.fuelAmount / l.gallons) : null),
    amount,
    misc: l.miscAmount ?? 0,
    tax: l.salesTax ?? 0,
    invoiceTotal: l.invoiceTotal ?? r2(amount + (l.miscAmount ?? 0) + (l.salesTax ?? 0)),
    retailTotal: l.retailTotal,
    savings: null, quotedPrice: null, overQuotePerGal: null, overQuoteUsd: null,
  };
}

/** Fold a merchandise line's charges onto a row of the same ticket. */
function fold(into: WeeklyBillRow, m: WeeklyBillLineIn): void {
  into.lines.push(m.lineNumber);
  into.misc = r2(into.misc + (m.miscAmount ?? 0));
  into.tax = r2(into.tax + (m.salesTax ?? 0));
  into.invoiceTotal = r2(into.invoiceTotal + (m.invoiceTotal ?? 0));
  into.retailTotal = into.retailTotal == null || m.retailTotal == null ? null : r2(into.retailTotal + m.retailTotal);
}

const ticketKey = (l: WeeklyBillLineIn) => (l.ticket ? `${l.ticket}|${l.cardRef ?? ""}|${l.tranDate ?? ""}` : null);

export function buildWeeklyBillReport(lines: readonly WeeklyBillLineIn[], quoteFor: QuoteLookup): WeeklyBillReport {
  const sorted = [...lines].sort((a, b) => a.lineNumber - b.lineNumber);
  const rows: WeeklyBillRow[] = [];
  /** The row a ticket's merchandise folds onto: its first tractor fuel line, else its first fuel line. */
  const host = new Map<string, WeeklyBillRow>();
  const merchOnly = new Map<string, WeeklyBillRow>();

  for (const l of sorted) {
    if (isMerch(l)) continue;
    const row = baseRow(l);
    rows.push(row);
    const k = ticketKey(l);
    if (k && (!host.has(k) || (host.get(k)!.tank !== "tractor" && row.tank === "tractor"))) host.set(k, row);
  }
  for (const m of sorted) {
    if (!isMerch(m)) continue;
    const k = ticketKey(m);
    const target = k ? (host.get(k) ?? merchOnly.get(k)) : undefined;
    if (target) {
      fold(target, m);
      continue;
    }
    const row = baseRow(m);
    rows.push(row);
    if (k) merchOnly.set(k, row);
  }
  rows.sort((a, b) => a.lines[0]! - b.lines[0]!);

  let quoted = 0;
  let tractorLines = 0;
  const byStation = new Map(sorted.map((l) => [l.lineNumber, l.stationId]));
  for (const row of rows) {
    row.savings = row.retailTotal == null ? null : r2(row.retailTotal - row.invoiceTotal);
    if (!isQuotedProduct(row)) continue;
    tractorLines += 1;
    const stationId = byStation.get(row.lines[0]!);
    const q = stationId && row.date ? quoteFor(stationId, row.date) : null;
    if (!q || q.net == null || row.fuelCost == null) continue;
    quoted += 1;
    row.quotedPrice = q.net;
    row.overQuotePerGal = r4(row.fuelCost - q.net);
    row.overQuoteUsd = r2((row.fuelCost - q.net) * row.units);
  }

  const totals = { units: 0, amount: 0, misc: 0, tax: 0, invoiceTotal: 0, retailTotal: 0, savings: 0 };
  const products = new Map<string, WeeklyBillProductTotal>();
  for (const row of rows) {
    totals.units += row.units;
    totals.amount += row.amount;
    totals.misc += row.misc;
    totals.tax += row.tax;
    totals.invoiceTotal += row.invoiceTotal;
    totals.retailTotal += row.retailTotal ?? 0;
    totals.savings += row.savings ?? 0;
    const code = row.productCode ?? "merchandise";
    const p = products.get(code) ?? { code, units: 0, amount: 0, retail: 0, savings: 0, lines: 0 };
    p.units += row.units;
    p.amount += row.amount + (row.productCode == null ? row.misc + row.tax : 0);
    p.retail += row.retailTotal ?? 0;
    p.savings += row.savings ?? 0;
    p.lines += 1;
    products.set(code, p);
  }
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = r2(totals[k]);

  return {
    rows,
    byDay: buildByDay(rows),
    byProduct: [...products.values()]
      .map((p) => ({ ...p, units: r2(p.units), amount: r2(p.amount), retail: r2(p.retail), savings: r2(p.savings) }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    totals: { ...totals, avgCostPerGal: avgCost(totals.amount, totals.units) },
    overQuote: rows
      .filter((r) => r.overQuoteUsd != null && r.overQuoteUsd >= MIN_CONTRACT_OVERBILL_USD)
      .sort((a, b) => b.overQuoteUsd! - a.overQuoteUsd!),
    quote: { tractorLines, quoted, unquoted: tractorLines - quoted, floorUsd: MIN_CONTRACT_OVERBILL_USD },
  };
}

/**
 * ── WHY THE AVERAGE IS FUEL AMOUNT ÷ GALLONS, AND WHERE IT DIFFERS FROM PILOT'S ─────────────────
 * Measured 2026-11-27 on the 2026-08-17 statement (db139445F1, week 08/10–08/16). Every day's printed
 * `Date Subtotal` amount, retail, `Savings SubTotal` and per-product subtotal is reproduced from the lines to the
 * cent, and so is the week's `** Customer Total` average (printed 4.99; amount ÷ units = 4.9868). Pilot's printed
 * per-DAY average is not reproducible from what it prints. Fuel amount ÷ gallons over every product comes
 * closest: within 0.05¢ on 08/10, 13, 14 and 16, but 0.3¢ off on 08/11 (4.7726 vs 4.7758) and 0.9¢ off on 08/12
 * (5.0594 vs 5.0502). Also tried, and further off: the mean of the Fuel Cost column, diesel only, without DEF.
 * Pilot divides by a gallon figure it does not print, so the day's average here is labelled for what it is,
 * fuel $ ÷ gallons, and never presented as Pilot's figure.
 */
const avgCost = (amount: number, units: number): number | null => (units > 0 ? r4(amount / units) : null);

function buildByDay(rows: readonly WeeklyBillRow[]): WeeklyBillDay[] {
  const days = new Map<string, WeeklyBillDay & { products: Map<string, { code: string; units: number; amount: number }> }>();
  for (const row of rows) {
    const key = row.date ?? "";
    const d = days.get(key) ?? {
      date: row.date, byProduct: [], units: 0, amount: 0, misc: 0, tax: 0, invoiceTotal: 0, retailTotal: 0, savings: 0,
      avgCostPerGal: null, products: new Map(),
    };
    d.units += row.units;
    d.amount += row.amount;
    d.misc += row.misc;
    d.tax += row.tax;
    d.invoiceTotal += row.invoiceTotal;
    d.retailTotal += row.retailTotal ?? 0;
    d.savings += row.savings ?? 0;
    if (row.productCode != null) {
      const p = d.products.get(row.productCode) ?? { code: row.productCode, units: 0, amount: 0 };
      p.units += row.units;
      p.amount += row.amount;
      d.products.set(row.productCode, p);
    }
    days.set(key, d);
  }
  return [...days.values()]
    .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"))
    .map(({ products, ...d }) => ({
      ...d,
      byProduct: [...products.values()].map((p) => ({ code: p.code, units: r2(p.units), amount: r2(p.amount) })).sort((a, b) => a.code.localeCompare(b.code)),
      units: r2(d.units), amount: r2(d.amount), misc: r2(d.misc), tax: r2(d.tax),
      invoiceTotal: r2(d.invoiceTotal), retailTotal: r2(d.retailTotal), savings: r2(d.savings),
      avgCostPerGal: avgCost(d.amount, d.units),
    }));
}

/**
 * Pick the quote `fuel_spend_lines` would (D-FC4, 0247): newest at or before `date`, at most `maxStaleDays`
 * old. `quotes` is one station's quotes, any order.
 */
export function pickPilotQuote(quotes: readonly PilotQuote[], date: string, maxStaleDays = 1): PilotQuote | null {
  const floor = new Date(`${date}T00:00:00Z`);
  floor.setUTCDate(floor.getUTCDate() - maxStaleDays);
  const min = floor.toISOString().slice(0, 10);
  let best: PilotQuote | null = null;
  for (const q of quotes) {
    if (q.date > date || q.date < min) continue;
    if (!best || q.date > best.date) best = q;
  }
  return best;
}
