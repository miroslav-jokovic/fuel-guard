/**
 * Tie-out gate for the Pilot monthly "All Transactions" export (pure).
 *
 * ── WHY THE EXPORT NEEDED ONE (L8) ───────────────────────────────────────────────────────────────
 * The weekly statement has been refused since WP2 unless the parse reproduces the totals Pilot prints
 * on it — a mis-read column on a quarter of a million dollars of fuel is worse than a rejected upload.
 * The monthly export had no equivalent check at all, and it is the format that produces the LARGER
 * reconciliation: five statements cover five weeks, one export covers two months.
 *
 * ── AND IT HAD A TOTAL ALL ALONG ─────────────────────────────────────────────────────────────────
 * The workbook is three sheets, not one. `All Transactions` carries every product line, `DSL Only` the
 * diesel subset, and `PivotTable` a summary whose Grand Total row prints `Sum of Quantity`. Nothing
 * read past the first sheet, so the figure sat there unused.
 *
 * Verified against the real 2026-06/07 export (account 139445, 5,997 product rows): the parser's diesel
 * gallon total and the printed grand total agree to the hundredth —
 *
 *     parsed  418,537.23      printed  418,537.23000000056
 *
 * The trailing digits are the pivot's own float accumulation, which is why this compares within a
 * tolerance rather than for equality.
 *
 * ── WHAT IT CAN AND CANNOT CHECK ─────────────────────────────────────────────────────────────────
 * The pivot totals QUANTITY only — there is no printed money total to check against, so unlike the
 * statement this gate cannot verify the amount columns. It is a real gate on the column the whole
 * reconciliation is keyed to (a mis-bound Quantity column moves every gallon figure and every match),
 * and it is honest about being narrower than the statement's. A file with no pivot sheet is NOT
 * refused — older exports may not carry one — but it is reported as ungated, because "we checked and
 * it agreed" and "there was nothing to check against" must never look the same.
 */

/** Gallons may differ by this much before the parse is called wrong. The pivot sums floats. */
const GALLON_EPSILON = 0.05;

export interface ExportTieOutInput {
  /** Σ Quantity over the lines the parser classified as tractor diesel. */
  parsedDieselGallons: number;
  /** `Sum of Quantity` from the PivotTable's Grand Total row, or null when the sheet is absent. */
  printedDieselGallons: number | null;
  /** How many rows the parser skipped for a missing or non-positive quantity. */
  skipped: number;
  /** Product codes the catalogue did not recognise, with their line counts. */
  unknownProducts: Record<string, number>;
}

export interface ExportTieOutResult {
  ok: boolean;
  /** True when a printed total existed to check against. False means ungated, not verified. */
  gated: boolean;
  failures: string[];
  notes: string[];
  gallonsDelta: number | null;
}

const gal = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function pilotExportTieOut(input: ExportTieOutInput): ExportTieOutResult {
  const failures: string[] = [];
  const notes: string[] = [];

  const printed = input.printedDieselGallons;
  const gated = printed != null;
  const gallonsDelta = printed == null ? null : Math.round((input.parsedDieselGallons - printed) * 100) / 100;

  if (printed == null) {
    notes.push(
      "This export carries no PivotTable summary, so there is no printed total to check the parse " +
        "against. The figures below are unverified.",
    );
  } else if (Math.abs(gallonsDelta!) > GALLON_EPSILON) {
    failures.push(
      `Diesel gallons read ${gal(input.parsedDieselGallons)} against the ${gal(printed)} the export's ` +
        `own PivotTable prints — a difference of ${gal(Math.abs(gallonsDelta!))}.`,
    );
  }

  // Not a failure: a row with no quantity is a cancelled or zero-value line, and Pilot's own pivot
  // excludes it too. Reported so a sudden jump is visible rather than absorbed.
  if (input.skipped > 0) {
    notes.push(`${input.skipped} row${input.skipped === 1 ? "" : "s"} carried no quantity and were skipped.`);
  }

  // An unrecognised product code is surfaced, never bucketed into diesel — the same `known: false`
  // convention the brand catalogue uses. It does not refuse the file: a new Pilot product should not
  // block a reconciliation of the products we do understand.
  const unknown = Object.entries(input.unknownProducts).filter(([, n]) => n > 0);
  if (unknown.length > 0) {
    notes.push(
      `Unrecognised product code${unknown.length === 1 ? "" : "s"}: ` +
        unknown.map(([code, n]) => `${code || "(blank)"} on ${n} line${n === 1 ? "" : "s"}`).join(", ") +
        ". Those lines are counted but not reconciled.",
    );
  }

  return { ok: failures.length === 0, gated, failures, notes, gallonsDelta };
}

/**
 * Read `Sum of Quantity` off a PivotTable sheet's Grand Total row.
 *
 * The pivot's column order is not fixed — it is whatever the person who built the workbook dragged in
 * — so the quantity column is found by its HEADER ("Sum of Quantity") rather than by position, and the
 * value is taken from the row whose first cell reads "Grand Total".
 */
export function readPivotGrandTotalGallons(grid: readonly (readonly unknown[])[] | null | undefined): number | null {
  if (!Array.isArray(grid)) return null;
  const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  let qtyCol = -1;
  for (const row of grid) {
    if (!Array.isArray(row)) continue;
    const idx = row.findIndex((c) => norm(c) === "sumofquantity");
    if (idx >= 0) { qtyCol = idx; break; }
  }
  if (qtyCol < 0) return null;

  for (const row of grid) {
    if (!Array.isArray(row)) continue;
    if (norm(row[0]) !== "grandtotal") continue;
    const n = Number(String(row[qtyCol] ?? "").replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
