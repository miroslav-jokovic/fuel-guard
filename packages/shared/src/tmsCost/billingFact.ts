import { z } from "zod";

/**
 * An invoiced freight bill — the earnings side, and the only money table that carries equipment
 * (program step P3.3, docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md; FINANCIAL-STORE-PLAN
 * §2). `billing_history` reconciles to GL module BILL on the receivable account one line per
 * invoice — 1,595 keys to 1,595 lines in June 2026 — and unlike every expense table it names
 * its tractor, trailer and driver, so revenue per truck needs no allocation rule and margin per
 * truck is answerable on the same terms as cost per mile.
 *
 * The three charge figures are held apart because they answer different questions: linehaul is
 * the lane's worth, accessorials are what went wrong or extra on the day, excise is the
 * government's. `invoiced_flag` is deliberately absent from this contract — it read 'N' on all
 * 1,640 June rows, so a filter built on it returns nothing (0257's measurement).
 *
 * ⚠ The agent-side sweep for this contract does not exist yet: 0257 recorded the FINDINGS of
 * the billing measurement but not the SELECT, and McLeod column names are never guessed here
 * (the trailer-type near-miss is what guessing costs). Recon questions F1/F2 in the agent's
 * inspect pack re-take the measurement; the sweep is written against their answers.
 */
export const tmsBillingFactSchema = z.object({
  external_id: z.string().min(1).max(32),
  company_id: z.string().min(1).max(4),

  invoice_no: z.string().trim().min(1).max(32).nullish(),
  customer_id: z.string().trim().min(1).max(8).nullish(),
  order_external_id: z.string().trim().min(1).max(32).nullish(),
  master_order_id: z.string().trim().min(1).max(32).nullish(),

  tractor_unit: z.string().trim().min(1).max(8).nullish(),
  trailer_unit: z.string().trim().min(1).max(8).nullish(),
  driver_external_id: z.string().trim().min(1).max(8).nullish(),

  /**
   * The dispatcher who booked the load — `orders.operations_user`, resolved to `users.name`.
   *
   * Measured against June 2026 before choosing: this join is 1:1, all 1,640 bills resolve, and the
   * revenue total survives it unchanged. The tempting alternative, `movement.dispatcher_user_id`,
   * is semantically closer but only reachable through `movement_order`, which FANS OUT — 1,640
   * bills become 3,408 rows and $5.49M becomes $11.49M. `billing_history.entered_user_id` is also
   * 100% populated but names the clerk who keyed the invoice, not the dispatcher. 0273's header
   * carries the full measurement.
   *
   * The id is McLeod's stable handle and survives a rename; the name is what a person reads.
   */
  dispatcher_user_id: z.string().trim().min(1).max(32).nullish(),
  dispatcher_name: z.string().trim().min(1).max(64).nullish(),

  /** The economic date (D-FS6/D-MC19): billing keys off the bill date, never the cash date. */
  bill_date: z.string().nullish(),
  ship_date: z.string().nullish(),
  delivery_date: z.string().nullish(),
  transfer_date: z.string().nullish(),

  total_charges: z.number().default(0),
  other_charge: z.number().default(0),
  excise_tax: z.number().default(0),

  /**
   * Staged verbatim; vocabulary unmeasured until recon F3 answers (2026-08-27). NO reader may
   * filter on these — the revenue predicate is the GL's own posting (post_key + BILL), which
   * 0257 measured: 1,595 of June's 1,640 rows posted one-line-per-invoice.
   */
  canceled: z.string().max(4).nullish(),
  rebilled: z.string().max(4).nullish(),

  /**
   * billing_history's own mileage assertion — a third measurement beside movement and Samsara.
   *
   * The two `billing_*` columns are EMPTY at this carrier: 0 of 1,640 posted June bills fill
   * either, so they join the list of McLeod distance columns that are always zero. `distance` is
   * the populated one (1,614 of 1,640, 1,513,720 June miles) and is what per-dispatcher revenue
   * per mile and weekly proration divide by (0275).
   */
  billing_loaded_distance: z.number().nonnegative().max(99_999).nullish(),
  billing_empty_distance: z.number().nonnegative().max(99_999).nullish(),
  distance: z.number().nonnegative().max(99_999).nullish(),

  /** The GL BILL key — the reconciliation join, one receivable line per invoice. */
  post_key: z.string().max(32).nullish(),
  post_module: z.string().max(4).nullish(),
});
export type TmsBillingFact = z.infer<typeof tmsBillingFactSchema>;

export const tmsBillingPayloadSchema = z.object({
  billing: z.array(tmsBillingFactSchema).max(2000),
  window_start: z.string(),
  window_end: z.string(),
});
export type TmsBillingPayload = z.infer<typeof tmsBillingPayloadSchema>;
