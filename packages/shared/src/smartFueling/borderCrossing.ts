/**
 * Reliable "first border crossing" finder for the top-off rules (California / Massachusetts).
 *
 * The detection is deliberately PURE: state classification is injected as `classifyAtMile`, so the whole
 * reliability contract is unit-testable with mocked routes (no live HERE dependency). The API wires
 * `classifyAtMile` to HERE reverse-geocoding of the route polyline.
 *
 * Why not a plain binary search: a bare binary search assumes the route crosses the border exactly once
 * (outside → inside). A route that weaves across a state line (clips in, back out, then in to the destination)
 * breaks that assumption and can land on the wrong crossing. Instead we run a bounded coarse scan to BRACKET
 * the first confirmed outside→inside segment, then binary-refine only inside that bracket — so weaving routes
 * still yield the FIRST real entry.
 *
 * Failure bias: an unknown/failed classification (null) never places the border LATER (which would risk the
 * truck entering low). Unknowns bias the border EARLIER — top off sooner is always the safe direction.
 */

export interface BorderScanOptions {
  /** Nominal spacing between coarse-scan samples, in miles (default 25). */
  scanStepMi?: number;
  /** Hard cap on coarse-scan samples (bounds concurrent classify calls; default 16). */
  maxSamples?: number;
  /** Binary-refine iterations inside the bracket (default 8 → ~0.2 mi on a 50 mi bracket). */
  refineIters?: number;
  /** Ignore a crossing within this many miles of the destination (a top-off there is pointless; default 1). */
  minSegmentMi?: number;
}

/**
 * Find the first route mile that crosses INTO a border state, or null if there is none (or it sits essentially
 * at the destination). `inSet(state)` decides membership; `classifyAtMile(mile)` returns the state code at that
 * route mile (null = unknown). Returns a mile in [0, distanceMiles).
 */
export async function findFirstBorderCrossingMile(
  distanceMiles: number,
  inSet: (state: string | null) => boolean,
  classifyAtMile: (mile: number) => Promise<string | null>,
  opts: BorderScanOptions = {},
): Promise<number | null> {
  if (!(distanceMiles > 0)) return null;
  const maxSamples = Math.max(2, opts.maxSamples ?? 16);
  const step = Math.max(opts.scanStepMi ?? 25, distanceMiles / maxSamples);
  const refineIters = opts.refineIters ?? 8;
  const minSeg = opts.minSegmentMi ?? 1;

  // Coarse sample miles: 0, step, 2·step, … , distanceMiles (endpoints always included).
  const miles: number[] = [];
  for (let m = 0; m < distanceMiles - 1e-9; m += step) miles.push(m);
  miles.push(distanceMiles);

  const states = await Promise.all(miles.map((m) => classifyAtMile(m)));
  const confirmedIn = states.map((s) => s != null && inSet(s));
  const confirmedOut = states.map((s) => s != null && !inSet(s));

  // First CONFIRMED inside sample (skip unknowns — never treat a failed lookup as a crossing).
  let firstIn = -1;
  for (let i = 0; i < miles.length; i++) if (confirmedIn[i]) { firstIn = i; break; }
  if (firstIn <= 0) return null; // no inside sample past the start → no detectable entry

  // Last CONFIRMED outside sample before it → the other end of the bracket.
  let lastOut = -1;
  for (let i = firstIn - 1; i >= 0; i--) if (confirmedOut[i]) { lastOut = i; break; }
  if (lastOut < 0) return null; // nothing confirmed-outside before the first inside → can't bracket safely

  // Binary refine within [miles[lastOut], miles[firstIn]]. Unknown → bias earlier (hi = mid), the safe side.
  let lo = miles[lastOut]!, hi = miles[firstIn]!;
  for (let i = 0; i < refineIters && hi - lo > minSeg; i++) {
    const mid = (lo + hi) / 2;
    const s = await classifyAtMile(mid);
    if (s == null || inSet(s)) hi = mid; else lo = mid;
  }
  return hi < distanceMiles - minSeg ? hi : null;
}
