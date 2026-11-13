/**
 * The state of a lumper case — LUMPER-REVISED-RC-PLAN.md D-LRC2, D-LRC4, LRC2.
 *
 * ONE definition, read by the page, the daily reminder and the tests. Nothing stores its answer: it
 * is worked out from the McLeod facts the sweep mirrors (charges, settlement lines, bills) and the
 * two facts only 360 holds (the revised RC is on file; a person closed the case).
 *
 * The purpose decides the order of the rules (owner, 2026-11-13): without the broker's revised rate
 * confirmation we may not be paid for a lumper we already paid on the spot. So invoicing does NOT
 * close a case; only the RC on file with the lumper invoiced in full does, or a person with a reason.
 */

export const LUMPER_CASE_STATES = [
  "waiting_for_rc",
  "rc_received",
  "billed_no_rc",
  "billed_without_lumper",
  "billed_short",
  "billed_rc_on_file",
  "closed_not_billable",
  "charge_removed",
] as const;
export type LumperCaseState = (typeof LUMPER_CASE_STATES)[number];

export const LUMPER_CASE_STATE_LABELS: Record<LumperCaseState, string> = {
  waiting_for_rc: "Waiting for revised RC",
  rc_received: "Revised RC received",
  billed_no_rc: "Billed, no revised RC",
  billed_without_lumper: "Billed without the lumper",
  billed_short: "Billed short",
  billed_rc_on_file: "Billed, revised RC on file",
  closed_not_billable: "Closed, not billable",
  charge_removed: "Charge removed",
};

/** The three states nobody is reminded about and the open list leaves out. */
const DONE: ReadonlySet<LumperCaseState> = new Set(["billed_rc_on_file", "closed_not_billable", "charge_removed"]);
export const isLumperCaseOpen = (state: LumperCaseState): boolean => !DONE.has(state);

export interface LumperCaseFacts {
  charges: readonly { amount: number }[];
  payments: readonly { deduct_code: string; amount: number; is_void: boolean; transacted_at: string | null; reference_no: string | null }[];
  bills: readonly { bill_type: string | null; bill_date: string | null; invoice_no: string | null; lumper_amount: number }[];
  /** A revised RC file is on the case (D-LRC3: a file, never a tick-box). */
  rcOnFile: boolean;
  /** A person closed the case as not billable. */
  closed: boolean;
}

export interface LumperCaseReading {
  state: LumperCaseState;
  open: boolean;
  /** What we paid. 0 when payroll has not keyed it yet. */
  paidAmount: number;
  /** The first day payroll recorded it, as McLeod's date. */
  paidAt: string | null;
  /** EFS references of the money-code lines. */
  references: string[];
  /** What the dispatcher or billing keyed to charge the broker, as it stands now. */
  chargeAmount: number;
  /** Lumper invoiced, net of credit memos. */
  billedAmount: number;
  /** paid − billed when the order is invoiced and that is more than a cent; else 0. */
  shortAmount: number;
  invoiced: boolean;
  /** The latest invoice (not credit memo) of the order. */
  lastInvoiceNo: string | null;
  lastInvoiceAt: string | null;
}

const cents = (n: number): number => Math.round(n * 100);
const total = (rows: readonly { amount: number }[]): number => rows.reduce((t, r) => t + cents(r.amount), 0);

/** A credit memo. Its amounts are POSITIVE in McLeod (377 of 377 in 2026); the type alone says it takes money back. */
const isCredit = (b: { bill_type: string | null }): boolean => (b.bill_type ?? "").trim().toUpperCase() === "C";

export function lumperCaseState(facts: LumperCaseFacts): LumperCaseReading {
  const live = facts.payments.filter((p) => !p.is_void);

  // ── PAID ───────────────────────────────────────────────────────────────────────────────────────
  // Payroll keys ONE lumper as two settlement lines in the same sitting: `UNL`, the EFS money code
  // taken from the driver's settlement, and `LUM`, the reimbursement that gives it back (plan §1.1;
  // 87 money codes $24,879.33 beside 82 reimbursements $23,892.33 in the 90 days measured). Adding
  // them would double every lumper, so the amount paid is the LARGER side, not the sum: when one
  // line is missing the other still states the payment.
  const moneyCodes = live.filter((p) => p.deduct_code === "UNL");
  const reimbursements = live.filter((p) => p.deduct_code === "LUM");
  const paidCents = Math.max(total(moneyCodes), total(reimbursements));
  const dates = live.map((p) => p.transacted_at).filter((d): d is string => d != null).sort();
  const references = [...new Set(moneyCodes.map((p) => p.reference_no).filter((r): r is string => r != null))];

  // ── BILLED ─────────────────────────────────────────────────────────────────────────────────────
  // Net of credit memos: a lumper missed on the first invoice arrives as a credit memo and a second
  // invoice (25 orders in 2026), and the credit repeats the first invoice's lines.
  const invoices = facts.bills.filter((b) => !isCredit(b));
  const credits = facts.bills.filter(isCredit);
  const billedCents = invoices.reduce((t, b) => t + cents(b.lumper_amount), 0) - credits.reduce((t, b) => t + cents(b.lumper_amount), 0);
  // Invoiced while more invoices than credit memos stand: an order whose only invoice was credited
  // back is not billed.
  const invoiced = invoices.length > credits.length;
  const lastInvoice = [...invoices].sort((a, b) => (a.bill_date ?? "").localeCompare(b.bill_date ?? "")).at(-1) ?? null;

  const chargeCents = total(facts.charges);
  const shortCents = invoiced && paidCents - billedCents > 1 ? paidCents - billedCents : 0;

  const state = ((): LumperCaseState => {
    if (facts.closed) return "closed_not_billable";
    // Nothing left in McLeod: the charge was keyed by mistake and deleted, and payroll paid nothing.
    if (chargeCents === 0 && paidCents === 0 && billedCents <= 0 && facts.charges.length === 0) return "charge_removed";
    if (invoiced) {
      if (billedCents <= 0) return "billed_without_lumper";
      if (shortCents > 0) return "billed_short";
      return facts.rcOnFile ? "billed_rc_on_file" : "billed_no_rc";
    }
    return facts.rcOnFile ? "rc_received" : "waiting_for_rc";
  })();

  return {
    state,
    open: isLumperCaseOpen(state),
    paidAmount: paidCents / 100,
    paidAt: dates[0] ?? null,
    references,
    chargeAmount: chargeCents / 100,
    billedAmount: billedCents / 100,
    shortAmount: shortCents / 100,
    invoiced,
    lastInvoiceNo: lastInvoice?.invoice_no ?? null,
    lastInvoiceAt: lastInvoice?.bill_date ?? null,
  };
}
