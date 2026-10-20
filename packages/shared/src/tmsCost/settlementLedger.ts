/**
 * Driver pay as the general ledger books it (TRUCK-DRIVER-PNL-PLAN §1.3 D3, Q-TP6 ruled 2026-10-19:
 * a driver's pay is what the GL books, not what `total_pay` says the payee received).
 *
 * McLeod posts settlement pay through two GL modules, and both are reproduced from `drs_settle_hist`
 * by one rule, measured on the sandbox 2026-10-19 (company TMS, May–August 2026):
 *
 *  · **SET** posts `orig_posted_pay` (staged as `posted_pay`) on the ACCRUAL date, once per
 *    `accrual_key`. A key carried by several rows — a voided row and its re-issue, 302 keys in June —
 *    posts the live row only: 302 of 302 exact. A key carried by one row posts that row, voided or
 *    not: 2,569 of 2,569. So a void does not un-post its accrual; it is reversed separately.
 *  · **SETV** reverses a voided row that had been transferred (it carries a `post_key`) on its VOID
 *    date, for −`posted_pay`: 46 of 46 July keys exact, and the month to the cent in all four months
 *    (May −34,420.33, Jun −118,641.54, Jul −47,338.00, Aug −114,996.83).
 *
 * What the rule cannot reproduce is GL "Payable from Settlement" lines with no settlement row at all,
 * $1.1k–$8.2k a month. That residual is reported by name (the ledger coverage's SET claim), never
 * absorbed. `total_pay` misses the ledger by 3–7% a month; it remains what the payee received and is
 * still staged, but no reader that must add up to the income statement uses it.
 *
 * Rows sharing an `accrual_key` share its accrual date — the key IS the accrual posting — so a reader
 * that windows on `accrued_at` sees every row of a key together and can group within the window.
 */

type Money = number | string | null | undefined;

const money = (v: Money): number => (v == null ? 0 : Number(v));

export interface LedgerSettlementRow {
  accrual_key?: string | null;
  is_void: boolean;
  posted_pay: Money;
}

export interface ReversibleSettlementRow {
  is_void: boolean;
  post_key?: string | null;
  transferred_at?: string | null;
  void_date?: string | null;
  posted_pay: Money;
}

/**
 * The rows GL module SET books: every live row, and a voided row when it is the only row on its
 * `accrual_key`. A voided row whose key also carries its re-issue is the one row SET does not book.
 * A row without an accrual key is its own key.
 */
export function settlementsBookedBySet<T extends LedgerSettlementRow>(rows: readonly T[]): T[] {
  const rowsPerKey = new Map<string, number>();
  for (const r of rows) {
    const key = r.accrual_key?.trim();
    if (key) rowsPerKey.set(key, (rowsPerKey.get(key) ?? 0) + 1);
  }
  return rows.filter((r) => {
    if (!r.is_void) return true;
    const key = r.accrual_key?.trim();
    return !key || rowsPerKey.get(key) === 1;
  });
}

/**
 * A voided settlement that GL module SETV reverses: it had been transferred (a `post_key` and a
 * transfer date) before it was voided. One voided before transfer never reached the payable's
 * payment side, and SETV posts nothing for it.
 */
export function isReversedBySetv(s: ReversibleSettlementRow): boolean {
  return s.is_void && Boolean(s.post_key?.trim()) && s.transferred_at != null;
}

/** What SET books for a row it books: `posted_pay`, rounded to the cent. */
export function settlementBookedPay(s: { posted_pay: Money }): number {
  return Math.round(money(s.posted_pay) * 100) / 100;
}

/** What SETV books for a reversed row: the row's `posted_pay`, negative. */
export function settlementReversalPay(s: { posted_pay: Money }): number {
  return -settlementBookedPay(s);
}
