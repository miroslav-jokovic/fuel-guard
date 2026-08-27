import { z } from "zod";
import type { TmsLedgerLine } from "./fuelFact.js";

/**
 * Driver and owner-operator settlement — the second-largest truck-attributable cost after fuel, and
 * the one with the most ways to be counted wrong.
 *
 * D-MC13 is the governing rule and it is load-bearing here: settlement, payroll, checks and the
 * general ledger are FOUR LIFECYCLE VIEWS OF ONE PAYMENT. They must never be summed. This file models
 * the settlement view only, tags the lifecycle stage explicitly, and leaves `drs_payroll_hist` and
 * `drs_check` to their own extractions so that nothing downstream can add a payment to itself.
 *
 * The lifecycle is visible in the source: every row carries `accrual_module = 'SET'` and
 * `post_module = 'DRS'`. The work accrues under one GL module and the money leaves under another.
 * Reconciling against the wrong one silently compares two different months.
 *
 * Unlike fuel and vouchers there is NO live twin — `drs_settle` does not exist, only
 * `drs_settle_hist`. D-MC11's live/`_hist` union therefore does not apply to this domain, and a
 * future reader should not "fix" its absence.
 */

/** Which payments a figure represents. Never mix two in one sum. */
export const SETTLEMENT_STAGES = ["accrual", "paid"] as const;
export type SettlementStage = (typeof SETTLEMENT_STAGES)[number];

/**
 * Who is being paid, and why it cannot be pooled.
 *
 * `C` is a company driver: the carrier owns the truck and the settlement is wages for driving it.
 * `O` is an owner-operator: the settlement buys the whole trip — truck, fuel, maintenance and labour
 * — from a contractor. Measured over 2026, `C` averages $378 a row against `O`'s $2,932. Pooling them
 * produces a cost per mile that describes no truck in the fleet.
 */
export const SETTLEMENT_PAYEE_TYPES = ["company_driver", "owner_operator", "other"] as const;
export type SettlementPayeeType = (typeof SETTLEMENT_PAYEE_TYPES)[number];

export const tmsSettlementFactSchema = z.object({
  external_id: z.string().min(1).max(32),
  company_id: z.string().min(1).max(4),

  /** Attribution is total here: 20,833 of 20,833 rows in 2026 carry both a tractor and a movement. */
  tractor_unit: z.string().trim().min(1).max(8).nullish(),
  trailer_unit: z.string().trim().min(1).max(8).nullish(),
  driver_external_id: z.string().trim().min(1).max(8).nullish(),
  movement_external_id: z.string().trim().min(1).max(32).nullish(),
  order_external_id: z.string().trim().min(1).max(8).nullish(),

  payee_id: z.string().trim().min(1).max(8).nullish(),
  payee_type: z.enum(SETTLEMENT_PAYEE_TYPES).default("other"),
  pay_method: z.string().max(1).nullish(),

  /**
   * The economic date — when the work was done and the cost incurred (D-MC19). This is what CPM
   * buckets by. `paid_at` is cash timing and belongs to cash-flow questions only.
   */
  accrued_at: z.string().nullish(),
  paid_at: z.string().nullish(),
  transferred_at: z.string().nullish(),

  /**
   * What the payee ultimately received, and therefore the carrier's real cost. Use this for CPM.
   *
   * NOT the figure that reconciles — see `posted_pay`. The two differ on owner-operator rows where an
   * adjustment landed after the accrual posted: $5,671.57 across June 2026.
   */
  total_pay: z.number().default(0),

  /**
   * What the general ledger recorded when the settlement accrued, and the only figure that ties to
   * it. Reconciliation uses this; cost per mile does not.
   */
  posted_pay: z.number().default(0),

  /** McLeod's own pay basis. Tracks movement distance closely but is NOT the CPM denominator (D-MC17). */
  pay_distance: z.number().nonnegative().max(99_999).nullish(),

  /** The accrual-side GL key (`accrual_key`, module `SET`). The reconciliation join. */
  accrual_key: z.string().max(32).nullish(),
  /** The payment-side GL key (`post_key`, module `DRS`). Kept for cash-flow tracing, not for CPM. */
  post_key: z.string().max(32).nullish(),
});
export type TmsSettlementFact = z.infer<typeof tmsSettlementFactSchema>;

export const tmsSettlementsPayloadSchema = z.object({
  settlements: z.array(tmsSettlementFactSchema).max(2000),
  window_start: z.string(),
  window_end: z.string(),
});
export type TmsSettlementsPayload = z.infer<typeof tmsSettlementsPayloadSchema>;

/**
 * A deduction taken out of a settlement — escrow, insurance, advances, equipment rent.
 *
 * Its own fact table, never a field on the settlement, because a deduction is money moving the other
 * way and the two have different void states: a settlement can stand while one of its deductions is
 * reversed. Attribution is partial and honestly so — 317 of 699 June `D` rows carry a tractor.
 */
export const tmsDeductionFactSchema = z.object({
  external_id: z.string().min(1).max(32),
  company_id: z.string().min(1).max(4),
  payee_id: z.string().trim().min(1).max(8).nullish(),
  payee_type: z.enum(SETTLEMENT_PAYEE_TYPES).default("other"),
  tractor_unit: z.string().trim().min(1).max(8).nullish(),
  deduct_code: z.string().max(8).nullish(),
  deduction_type: z.string().max(1).nullish(),
  transacted_at: z.string().nullish(),
  amount: z.number().default(0),
  accrual_key: z.string().max(32).nullish(),
});
export type TmsDeductionFact = z.infer<typeof tmsDeductionFactSchema>;

