/**
 * Tie-out gate for the Pilot weekly statement (pure).
 *
 * A statement checks its own arithmetic — it prints `** Customer Total`, a per-product `Customer Total`,
 * and a `Savings Total`. Reproducing those from the parsed lines is the only evidence that a positional
 * PDF parse bound every word to the right column. On a spend of ~$270k/week, a silently mis-parsed
 * column is far worse than a refused upload, so a money mismatch REJECTS the file (D-FR3) rather than
 * raising a warning someone scrolls past.
 *
 * Takes a structural input rather than importing the parser's types, so there is no module cycle.
 */

export interface TieOutInput {
  lines: readonly {
    productCode: string | null;
    gallons: number;
    netAmount: number | null;
    invoiceTotal: number | null;
  }[];
  totalNet: number; // Σ fuel-only amount
  totalRetail: number;
  totalInvoice: number; // Σ (fuel + misc + tax) — what Pilot actually bills
  printed: {
    byProduct: Record<string, { units: number; amount: number }>;
    units: number | null;
    amount: number | null;
    retail: number | null;
    savings: number | null;
  };
  legend: Record<string, string>;
  /** Pages whose header sat further from the expected geometry than the parser's drift tolerance. */
  driftedPages: number[];
}

export interface TieOutResult {
  ok: boolean;
  failures: string[];
  notes: string[];
  amountDelta: number | null;
  retailDelta: number | null;
  unitsDelta: number | null;
  savingsDelta: number | null;
}

const MONEY_EPSILON = 0.011;
const UNITS_TOLERANCE = 25;
const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * `Savings Total` is `Retail Total − Invoice Total`, where Invoice Total INCLUDES bundled merchandise
 * and sales tax — not `retail − fuel amount`. Verified on the 2026-08-17 statement: retail 347,879.44 −
 * grand total 316,797.34 = 31,082.10, exactly as printed, where 316,797.34 = fuel 316,686.78 + misc
 * 102.94 + tax 7.62. Computing it the other way is off by precisely the bundled charges.
 */
export function tieOutStatement(input: TieOutInput, knownCodes: readonly string[]): TieOutResult {
  const { printed } = input;
  const failures: string[] = [];
  const notes: string[] = [];

  const amountDelta = printed.amount == null ? null : input.totalNet - printed.amount;
  const retailDelta = printed.retail == null ? null : input.totalRetail - printed.retail;
  const savingsDelta = printed.savings == null ? null : input.totalRetail - input.totalInvoice - printed.savings;
  const parsedUnits = input.lines.reduce((a, l) => a + l.gallons, 0);
  const unitsDelta = printed.units == null ? null : parsedUnits - printed.units;

  if (printed.amount == null) failures.push("The statement's own '** Customer Total' could not be read, so the parse cannot be verified.");
  else if (Math.abs(amountDelta!) > MONEY_EPSILON) {
    failures.push(`Fuel total ${usd(input.totalNet)} does not match the statement's printed ${usd(printed.amount)} (off by ${usd(amountDelta!)}).`);
  }
  if (printed.retail != null && Math.abs(retailDelta!) > MONEY_EPSILON) {
    failures.push(`Retail total ${usd(input.totalRetail)} does not match the statement's printed ${usd(printed.retail)} (off by ${usd(retailDelta!)}).`);
  }
  if (printed.savings != null && Math.abs(savingsDelta!) > MONEY_EPSILON) {
    failures.push(`Savings ${usd(input.totalRetail - input.totalInvoice)} does not match the statement's printed ${usd(printed.savings)} (off by ${usd(savingsDelta!)}).`);
  }

  // Per-product amounts must tie too — a column bound one place off can still sum correctly overall.
  for (const [code, want] of Object.entries(printed.byProduct)) {
    const got = input.lines.filter((l) => l.productCode === code).reduce((a, l) => a + (l.netAmount ?? 0), 0);
    if (Math.abs(got - want.amount) > MONEY_EPSILON) {
      failures.push(`Product ${code}: parsed ${usd(got)} vs the statement's printed ${usd(want.amount)}.`);
    }
  }

  // Gallons cannot tie to the cent — see UNITS_TOLERANCE in the parser. Report, never reject.
  if (unitsDelta != null && Math.abs(unitsDelta) > UNITS_TOLERANCE) {
    failures.push(`Gallons ${parsedUnits.toFixed(1)} vs the statement's printed ${printed.units!.toFixed(1)} — too far apart to be rounding.`);
  } else if (unitsDelta != null && Math.abs(unitsDelta) > 0.05) {
    notes.push(`Gallons differ from the printed total by ${unitsDelta.toFixed(1)} — expected: Pilot prints each line at 0.1 gal but totals the unrounded quantities.`);
  }

  // The statement declares its own product codes; anything it declares that we cannot classify is a
  // reporting gap, and anything on a line that the legend never declares is a parse smell.
  for (const code of Object.keys(input.legend)) {
    if (!knownCodes.includes(code)) notes.push(`The statement's legend declares product ${code} ("${input.legend[code]}"), which this build does not classify.`);
  }
  if (input.driftedPages.length) {
    notes.push(`The column layout drifted on ${input.driftedPages.length} page(s) (${input.driftedPages.slice(0, 5).join(", ")}) — the totals still tie, but Pilot may have changed the statement template.`);
  }
  const undeclared = [...new Set(input.lines.map((l) => l.productCode).filter((c): c is string => c != null))]
    .filter((c) => Object.keys(input.legend).length > 0 && !(c in input.legend));
  for (const code of undeclared) notes.push(`Product ${code} appears on a line but is absent from the statement's legend.`);

  return { ok: failures.length === 0, failures, notes, amountDelta, retailDelta, unitsDelta, savingsDelta };
}
