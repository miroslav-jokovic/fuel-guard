/**
 * The coverage bound (FLEETPAL-INTEGRATION-PLAN.md §2.4, D-FP4, D-FP15, D-FP17).
 *
 * D-FP4 forbids printing a dollar of FleetPal money without saying, for the same months, how much
 * of the company's maintenance spend FleetPal actually saw. This file computes that answer and
 * nothing else. Pure — no clock, no I/O; the months and the rows arrive already shaped.
 *
 * ── THE QUESTION, AND WHY IT IS A BOUND RATHER THAN A FIGURE ──────────────────────────────────
 * "Of the maintenance money the company spent in month M, how much went through FleetPal?"
 *
 * The denominator is solid: `mcleod_gl_totals` is grained by `glid` and the maintenance family is
 * a SIGNED map (`tmsCost/glFamilies.ts`, owner 2026-09-03), so "what the company spent on
 * maintenance" is a number somebody ruled on rather than one we inferred.
 *
 * The numerator is where the honesty lives. FleetPal's own invoiced total is easy to compute and
 * is NOT a bound in either direction: a FleetPal invoice the bookkeeper filed outside the
 * maintenance family inflates it, and one posted a month late deflates it — so the raw ratio can
 * exceed 100% and says nothing reliable when it does. What IS defensible is the portion of
 * FleetPal's invoicing that can be found in the accounts-payable ledger by invoice number. Every
 * invoice excluded from that portion could only ever be ADDED to it, never removed, which is what
 * makes "at least X%" true by construction instead of true by hope.
 *
 * ── ⚠ WHY THE FLEETPAL SIDE SUPPLIES THE CLASSIFICATION (D-FP17) ──────────────────────────────
 * The obvious numerator — "maintenance-family AP vouchers that FleetPal matched" — cannot be
 * computed, and finding that out is the reason this comment is long. `mcleod_ap_vouchers.ap_glid`
 * is the accounts-payable CONTROL account, not the expense account: measured on production
 * 2026-09-21, it is `20000000` on 1,278 of 1,658 rows and null on the other 380. There is exactly
 * one distinct non-null value. The expense distribution lives on voucher DETAIL rows this stack
 * does not stage, so a voucher header cannot be classified as maintenance at all.
 *
 * FleetPal answers that instead. Every invoice it holds is against a maintenance purchase order —
 * that is the entire content of the system — so a voucher whose number matches a FleetPal invoice
 * IS maintenance spend, on FleetPal's evidence rather than on a GL classification the ledger never
 * recorded. The integration supplies the dimension McLeod is missing, which is the same sentence
 * §2.2 uses about per-unit cost, arriving a second time from the other direction.
 *
 * ── ⚠ THE JOIN IS THE NUMBER ALONE (Q9(a), owner 2026-09-21), AND IT ERRS BOTH WAYS ───────────
 * `Vendor.code` — FleetPal's own suggested accounting-system key — is populated on 1 of 761
 * vendors (F4), and `payable_to` is null on 81.5% of invoices, so there is no exact vendor key to
 * meet `mcleod_ap_vouchers.vendor_id`. A normalised vendor-NAME comparison is the class of guess
 * D-FS5 bans for McLeod's free-text units, so the ruling is: join on the number, report a bound.
 *
 * A number is not unique across vendors, so the join can miss (a differently formatted number) and
 * it can lie (two suppliers' invoice 1001). Only the MISS direction is allowed into the answer:
 *
 *   * matched to EXACTLY ONE voucher  → counted. The unambiguous case.
 *   * matched to SEVERAL vouchers     → excluded and counted separately. A collision is a fact to
 *                                       report, never a coin to flip.
 *   * matched to NOTHING              → excluded and counted separately.
 *
 * `amountDiffers` is the residual risk made visible rather than joined away. An exactly-one match
 * whose two amounts disagree is still counted — the ruling says the number alone decides — but it
 * is reported, because a real match agrees on the money and a coincidental one usually does not.
 * Adding the amount to the JOIN would have been a quieter, better-looking answer and a different
 * question than the one the owner ruled on.
 */

/** One FleetPal invoice, reduced to what the bound needs. Amounts are always POSITIVE (§2.4). */
export interface CoverageInvoice {
  /** The vendor's own number, exactly as entered — never normalised (D-FP16). */
  number: string;
  /** `YYYY-MM` in the carrier's own calendar, taken from the invoice date. */
  month: string;
  amount: number;
  /** STANDARD adds; CREDIT subtracts. The type is the sign — the amount never is. */
  isCredit: boolean;
}

/** One accounts-payable voucher, reduced likewise. It carries no expense account — see D-FP17. */
export interface CoverageVoucher {
  invoiceNumber: string;
  month: string;
  amount: number;
}

/** What the general ledger says the company spent on maintenance in one month. */
export interface CoverageDenominator {
  month: string;
  /** The signed maintenance family's total for the month. Null when the month was never swept. */
  familyTotal: number | null;
}

