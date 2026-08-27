import { z } from "zod";

/**
 * One fuel purchase as McLeod settled it — the largest truck-attributable cost in the CPM model.
 *
 * This does NOT demote EFS. EFS remains authoritative for what was purchased on a card; McLeod's copy
 * exists here for two things EFS cannot give us:
 *
 *  · **Reconciliation.** Every row carries the `post_key` it posted to the general ledger under, so an
 *    extraction can prove itself complete against the carrier's own books rather than against another
 *    integration's opinion (D-MC12).
 *  · **The reefer and DEF split.** McLeod breaks a single pump transaction into tractor, reefer, DEF,
 *    oil and misc components. EFS reports the transaction. Silvicom 360's reefer logic has been inferring
 *    that split; here it is stated.
 *
 * Attribution is complete, which is why this is worth extracting at all. Measured over June 2026:
 * 2,259 of 2,259 rows carry a tractor, a driver and a purchase state, and 2,257 carry a movement.
 * Compare `gl_ledger`, where the equipment column is populated on none of 188,179 lines.
 */

/**
 * Gallons, split by what they went into.
 *
 * Kept as a nested object rather than five sibling scalars because they are not interchangeable and
 * summing them is almost always a bug: reefer gallons burn in a trailer, DEF is an emissions
 * consumable, and only `tractor` belongs in a miles-per-gallon figure for the truck.
 */
export const tmsFuelGallonsSchema = z.object({
  tractor: z.number().nonnegative().max(1_000_000).default(0),
  reefer: z.number().nonnegative().max(1_000_000).default(0),
  def: z.number().nonnegative().max(1_000_000).default(0),
  other: z.number().nonnegative().max(1_000_000).default(0),
});
export type TmsFuelGallons = z.infer<typeof tmsFuelGallonsSchema>;

/** Cost components. Same reasoning as gallons — reported separately, never pre-summed by the agent. */
export const tmsFuelCostsSchema = z.object({
  tractor: z.number().default(0),
  reefer: z.number().default(0),
  def: z.number().default(0),
  oil: z.number().default(0),
  misc: z.number().default(0),
  sales_tax: z.number().default(0),
  transaction_fee: z.number().default(0),
});
export type TmsFuelCosts = z.infer<typeof tmsFuelCostsSchema>;

export const tmsFuelPurchaseFactSchema = z.object({
  external_id: z.string().min(1).max(32),
  company_id: z.string().min(1).max(4),

  tractor_unit: z.string().trim().min(1).max(8).nullish(),
  driver_external_id: z.string().trim().min(1).max(8).nullish(),
  movement_external_id: z.string().trim().min(1).max(32).nullish(),
  order_external_id: z.string().trim().min(1).max(8).nullish(),

  purchased_at: z.string().nullish(),
  /** `truck_stop_state`. The IFTA dimension, and a cross-check against Silvicom 360's own fuelTax logic. */
  state: z.string().max(2).nullish(),
  truck_stop_name: z.string().max(60).nullish(),
  truck_stop_city: z.string().max(60).nullish(),
  card_id: z.string().max(20).nullish(),

  // Spelled out rather than `.default({})`: zod v4 requires a default to satisfy the OUTPUT type,
  // and the output of a schema whose every field has a default is a fully-populated object.
  gallons: tmsFuelGallonsSchema.default({ tractor: 0, reefer: 0, def: 0, other: 0 }),
  costs: tmsFuelCostsSchema.default({
    tractor: 0, reefer: 0, def: 0, oil: 0, misc: 0, sales_tax: 0, transaction_fee: 0,
  }),

  /** Gross, before the fuel-card discount is applied. NOT what the carrier actually owed. */
  total_amount: z.number().default(0),
  /** The negotiated discount. Ran 14.6% of gross in June 2026 — far too large to ignore. */
  fuel_discount: z.number().default(0),

  /**
   * What actually hit the ledger, and therefore the only figure that reconciles.
   *
   * McLeod splits this across `direct_amount` (billed directly, 1,904 of 2,259 June rows) and
   * `funded_amount` (funded through the card programme, the remaining 355). Exactly one is non-zero
   * per row, and together they reproduce the GL payable to the cent — see `reconcileFuelToLedger`.
   * The agent collapses the two, because which funding path a purchase took is a treasury question,
   * not a cost-per-mile one.
   */
  settled_amount: z.number().default(0),

  /** The GL join key. `post_module` is 'FUEL' for every row this query returns. */
  post_key: z.string().max(32).nullish(),
  post_module: z.string().max(4).nullish(),
});
export type TmsFuelPurchaseFact = z.infer<typeof tmsFuelPurchaseFactSchema>;

