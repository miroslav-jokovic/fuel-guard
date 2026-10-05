import { z } from "zod";

/**
 * A fuel receipt the office keyed into the TMS's fuel-tax (IFTA) module by hand — cash, or a driver's
 * own card (IFTA-PRECISION-PLAN IP6, 0434).
 *
 * In McLeod it is `fuel_tax_history` with `source = 'F'`; that letter stops at the agent, and what
 * crosses the wire is what the row MEANS. It carries only what the source has: a truck, a state, a day
 * and gallons. No card, no price, no station — which is why it feeds the IFTA "fuel bought" side and
 * never `fuel_transactions` (0434's header).
 */
export const tmsFuelTaxReceiptSchema = z.object({
  /** `fuel_tax_history.id`, trimmed. Unique across every receipt (1,255 of 1,255, measured). */
  external_id: z.string().trim().min(1).max(40),
  company_id: z.string().trim().min(1).max(4).nullish(),
  tractor_unit: z.string().trim().min(1).max(16),
  /** Two- or three-letter jurisdiction code, upper-cased by the agent. */
  jurisdiction: z.string().trim().regex(/^[A-Z]{2,3}$/),
  /** The day on the receipt, YYYY-MM-DD — the date the IFTA quarter is cut on. */
  receipt_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gallons: z.number().min(0),
  /** When the office keyed it, ISO instant. */
  processed_at: z.string().nullish(),
  is_void: z.boolean().default(false),
});
export type TmsFuelTaxReceipt = z.infer<typeof tmsFuelTaxReceiptSchema>;

/** The wire envelope — same window convention as the other financial sweeps. */
export const tmsFuelTaxReceiptsPayloadSchema = z.object({
  receipts: z.array(tmsFuelTaxReceiptSchema).max(2000),
  window_start: z.string(),
  window_end: z.string(),
});
export type TmsFuelTaxReceiptsPayload = z.infer<typeof tmsFuelTaxReceiptsPayloadSchema>;
