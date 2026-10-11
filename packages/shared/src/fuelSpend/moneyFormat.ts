/**
 * Money and volume formatting for the Fuel Costs figures, in ONE place so the screen and the PDF print the
 * same string for the same number (Q-FSV14: the document must equal the screen). Moved from
 * `apps/web/.../reconcile/format.ts`, which now re-exports these four.
 */
export const usd = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * `usd` for a NET figure that can land a few cents either side of zero — paid vs Pilot quote nets over-
 * and under-billed fills. `usd(-0.3)` prints "-$0" (seen in the browser against September's real sums,
 * FS2); a figure that rounds to nothing reads as "$0".
 */
export const wholeUsd = (n: number | null | undefined): string => (n == null ? "—" : usd(Math.round(n) === 0 ? 0 : n));

/**
 * Dollars and cents, for ONE purchase rather than a total — a fill's amount is compared against the EFS
 * statement line by line, and a rounded row would never match it. Moved from the reconcile feature's
 * `format.ts` (F02-F04 chunk 11b) so the Fuel Log can read the same string without importing another
 * feature's internals.
 */
export const usd2 = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Per-gallon prices carry three decimals — a tenth of a cent is $200/year on this fleet's volume. */
export const usd3 = (n: number | null | undefined): string => (n == null ? "—" : `$${n.toFixed(3)}`);

export const gal = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
