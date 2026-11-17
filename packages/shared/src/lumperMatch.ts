/**
 * Two hints that point a person at a lumper McLeod holds in the wrong place
 * (LUMPER-REVISED-RC-PLAN.md D-LRC13, D-LRC14; accuracy audit of the first production read, 2026-11-17).
 *
 * Neither one changes a case's state or moves a dollar. McLeod is the record; when it is keyed on the
 * wrong order, the fix is in McLeod, and the next read corrects the case by itself. These functions only
 * say where to look, and they say nothing when the evidence names more than one place.
 *
 * Pure, like `lumperCaseState`: the page, the reminder and the tests read one definition.
 */

const cents = (n: number): number => Math.round(n * 100);
const DAY_MS = 86_400_000;
const dayGap = (a: string, b: string): number => Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;

// ── D-LRC13: a payment on one order, the charge on another ─────────────────────────────────────────

/**
 * How far apart the payment and the other order's delivery may be. The money code is keyed 9 to 88
 * hours after the lumper (plan §1.1), and on the first production read the two cases found were 2 and
 * 6 days apart (0135863 paid 10/01 beside 0135778 delivered 09/29; 0135053 paid 09/14 beside 0134847
 * delivered 09/08). Two weeks holds both with room, and stays short enough that a dispatcher's
 * same-priced lumper a month later is not offered as the answer.
 */
export const LUMPER_MISPOST_DAYS = 14;

export interface LumperMispostSide {
  key: string;
  companyId: string;
  orderId: string;
  dispatcherUserId: string | null;
  /** What payroll paid on this order, per `lumperCaseState`. */
  paidAmount: number;
  paidAt: string | null;
  /** The `LUM` charge keyed on the order, and the lumper invoiced, net of credit memos. */
  chargeAmount: number;
  billedAmount: number;
  deliveredAt: string | null;
}

/** On a case: "paid_here" — this order holds a payment whose charge may be on `orderId`; "charged_here" — the reverse. */
export interface LumperPossibleMispost {
  orderId: string;
  amount: number;
  direction: "paid_here" | "charged_here";
}

/**
 * Pairs an order that was PAID with no lumper charged or billed on it, with an order that CHARGED or
 * billed a lumper with no payment on it — same company, same dispatcher, the same amount to the cent,
 * paid within `LUMPER_MISPOST_DAYS` of the other order's delivery.
 *
 * Why the dispatcher and not the broker: on the first read, payroll's wrong order was the same
 * dispatcher's previous load for a different broker (0135863 DSV, 0135778 Arrive Logistics). Why the
 * charged side's amount is the larger of its charge and its invoice: billing re-keys the charge, and
 * an invoiced order may have had its charge row replaced (plan §1.2).
 *
 * A side with two or more candidates gets none: a hint that might name the wrong order is worse than
 * no hint, because a person would act on it.
 */
export function lumperPossibleMisposts(sides: readonly LumperMispostSide[]): Map<string, LumperPossibleMispost[]> {
  const paidOnly = sides.filter((s) => s.paidAmount > 0 && s.chargeAmount <= 0 && s.billedAmount <= 0 && s.paidAt && s.dispatcherUserId);
  const chargedOnly = sides.filter((s) => s.paidAmount <= 0 && Math.max(s.chargeAmount, s.billedAmount) > 0 && s.deliveredAt && s.dispatcherUserId);
  const fits = (p: LumperMispostSide, c: LumperMispostSide): boolean =>
    p.companyId === c.companyId &&
    p.dispatcherUserId === c.dispatcherUserId &&
    cents(p.paidAmount) === cents(Math.max(c.chargeAmount, c.billedAmount)) &&
    dayGap(p.paidAt!, c.deliveredAt!) <= LUMPER_MISPOST_DAYS;

  const out = new Map<string, LumperPossibleMispost[]>();
  for (const p of paidOnly) {
    const found = chargedOnly.filter((c) => fits(p, c));
    if (found.length !== 1) continue;
    const c = found[0]!;
    // Unique from the other side as well: two paid orders pointing at one charge is no answer either.
    if (paidOnly.filter((q) => fits(q, c)).length !== 1) continue;
    out.set(p.key, [{ orderId: c.orderId, amount: p.paidAmount, direction: "paid_here" }]);
    out.set(c.key, [{ orderId: p.orderId, amount: p.paidAmount, direction: "charged_here" }]);
  }
  return out;
}

// ── D-LRC14: a settlement line with no order, beside its other half ────────────────────────────────

/**
 * How far apart the two halves of one payroll entry may be. Payroll keys the money code (`UNL`) and
 * the driver's reimbursement (`LUM`) "in the same sitting" (plan §1.1); on the first production read
 * the three order-less reimbursements sat 2 to 5 days after their money code.
 */
export const LUMPER_ORDERLESS_DAYS = 7;

export interface LumperSettlementLine {
  id: string;
  companyId: string;
  orderId: string | null;
  deductCode: string;
  amount: number;
  transactedAt: string | null;
  /** Whose settlement the line is on. Both halves of one lumper are on the same payee's settlement. */
  payeeId: string | null;
  isVoid: boolean;
}

const OTHER_HALF: Readonly<Record<string, string>> = { UNL: "LUM", LUM: "UNL" };

/**
 * For each line with no order number: the order whose OTHER half it is — same company, same payee,
 * the same amount to the cent, within `LUMPER_ORDERLESS_DAYS`, on an order that does not already hold
 * a line of this code for that amount. Such a line is not a lumper of unknown order: its payment is
 * already counted on that order through its other half (`lumperCaseState` takes the larger side, not
 * the sum), so listing it as "order unknown" would ask a person to match what is matched.
 *
 * Each order line is the other half of at most one order-less line, and a line with two candidates
 * (or one candidate that two lines want) is left unmatched, for a person.
 */
export function lumperOrderlessMatches(lines: readonly LumperSettlementLine[]): Map<string, string> {
  const live = lines.filter((l) => !l.isVoid);
  const hasOwnHalf = (orderId: string, code: string, amount: number) =>
    live.some((l) => l.orderId === orderId && l.deductCode === code && cents(l.amount) === cents(amount));
  const candidatesOf = (o: LumperSettlementLine) =>
    live.filter(
      (l) =>
        l.orderId != null &&
        l.companyId === o.companyId &&
        l.deductCode === OTHER_HALF[o.deductCode] &&
        o.payeeId != null &&
        l.payeeId === o.payeeId &&
        cents(l.amount) === cents(o.amount) &&
        l.transactedAt != null &&
        o.transactedAt != null &&
        dayGap(l.transactedAt, o.transactedAt) <= LUMPER_ORDERLESS_DAYS &&
        !hasOwnHalf(l.orderId, o.deductCode, o.amount),
    );

  const orderless = live.filter((l) => l.orderId == null && OTHER_HALF[l.deductCode]);
  const wanted = new Map<string, string[]>(); // order line id -> order-less line ids that want it
  const choice = new Map<string, LumperSettlementLine>();
  for (const o of orderless) {
    const found = candidatesOf(o);
    if (found.length !== 1) continue;
    choice.set(o.id, found[0]!);
    wanted.set(found[0]!.id, [...(wanted.get(found[0]!.id) ?? []), o.id]);
  }
  const out = new Map<string, string>();
  for (const [id, line] of choice) if (wanted.get(line.id)!.length === 1) out.set(id, line.orderId!);
  return out;
}
