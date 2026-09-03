/**
 * The monthly close, decided (D-FIN14, FINANCE-GO-LIVE-PLAN §1.14). Pure: the caller fetches the
 * month's tie-outs; this file says what they mean.
 *
 * "100% precise" means every dollar in exactly one named bucket under a printed basis, and
 * nothing leaking — not that every dollar is measured per truck. This is the instrument: a month
 * is HARDENED only when
 *   · it is at least two months old at computation (McLeod's manual entries land about a month
 *     late; the first sweep of a month is never its truth),
 *   · the CPM report's GL anchor held and its residual is 0.00 (D-FIN11),
 *   · every per-module tie-out the sweeps can measure — settlements (SET), billing (BILL), fuel
 *     (FUEL, decomposed by D-FIN12) — reads 0.00.
 * Anything else leaves the month OPEN with each reason named, so a reader sees WHY rather than a
 * status they must interpret. A residual that is null (no sweep behind that module) is an open
 * reason too: silence about a module is not a zero.
 */

export interface MonthCloseInputs {
  periodStart: string;
  now: Date;
  glRevenue: number;
  glExpenses: number;
  anchored: boolean;
  attributedDirect: number;
  fixedCharged: number;
  allocatedOverhead: number;
  unallocatedOverhead: number;
  ownerOperatorPool: number;
  cpmResidual: number | null;
  settlementDrift: number | null;
  billingDrift: number | null;
  fuelResidual: number | null;
}

export interface MonthClosePlan {
  status: "open" | "hardened";
  openReasons: string[];
  monthsOld: number;
}

export const HARDEN_AFTER_MONTHS = 2;

const money = (n: number) => `$${Math.abs(n).toFixed(2)}`;

/** Whole months between the month's start and `now`'s month start. */
export function monthsBetween(periodStart: string, now: Date): number {
  const [y, m] = periodStart.split("-").map(Number);
  return (now.getUTCFullYear() - (y ?? 0)) * 12 + (now.getUTCMonth() + 1 - (m ?? 0));
}

export function planMonthClose(i: MonthCloseInputs): MonthClosePlan {
  const reasons: string[] = [];
  const monthsOld = monthsBetween(i.periodStart, i.now);
  if (monthsOld < HARDEN_AFTER_MONTHS) {
    reasons.push(`month is ${monthsOld} month(s) old — McLeod may still be posting it (hardens at ${HARDEN_AFTER_MONTHS})`);
  }
  if (!i.anchored) reasons.push("CPM anchor refused: more was attributed than the ledger booked");
  else if (i.cpmResidual == null) reasons.push("CPM tie-out not computed");
  else if (i.cpmResidual !== 0) reasons.push(`CPM buckets miss the ledger by ${money(i.cpmResidual)}`);

  const claim = (name: string, v: number | null) => {
    if (v == null) reasons.push(`${name}: no sweep behind this module yet`);
    else if (v !== 0) reasons.push(`${name}: sweep and ledger differ by ${money(v)}`);
  };
  claim("settlements (SET)", i.settlementDrift);
  claim("billing (BILL)", i.billingDrift);
  claim("fuel (FUEL)", i.fuelResidual);

  return { status: reasons.length ? "open" : "hardened", openReasons: reasons, monthsOld };
}