export const tmsFuelPurchasesPayloadSchema = z.object({
  purchases: z.array(tmsFuelPurchaseFactSchema).max(2000),
  window_start: z.string(),
  window_end: z.string(),
});
export type TmsFuelPurchasesPayload = z.infer<typeof tmsFuelPurchasesPayloadSchema>;

/** One general-ledger line, reduced to what reconciliation needs. */
export interface TmsLedgerLine {
  post_key: string;
  glid: string;
  amount: number;
}

export interface FuelReconciliation {
  /** `settled_amount` summed over the extracted purchases. */
  extracted: number;
  /** The ledger's own total for the same purchases, sign-flipped out of its credit balance. */
  ledger: number;
  /** extracted − ledger. Zero is the pass condition. */
  difference: number;
  purchases: number;
  /** Purchases whose `post_key` appears on no ledger line — extracted money the books do not show. */
  unmatchedPurchases: number;
  /** Ledger lines with no purchase behind them — money the books show that we did not extract. */
  unmatchedLedgerKeys: number;
  balanced: boolean;
}

/**
 * The account the fuel payable lands in.
 *
 * Reconciling against the whole `FUEL` module would always net to zero — it is double-entry, so the
 * expense debit and the payable credit cancel, and a query that "balances" would prove nothing at all.
 * The payable leg is the one with exactly one line per fuel transaction (2,259 lines for 2,259
 * purchases in June 2026), which is what makes a per-key comparison meaningful.
 *
 * Carrier-specific by nature: it is Silvicom's chart of accounts, not a McLeod constant. It belongs in
 * configuration before a second carrier is onboarded, and is exported so a caller can override it.
 */
export const FUEL_PAYABLE_GLID_PREFIX = "20550000";

/**
 * Prove the extraction is complete by checking it against the carrier's own books.
 *
 * Passing means every dollar of fuel the ledger recorded in this window is a dollar we extracted, and
 * vice versa. It is the difference between an integration that looks like it works and one that has
 * been shown to (D-MC12: the GL is the control total, never an input to attribution).
 *
 * Rounded to cents before comparison — both sides are decimals crossing a JSON boundary, and an
 * IEEE-754 tail of 1e-10 is not a reconciliation failure.
 */
export function reconcileFuelToLedger(
  purchases: TmsFuelPurchaseFact[],
  ledgerLines: TmsLedgerLine[],
  glidPrefix: string = FUEL_PAYABLE_GLID_PREFIX,
): FuelReconciliation {
  const payableByKey = new Map<string, number>();
  for (const line of ledgerLines) {
    if (!line.glid.startsWith(glidPrefix)) continue;
    payableByKey.set(line.post_key, (payableByKey.get(line.post_key) ?? 0) + line.amount);
  }

  let extracted = 0;
  let unmatchedPurchases = 0;
  const seenKeys = new Set<string>();

  for (const p of purchases) {
    extracted += p.settled_amount;
    if (p.post_key && payableByKey.has(p.post_key)) seenKeys.add(p.post_key);
    else unmatchedPurchases++;
  }

  // The payable is carried as a credit, so the ledger's own sign is negative. Flip it once, here,
  // rather than leaving every caller to remember which way round a liability sits.
  let ledger = 0;
  for (const amount of payableByKey.values()) ledger += -amount;

  const round = (n: number) => Math.round(n * 100) / 100;
  const difference = round(extracted - ledger);

  return {
    extracted: round(extracted),
    ledger: round(ledger),
    difference,
    purchases: purchases.length,
    unmatchedPurchases,
    unmatchedLedgerKeys: payableByKey.size - seenKeys.size,
    balanced: difference === 0 && unmatchedPurchases === 0 && payableByKey.size === seenKeys.size,
  };
}