export interface CoverageMonth {
  month: string;
  /** FleetPal's own invoicing: STANDARD less CREDIT. Not a bound — see the header. */
  fleetpalInvoiced: number;
  /** The GL maintenance family, or null when the month has not been swept. */
  glMaintenance: number | null;
  /** The part of `fleetpalInvoiced` found in the AP ledger by an unambiguous number match. */
  confirmedInLedger: number;
  /**
   * `confirmedInLedger / glMaintenance`, as a fraction. **A LOWER bound** — say "at least" beside
   * it. Null when the denominator is missing or zero, and a null here is what stops a cost figure
   * printing at all (D-FP4).
   */
  ratioLowerBound: number | null;
  matchedExactlyOne: number;
  /** Numbers that hit several vouchers. Excluded from the bound; they could only raise it. */
  matchedSeveral: number;
  /** Numbers found nowhere in the ledger. Excluded likewise. */
  matchedNone: number;
  /** Of the exactly-one matches, how many disagreed on the money. Visible, never joined away. */
  amountDiffers: number;
}

/** A cent of tolerance: both sides are `numeric` but arrive through JSON as binary floats. */
const CENT = 0.005;

/**
 * The bound, per month.
 *
 * `months` decides the output and its order, so a month with no FleetPal invoicing at all still
 * appears — as a zero with its denominator beside it, which is the honest rendering of "FleetPal
 * saw none of it" and is a different statement from the month not being there.
 */
export function computeCoverage(
  months: CoverageDenominator[],
  invoices: CoverageInvoice[],
  vouchers: CoverageVoucher[],
): CoverageMonth[] {
  const vouchersByMonth = new Map<string, Map<string, CoverageVoucher[]>>();
  for (const v of vouchers) {
    let byNumber = vouchersByMonth.get(v.month);
    if (!byNumber) vouchersByMonth.set(v.month, (byNumber = new Map()));
    const bucket = byNumber.get(v.invoiceNumber);
    if (bucket) bucket.push(v);
    else byNumber.set(v.invoiceNumber, [v]);
  }

  const invoicesByMonth = new Map<string, CoverageInvoice[]>();
  for (const i of invoices) {
    const bucket = invoicesByMonth.get(i.month);
    if (bucket) bucket.push(i);
    else invoicesByMonth.set(i.month, [i]);
  }

  return months.map(({ month, familyTotal }) =>
    oneMonth(month, familyTotal, invoicesByMonth.get(month) ?? [], vouchersByMonth.get(month) ?? new Map()),
  );
}

function oneMonth(
  month: string,
  familyTotal: number | null,
  invoices: CoverageInvoice[],
  vouchersByNumber: Map<string, CoverageVoucher[]>,
): CoverageMonth {
  // ⚠ Grouped by NUMBER before anything is counted. Two FleetPal invoices carrying the same number
  // point at the same voucher, and adding that voucher's evidence twice would let a duplicate in
  // the vendor's own data inflate the bound — the one direction the bound is not allowed to move.
  const byNumber = new Map<string, { net: number; count: number }>();
  let fleetpalInvoiced = 0;
  for (const inv of invoices) {
    const signed = inv.isCredit ? -inv.amount : inv.amount;
    fleetpalInvoiced += signed;
    const seen = byNumber.get(inv.number);
    if (seen) { seen.net += signed; seen.count += 1; }
    else byNumber.set(inv.number, { net: signed, count: 1 });
  }

  let confirmedInLedger = 0;
  let matchedExactlyOne = 0;
  let matchedSeveral = 0;
  let matchedNone = 0;
  let amountDiffers = 0;

  for (const [number, { net }] of byNumber) {
    const hits = vouchersByNumber.get(number) ?? [];
    if (hits.length === 0) { matchedNone += 1; continue; }
    if (hits.length > 1) { matchedSeveral += 1; continue; }
    matchedExactlyOne += 1;
    // FleetPal's figure is counted, not the voucher's: the question is how much of FLEETPAL's
    // invoicing is confirmed, and the voucher is the evidence rather than the measurement.
    confirmedInLedger += net;
    if (Math.abs(hits[0]!.amount - net) > CENT) amountDiffers += 1;
  }

  const ratioLowerBound =
    familyTotal === null || familyTotal === 0 ? null : confirmedInLedger / familyTotal;

  return {
    month,
    fleetpalInvoiced: round2(fleetpalInvoiced),
    glMaintenance: familyTotal === null ? null : round2(familyTotal),
    confirmedInLedger: round2(confirmedInLedger),
    ratioLowerBound,
    matchedExactlyOne,
    matchedSeveral,
    matchedNone,
    amountDiffers,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Can a cost figure be printed for this window at all? (D-FP4.)
 *
 * The rule is deliberately strict: EVERY month in the window must have a computable bound. A
 * window half of whose months have no swept ledger would otherwise print a per-truck cost beside a
 * ratio covering only the other half, which is the plausible-but-wrong figure D-FIN10 exists to
 * refuse — and it would look more trustworthy than a refusal, not less.
 */
export function coverageIsPrintable(months: CoverageMonth[]): boolean {
  return months.length > 0 && months.every((m) => m.ratioLowerBound !== null);
}
