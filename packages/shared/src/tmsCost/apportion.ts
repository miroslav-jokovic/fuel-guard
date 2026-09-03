/**
 * Largest-remainder apportionment — the only way to spread a pool over weights so that the parts
 * add back to the pool TO THE CENT (D-FIN11, FINANCE-GO-LIVE-PLAN).
 *
 * Why this exists. The harness used to give each truck `round(pool × share)` and then report the
 * whole pool as "allocated". Rounding each share independently loses or invents a few cents per
 * truck, so the per-truck table and the company total could never be added up, and the monthly
 * tie-out the plan builds on (D-FIN14, every dollar in exactly one bucket) was impossible by
 * construction rather than merely unproven. The audit of 2026-09-03 measured the residual as
 * small — which is exactly why it had gone unnoticed and exactly why it disqualifies a figure
 * that claims to hold to the cent.
 *
 * The method is the standard one (Hamilton / largest remainder): work in integer cents, give every
 * weight its floor, then hand the leftover cents one at a time to the largest fractional parts.
 * Ties go to the earlier index so the result is deterministic for a given input order — the
 * caller passes trucks in a stable order and gets the same allocation every run.
 *
 * Pure, no I/O. Weights are non-negative; a pool with nothing to weigh it by (all zero, or no
 * weights at all) apportions nothing, and the caller reports the pool as unallocated rather than
 * inventing a share. A non-positive pool apportions nothing for the same reason: the harness
 * refuses a negative remainder before it gets here, and zero has nothing to spread.
 */
export function apportionByWeight(totalDollars: number, weights: number[]): number[] {
  const zeros = weights.map(() => 0);
  const totalCents = Math.round(totalDollars * 100);
  if (totalCents <= 0) return zeros;
  const weightSum = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (weightSum <= 0) return zeros;

  const raw = weights.map((w) => (Math.max(0, w) / weightSum) * totalCents);
  const floors = raw.map((r) => Math.floor(r));
  let leftover = totalCents - floors.reduce((sum, f) => sum + f, 0);

  // Largest fractional part first; on a tie the earlier index wins. Stable and total.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    leftover--;
  }
  return floors.map((c) => c / 100);
}
