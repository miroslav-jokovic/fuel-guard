/**
 * Fuel-spend analytics — the shared row shape (pure, dataset-free).
 *
 * Deliberately STRUCTURAL rather than tied to one source. The same questions ("how much at ONE9", "what
 * did California cost", "why is spend up") have to be answerable from a parsed vendor statement, from
 * `fuel_statement_lines` read back months later, and from `fuel_transactions` fed by the EFS API. A
 * `StatementLine` already satisfies this shape; a database projection is a `.map()`.
 *
 * MONEY CONVENTION, and it is load-bearing:
 *   `netAmount`    = FUEL ONLY. What `fuel_transactions.total_cost` holds, and what a per-gallon price
 *                    must be computed from.
 *   `retailAmount` = posted price × gallons, before the contract discount.
 *   `miscAmount` / `salesTax` = non-fuel charges on the SAME ticket. A fuel line can carry them (Pilot
 *                    bills in-store purchases on the fuel ticket), which is why they are separate
 *                    fields and not folded into `netAmount`.
 * The discount is `retailAmount − netAmount`. The vendor's own `Savings Total` is
 * `retail − (fuel + misc + tax)`; that difference is exactly the bundled charges, so a savings figure
 * computed the wrong way is off by them — see `pilotStatementTieOut`.
 */

/** Which physical tank a line filled. Reefer diesel is dyed, off-road, and must never be scored as tractor fuel. */
export type SpendTank = "tractor" | "reefer" | "none";

export interface SpendLine {
  /** Station-local business date, YYYY-MM-DD. Lines without one are excluded from every time series. */
  tranDate: string | null;
  /** Canonical brand slug (`pilot`, `flying_j`, `one9`, …) or null for an unresolved / independent site. */
  brand: string | null;
  state: string | null;
  /** Chain store number, leading zeros stripped. */
  site: string | null;
  city: string | null;
  unit: string | null;
  /** The name printed in the vendor's P.O. field. Not a link to `drivers`. */
  driver: string | null;
  product: "diesel" | "def" | "other";
  tank: SpendTank | null;
  gallons: number;
  netAmount: number | null;
  retailAmount: number | null;
  miscAmount?: number | null;
  salesTax?: number | null;
}

/** Propulsion fuel actually burned by a tractor — the basis for every $/gal figure in this module. */
export const isTractorFuel = (l: SpendLine): boolean =>
  l.product === "diesel" && l.tank !== "reefer" && l.gallons > 0 && l.netAmount != null;

export interface SpendTotals {
  lines: number;
  gallons: number;
  net: number;
  retail: number;
  /** retail − net, in dollars. */
  discount: number;
  /** net ÷ gallons. Null when no gallons — never 0, which would read as free fuel. */
  netPerGal: number | null;
  retailPerGal: number | null;
  discountPerGal: number | null;
  /** discount ÷ retail — how much of the posted price the contract took off. */
  capturePct: number | null;
}

export function totalsOf(lines: readonly SpendLine[]): SpendTotals {
  let gallons = 0;
  let net = 0;
  let retail = 0;
  for (const l of lines) {
    gallons += l.gallons;
    net += l.netAmount ?? 0;
    retail += l.retailAmount ?? 0;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    lines: lines.length,
    gallons: Math.round(gallons * 1000) / 1000,
    net: r2(net),
    retail: r2(retail),
    discount: r2(retail - net),
    netPerGal: gallons > 0 ? net / gallons : null,
    retailPerGal: gallons > 0 ? retail / gallons : null,
    discountPerGal: gallons > 0 ? (retail - net) / gallons : null,
    capturePct: retail > 0 ? (retail - net) / retail : null,
  };
}

/** Group lines by a key, dropping those the key can't classify. */
export function groupBy<K extends string>(
  lines: readonly SpendLine[],
  key: (l: SpendLine) => K | null,
): Map<K, SpendLine[]> {
  const out = new Map<K, SpendLine[]>();
  for (const l of lines) {
    const k = key(l);
    if (k == null) continue;
    const bucket = out.get(k);
    if (bucket) bucket.push(l);
    else out.set(k, [l]);
  }
  return out;
}

/** Monday-start week key (YYYY-MM-DD) for a business date. Vendor statements run Mon–Sun. */
export function weekOf(ymd: string, weekStartsOn: 0 | 1 = 1): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  const shift = (d.getUTCDay() - weekStartsOn + 7) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}
