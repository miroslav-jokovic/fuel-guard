import { z } from "zod";

/**
 * An accounts-payable voucher — the carrier's non-fuel, non-settlement spend.
 *
 * This is the deliberately UNATTRIBUTED half of cost per mile, and the contract says so in its shape:
 * there is no `tractor_unit` field, because `voucher_hist` has no tractor column and no movement key.
 * Its only operational link is `purchase_order_no`. Insurance, permits, tolls billed by a vendor,
 * office rent and everything else arrive as a vendor, an amount and a GL account.
 *
 * That is not a gap to be papered over. Under D-MC12 the extraction never invents an attribution
 * McLeod does not assert, so these rows land in FuelGuard carrying their `ap_glid` and vendor intact
 * and the CPM harness applies the carrier's allocation rules to them. An agent that guessed at a truck
 * here would produce a number nobody could trace back to a source document.
 *
 * Note what is NOT in this file. `other_charge` looks like an expense table and is not: measured
 * 2026-08-26, its rows are `FSC` fuel surcharge, `DET` detention, `LUM` lumper, `TON`, `STO` stop-off
 * and similar, every one of them carrying a `customer_id`, a `bill_type` and `is_taxable`. It is
 * accessorial REVENUE billed on an order. Importing it as cost would subtract the carrier's own
 * earnings from its margin twice.
 */
export const tmsApVoucherFactSchema = z.object({
  external_id: z.string().min(1).max(32),
  company_id: z.string().min(1).max(4),

  voucher_no: z.number().int().nullish(),
  voucher_type: z.string().max(4).nullish(),
  vendor_id: z.string().trim().min(1).max(8).nullish(),
  invoice_number: z.string().max(20).nullish(),
  purchase_order_no: z.string().max(12).nullish(),
  description: z.string().max(200).nullish(),

  invoice_date: z.string().nullish(),
  due_date: z.string().nullish(),
  /** When the voucher hit the ledger — the economic date, matching D-MC19's reasoning on settlement. */
  distribution_date: z.string().nullish(),

  amount: z.number().default(0),
  discount_amount: z.number().default(0),

  /**
   * The expense account. This is the ONLY thing that says what the money was for, so it is the input
   * the harness's allocation rules key off — there is no category field and no equipment link.
   */
  ap_glid: z.string().max(20).nullish(),

  is_paid: z.boolean().default(false),
  check_number: z.string().max(12).nullish(),

  post_key: z.string().max(32).nullish(),
  post_module: z.string().max(4).nullish(),
});
export type TmsApVoucherFact = z.infer<typeof tmsApVoucherFactSchema>;

export const tmsApVouchersPayloadSchema = z.object({
  vouchers: z.array(tmsApVoucherFactSchema).max(2000),
  window_start: z.string(),
  window_end: z.string(),
});
export type TmsApVouchersPayload = z.infer<typeof tmsApVouchersPayloadSchema>;

/** What the harness will allocate, grouped the only way the source data allows. */
export interface ApSpendByAccount {
  ap_glid: string;
  vouchers: number;
  amount: number;
}

/**
 * Roll vouchers up by expense account.
 *
 * Not an allocation — an inventory. It answers "what buckets of unattributed cost exist, and how big
 * are they", which is the question finance has to answer before it can sign off an allocation rule.
 * Vouchers with no account are grouped under `(unclassified)` rather than dropped, because a bucket of
 * cost nobody can categorise is exactly the thing a reviewer needs to see.
 */
export function summarizeApSpendByAccount(vouchers: TmsApVoucherFact[]): ApSpendByAccount[] {
  const byAccount = new Map<string, ApSpendByAccount>();
  for (const v of vouchers) {
    const key = v.ap_glid?.trim() || "(unclassified)";
    const row = byAccount.get(key);
    if (row) {
      row.vouchers++;
      row.amount = Math.round((row.amount + v.amount) * 100) / 100;
    } else {
      byAccount.set(key, { ap_glid: key, vouchers: 1, amount: Math.round(v.amount * 100) / 100 });
    }
  }
  return [...byAccount.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}
