import { z } from "zod";

/**
 * Each sub-ledger tied to the general ledger ONE POSTING AT A TIME (TRUCK-DRIVER-PNL-PLAN §3 P0c).
 *
 * The ledger coverage report compares a month's module total with the sum of the staged rows behind
 * it. Two totals can agree while the rows under them do not — a missing $900 bill and an extra $900
 * credit cancel — and when they disagree, a total cannot say which bill is off. McLeod keys every
 * posting, and each key posts exactly one line to its control account (sandbox, July 2026: BILL
 * 1,522 of 1,522 on 12000000; SET 2,723 on 205000xx; SETV 46 on 20500010; FUEL 2,274 on 20550000),
 * so a join on the key is exact by construction, and every key that does not tie is an exception the
 * report can name.
 *
 * Pure: the caller hands in the month's key lines (0509) and its sub-ledger rows already summed per
 * key, through the module's own rules (`billRevenue`, `settlementsBookedBySet`, `isReversedBySetv`).
 */

/** One posting to one account on one day, summed — the wire's and the table's grain (0509). */
export const glKeyLineSchema = z.object({
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  post_module: z.string().trim().min(1).max(8),
  post_key: z.string().trim().min(1).max(40),
  glid: z.string().trim().min(1).max(20),
  lines: z.number().int().nonnegative(),
  net_amount: z.number(),
});
export type GlKeyLine = z.infer<typeof glKeyLineSchema>;

export const tmsLedgerKeyLinesPayloadSchema = z.object({
  /** First day of the month, YYYY-MM-DD. */
  period_start: z.string().regex(/^\d{4}-\d{2}-01$/),
  /** First day of the NEXT month — half-open, like every window in this integration. */
  period_end: z.string().regex(/^\d{4}-\d{2}-01$/),
  /** The McLeod company the month was swept for (D-FIN8). */
  company_id: z.string().min(1).max(4).nullish(),
  /**
   * The month's key lines for BILL, SET, SETV and FUEL. July 2026 is 15,183; the ceiling refuses a
   * runaway payload, it does not bound a normal one. One post per month, never batched: the month is
   * replaced whole, so half a month would delete the other half.
   */
  lines: z.array(glKeyLineSchema).max(60000),
});
export type TmsLedgerKeyLinesPayload = z.infer<typeof tmsLedgerKeyLinesPayloadSchema>;

/**
 * The bill receivable — where module BILL posts one line per bill. Silvicom's chart of accounts, like
 * `SETTLEMENT_PAYABLE_GLID_PREFIX`, not a McLeod constant: the two move together into configuration
 * before a second carrier is onboarded.
 */
export const BILL_RECEIVABLE_GLID = "12000000";

/**
 * One module's postings on its control account(s), per key, signed so they read like the sub-ledger:
 * the receivable as booked (+ invoice, − credit), the settlement payable's credit flipped to the pay
 * it accrued, the SETV reversal as the pay it took back.
 */
export function ledgerByKey(
  lines: readonly Pick<GlKeyLine, "post_module" | "post_key" | "glid" | "net_amount">[],
  post_module: string,
  isControl: (glid: string) => boolean,
  sign: 1 | -1,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    if (l.post_module !== post_module || !isControl(l.glid.trim())) continue;
    const key = l.post_key.trim();
    out.set(key, (out.get(key) ?? 0) + sign * Number(l.net_amount));
  }
  return out;
}

/** Sub-ledger rows summed per posting key; a row with no key cannot tie and is counted apart. */
export function subledgerByKey<T>(
  rows: readonly T[],
  keyOf: (r: T) => string | null | undefined,
  amountOf: (r: T) => number,
): { byKey: Map<string, number>; unkeyed: number } {
  const byKey = new Map<string, number>();
  let unkeyed = 0;
  for (const r of rows) {
    const key = keyOf(r)?.trim();
    if (!key) {
      unkeyed += 1;
      continue;
    }
    byKey.set(key, (byKey.get(key) ?? 0) + amountOf(r));
  }
  return { byKey, unkeyed };
}

export interface KeyTieException {
  post_key: string;
  /** Null when the ledger has no line on the control account for this key in the period. */
  ledger: number | null;
  /** Null when no staged row carries this key in the period. */
  subledger: number | null;
  difference: number;
}

export interface KeyTie {
  post_module: string;
  /** Keys present on either side. */
  keys: number;
  /** Keys whose two sides agree to the cent. */
  matched: number;
  /** Keys on both sides that disagree, and by how much in total (sub-ledger − ledger). */
  mismatched: { count: number; difference: number };
  /** Ledger postings with no staged row in the period — a row the sweep missed, or one dated elsewhere. */
  ledgerOnly: { count: number; amount: number };
  /** Staged rows with no ledger posting in the period. */
  subledgerOnly: { count: number; amount: number };
  /** Staged rows with no posting key at all. They cannot tie, and are not silently dropped. */
  unkeyed: number;
  /** True only when every key ties and no row is unkeyed. */
  tied: boolean;
  /** The largest exceptions first, at most `EXCEPTION_LIMIT` — what a reader goes and looks at. */
  exceptions: KeyTieException[];
}

export const EXCEPTION_LIMIT = 25;

const cents = (n: number) => Math.round(n * 100) / 100 + 0;

/**
 * Tie one module per key. A key whose sub-ledger total is $0.00 and that posted nothing is not an
 * exception: a zero-value settlement posts no ledger line at all (14 of June 2026's rows, D-MC23).
 */
export function tieByPostingKey(
  post_module: string,
  ledger: ReadonlyMap<string, number>,
  subledger: ReadonlyMap<string, number>,
  unkeyed = 0,
): KeyTie {
  const keys = new Set([...ledger.keys(), ...subledger.keys()]);
  let matched = 0;
  const mismatched = { count: 0, difference: 0 };
  const ledgerOnly = { count: 0, amount: 0 };
  const subledgerOnly = { count: 0, amount: 0 };
  const exceptions: KeyTieException[] = [];

  for (const key of keys) {
    const l = ledger.has(key) ? cents(ledger.get(key)!) : null;
    const s = subledger.has(key) ? cents(subledger.get(key)!) : null;
    if (l === null && s === 0) {
      matched += 1;
      continue;
    }
    if (l !== null && s !== null && l === s) {
      matched += 1;
      continue;
    }
    const difference = cents((s ?? 0) - (l ?? 0));
    if (l === null) {
      subledgerOnly.count += 1;
      subledgerOnly.amount = cents(subledgerOnly.amount + s!);
    } else if (s === null) {
      ledgerOnly.count += 1;
      ledgerOnly.amount = cents(ledgerOnly.amount + l);
    } else {
      mismatched.count += 1;
      mismatched.difference = cents(mismatched.difference + difference);
    }
    exceptions.push({ post_key: key, ledger: l, subledger: s, difference });
  }

  exceptions.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.post_key.localeCompare(b.post_key));
  return {
    post_module,
    keys: keys.size,
    matched,
    mismatched,
    ledgerOnly,
    subledgerOnly,
    unkeyed,
    tied: matched === keys.size && unkeyed === 0,
    exceptions: exceptions.slice(0, EXCEPTION_LIMIT),
  };
}
