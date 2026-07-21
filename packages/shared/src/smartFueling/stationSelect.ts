/**
 * Station selection + price ranking (pure). The solver's "which reachable station" decisions live here so the
 * integrated walk in solver.ts stays about MOVEMENT (fuel/HOS) rather than preference. `isPreferred` is the
 * hard policy gate (avoid brands/states, preferred brands); `cheapest`/`nearest` are the two `select` strategies
 * the solver runs (smart plan vs. naive savings baseline).
 */
import type { SolverStation } from "./solver.js";
import type { RouteFuelSettings } from "./types.js";

const EPS = 1e-6;

/** A station eligible as a normal (non-emergency) fill: not avoided by brand/state, and preferred when a
 *  preferred-brand list is set. Avoided-state stations (e.g. California) fall through to emergency-only. */
export function isPreferred(s: SolverStation, cfg: RouteFuelSettings): boolean {
  if (cfg.avoidBrands.includes(s.brand)) return false;
  if (s.state && cfg.avoidStates.includes(s.state)) return false;
  return cfg.preferredBrands.length === 0 || cfg.preferredBrands.includes(s.brand);
}

/** Penalty ($/gal) applied to an ESTIMATED price when ranking, so a real fresh quote wins a near-tie and a
 *  shaky estimate never quietly beats a known price. Small enough that a clearly cheaper estimate still wins. */
export const ESTIMATE_PENALTY_USD = 0.03;

/** Effective rank price: the net price, nudged up for estimates so real quotes win a tie. */
export const rankPrice = (s: SolverStation): number => s.netPrice! + (s.priceEstimated ? ESTIMATE_PENALTY_USD : 0);

/** Cheapest reachable station. Ties break toward the easier-access (lower-detour) stop, then the one further
 *  along the route (so a price tie never sends the truck to a harder-to-reach opposite-side pump). */
export const cheapest = (opts: SolverStation[]): SolverStation =>
  opts.reduce((a, b) => {
    const ra = rankPrice(a), rb = rankPrice(b);
    if (Math.abs(ra - rb) > EPS) return ra < rb ? a : b;
    if (Math.abs(a.detourMiles - b.detourMiles) > EPS) return a.detourMiles < b.detourMiles ? a : b;
    return a.milesAhead > b.milesAhead ? a : b;
  });

/** Nearest reachable station (the naive baseline used to compute savings-vs-naive). */
export const nearest = (opts: SolverStation[]): SolverStation => opts.reduce((a, b) => (a.milesAhead <= b.milesAhead ? a : b));