/** The wire envelope for a deductions sweep — same window convention as the settlements payload. */
export const tmsDeductionsPayloadSchema = z.object({
  deductions: z.array(tmsDeductionFactSchema).max(2000),
  window_start: z.string(),
  window_end: z.string(),
});
export type TmsDeductionsPayload = z.infer<typeof tmsDeductionsPayloadSchema>;

export interface SettlementReconciliation {
  /** `posted_pay` summed over the extracted settlements. */
  extracted: number;
  ledger: number;
  difference: number;
  settlements: number;
  /** Settlements with a non-zero posted amount that reach no ledger line. */
  unmatchedSettlements: number;
  unmatchedLedgerKeys: number;
  balanced: boolean;
}

/**
 * The accounts the settlement payable lands in, on the accrual side.
 *
 * `20500010` is the company-driver payable and `20500020` the owner-operator one; the prefix covers
 * both. As with fuel this is Silvicom's chart of accounts, not a McLeod constant, and belongs in
 * configuration before a second carrier is onboarded.
 */
export const SETTLEMENT_PAYABLE_GLID_PREFIX = "205000";

/**
 * Prove the settlement extraction is complete against the carrier's own books.
 *
 * Three things about this are easy to get wrong and each returns a plausible wrong number:
 *
 *  · **Join on `accrual_key`, not `post_key`.** The accrual is where the cost is recognised, and it
 *    is the posting with exactly one payable line per settlement row — 2,751 keys to 2,751 lines in
 *    June 2026. The payment side fans out across cash and clearing accounts and does not.
 *  · **Compare `posted_pay`, not `total_pay`.** June's payable was $1,262,893.74, matching
 *    `orig_posted_pay` exactly. `total_pay` was $1,268,565.31 — a $5,671.57 gap that is real money
 *    the payee received, and still not what the ledger recorded at accrual.
 *  · **Exclude voids before calling this.** 909 of June's 3,363 rows are voided, carrying $335,846.70
 *    of pay that never happened (D-MC18). They are filtered in SQL, not here, so a caller who hands
 *    this function voided rows gets a failed reconciliation rather than a silent overstatement.
 */
export function reconcileSettlementToLedger(
  settlements: TmsSettlementFact[],
  ledgerLines: TmsLedgerLine[],
  glidPrefix: string = SETTLEMENT_PAYABLE_GLID_PREFIX,
): SettlementReconciliation {
  const payableByKey = new Map<string, number>();
  for (const line of ledgerLines) {
    if (!line.glid.startsWith(glidPrefix)) continue;
    payableByKey.set(line.post_key, (payableByKey.get(line.post_key) ?? 0) + line.amount);
  }

  let extracted = 0;
  let unmatchedSettlements = 0;
  const seenKeys = new Set<string>();

  for (const s of settlements) {
    extracted += s.posted_pay;
    if (s.accrual_key && payableByKey.has(s.accrual_key)) seenKeys.add(s.accrual_key);
    // A zero-value settlement posts no ledger line at all — 14 of June's rows. Counting those as
    // unmatched would fail a reconciliation that is in fact exact.
    else if (s.posted_pay !== 0) unmatchedSettlements++;
  }

  // The accrual payable is a credit, so the ledger's own sign is negative. Flip once, here.
  let ledger = 0;
  for (const amount of payableByKey.values()) ledger += -amount;

  const round = (n: number) => Math.round(n * 100) / 100;
  const difference = round(extracted - ledger);

  return {
    extracted: round(extracted),
    ledger: round(ledger),
    difference,
    settlements: settlements.length,
    unmatchedSettlements,
    unmatchedLedgerKeys: payableByKey.size - seenKeys.size,
    balanced: difference === 0 && unmatchedSettlements === 0 && payableByKey.size === seenKeys.size,
  };
}

export interface SettlementCostByTruck {
  tractor_unit: string;
  payee_type: SettlementPayeeType;
  settlements: number;
  total_pay: number;
}

/**
 * Settlement cost per truck, kept split by payee type.
 *
 * The split is the whole point (D-MC20). An owner-operator settlement bundles the truck, its fuel and
 * its maintenance into one number; a company-driver settlement is wages against costs the carrier
 * pays separately. Adding them gives a figure that is neither.
 *
 * `total_pay` rather than `posted_pay`, because this answers what the truck cost, not what the ledger
 * recorded at accrual.
 */
export function settlementCostByTruck(settlements: TmsSettlementFact[]): SettlementCostByTruck[] {
  const byKey = new Map<string, SettlementCostByTruck>();
  for (const s of settlements) {
    if (!s.tractor_unit) continue;
    const key = `${s.tractor_unit} ${s.payee_type}`;
    const row = byKey.get(key);
    if (row) {
      row.settlements++;
      row.total_pay = Math.round((row.total_pay + s.total_pay) * 100) / 100;
    } else {
      byKey.set(key, {
        tractor_unit: s.tractor_unit,
        payee_type: s.payee_type,
        settlements: 1,
        total_pay: Math.round(s.total_pay * 100) / 100,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => b.total_pay - a.total_pay);
}
