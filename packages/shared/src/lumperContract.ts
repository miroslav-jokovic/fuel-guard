import { z } from "zod";

/**
 * The lumper feed's wire contract — `POST /api/tms/lumper` (LUMPER-REVISED-RC-PLAN.md LRC2, D-LRC8).
 * One sweep of the four facts a lumper case is built from, as `tools/mcleod-agent/lumper.mjs` reads
 * them, for the `mcleod_lumper_*` tables (0600).
 *
 * ── EVERY KEY IS REQUIRED, NULL IS THE ONLY WAY TO SAY "NONE" ──────────────────────────────────────
 * Same rule as the dispatch mirror: the sweep REPLACES what 360 holds, so a connector that forgets a
 * field must fail here with the field's name, never write null over a value McLeod still has.
 *
 * ── ONE SWEEP IS ONE REQUEST ───────────────────────────────────────────────────────────────────────
 * The write deletes what the sweep no longer holds, so the four lists cannot be sent in pieces: half a
 * sweep would read as "the other half was removed". Measured for 90 days: 87 orders, 90 charges, 170
 * settlement lines, 109 bills. The ceilings below are about twenty times that, and are there to refuse
 * a connector gone wrong, not to page a real sweep.
 *
 * ── TIMES ──────────────────────────────────────────────────────────────────────────────────────────
 * McLeod's wall time labelled `Z`, as the finance feeds send it. Every one of these is a calendar
 * date in practice (a transaction date, a bill date); 360 shows the date and never an hour.
 */

const text = z.string().trim().min(1).nullable();
const instant = z.iso.datetime().nullable();
const id = z.string().trim().min(1).max(64);
const money = z.number().finite();

export const lumperOrderSchema = z.object({
  order_external_id: id,
  company_id: z.string().trim().min(1),
  order_status: text,
  ordered_at: instant,
  bill_date: instant,
  customer_id: text,
  customer_name: text,
  dispatcher_user_id: text,
  dispatcher_name: text,
  movement_external_id: text,
  consignee_name: text,
  consignee_city: text,
  consignee_state: text,
  consignee_arrived_at: instant,
  consignee_departed_at: instant,
});
export type LumperOrder = z.infer<typeof lumperOrderSchema>;

export const lumperChargeSchema = z.object({
  external_id: id,
  company_id: z.string().trim().min(1),
  order_external_id: id,
  charge_code: z.string().trim().min(1).max(16),
  descr: text,
  amount: money,
  sequence: z.number().int().nullable(),
});
export type LumperCharge = z.infer<typeof lumperChargeSchema>;

export const LUMPER_SETTLEMENT_STATES = ["paid", "pending"] as const;

export const lumperPaymentSchema = z.object({
  external_id: id,
  company_id: z.string().trim().min(1),
  settlement_state: z.enum(LUMPER_SETTLEMENT_STATES),
  // Null on about one line in thirteen: payroll keyed it with no order. Listed for a person to match.
  order_external_id: id.nullable(),
  movement_external_id: text,
  deduct_code: z.string().trim().min(1).max(16),
  deduction_type: text,
  amount: money,
  transacted_at: instant,
  reference_no: text,
  driver_external_id: text,
  payee_id: text,
  tractor_unit: text,
  is_void: z.boolean(),
});
export type LumperPayment = z.infer<typeof lumperPaymentSchema>;

export const lumperBillSchema = z.object({
  external_id: id,
  company_id: z.string().trim().min(1),
  order_external_id: id,
  invoice_no: text,
  bill_date: instant,
  bill_type: text,
  canceled: text,
  rebilled: text,
  total_charges: money,
  lumper_amount: money,
  lumper_lines: z.number().int().min(0),
});
export type LumperBill = z.infer<typeof lumperBillSchema>;

export const lumperSweepPayloadSchema = z
  .object({
    company_id: z.string().trim().min(1),
    since: z.iso.date(),
    orders: z.array(lumperOrderSchema).max(2000),
    charges: z.array(lumperChargeSchema).max(4000),
    payments: z.array(lumperPaymentSchema).max(4000),
    bills: z.array(lumperBillSchema).max(4000),
  })
  .superRefine((p, ctx) => {
    // One company per sweep: the write is scoped to `company_id`, and a row of another company would
    // be stored under the wrong one.
    const lists = { orders: p.orders, charges: p.charges, payments: p.payments, bills: p.bills } as const;
    for (const [name, rows] of Object.entries(lists)) {
      const i = rows.findIndex((r) => r.company_id !== p.company_id);
      if (i >= 0) ctx.addIssue({ code: "custom", path: [name, i, "company_id"], message: `is not the sweep's company ${p.company_id}` });
    }
    // Every charge and bill belongs to an order of this sweep; the connector's own dry run checks the
    // same thing. A payment may name an order outside it (read by date) or none.
    const known = new Set(p.orders.map((o) => o.order_external_id));
    for (const name of ["charges", "bills"] as const) {
      const i = p[name].findIndex((r) => !known.has(r.order_external_id));
      if (i >= 0) ctx.addIssue({ code: "custom", path: [name, i, "order_external_id"], message: "names an order that is not in this sweep" });
    }
  });
export type LumperSweepPayload = z.infer<typeof lumperSweepPayloadSchema>;

/** Why a person closed a case that will not be billed (D-LRC4). The database CHECK lists the same four. */
export const LUMPER_CLOSE_REASONS = ["broker_paid_directly", "broker_refused", "included_in_rate", "not_a_lumper"] as const;
export type LumperCloseReason = (typeof LUMPER_CLOSE_REASONS)[number];

export const LUMPER_CLOSE_REASON_LABELS: Record<LumperCloseReason, string> = {
  broker_paid_directly: "Broker paid the lumper directly",
  broker_refused: "Broker refused to pay",
  included_in_rate: "Included in the rate",
  not_a_lumper: "Not a lumper",
};
