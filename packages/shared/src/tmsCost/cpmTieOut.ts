import type { CpmGlTieOut } from "./cpmContract.js";

// `+ 0` folds the -0 a subtraction that lands exactly on zero produces into +0, so a residual of
// "nothing" compares equal to 0 everywhere, including under `Object.is`.
const round = (n: number) => Math.round(n * 100) / 100 + 0;

/**
 * The tie-out: every dollar of the income statement in exactly one named bucket — D-FIN11's
 * invariant (FINANCE-GO-LIVE-PLAN §1.11), the per-report form of the monthly close D-FIN14 will
 * persist. Split from `cpmHarness.ts` on 2026-09-03 when this block pushed it past the 500-line
 * budget; the arithmetic is deliberately the one line a reviewer can check by hand.
 *
 * Present whenever the caller anchored the report on a GL total. When the anchor held, `residual`
 * is 0.00 by construction — and the harness test "every dollar of the income statement lands in
 * exactly one bucket, to the cent" pins that it stops being 0.00 the moment any term is dropped.
 * When the anchor was refused (more attributed than the ledger booked), `anchored` is false, the
 * pool is the voucher build-up and takes no part in the sum, and `residual` is the
 * over-attribution as a negative number: the staging problem, shown, not a credit spread across
 * trucks.
 */
export function buildGlTieOut(t: {
  glExpenseTotal: number | undefined;
  anchored: boolean;
  attributedDirect: number;
  fixedCharged: number;
  allocatedTotal: number;
  unallocatedOverhead: number;
  ownerOperatorSettlement: number;
  fixedCostOnOwnerOperatorTrucks: number;
}): CpmGlTieOut | null {
  if (t.glExpenseTotal === undefined) return null;
  const allocatedOverhead = t.anchored ? t.allocatedTotal : 0;
  const unallocatedOverhead = t.anchored ? t.unallocatedOverhead : 0;
  return {
    anchored: t.anchored,
    glExpenseTotal: round(t.glExpenseTotal),
    attributedDirect: t.attributedDirect,
    fixedCharged: t.fixedCharged,
    allocatedOverhead,
    unallocatedOverhead,
    ownerOperatorSettlement: t.ownerOperatorSettlement,
    fixedCostOnOwnerOperatorTrucks: t.fixedCostOnOwnerOperatorTrucks,
    residual: round(
      t.glExpenseTotal -
        t.attributedDirect -
        t.fixedCharged -
        t.ownerOperatorSettlement -
        allocatedOverhead -
        unallocatedOverhead,
    ),
  };
}
