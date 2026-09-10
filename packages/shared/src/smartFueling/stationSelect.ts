/**
 * Station selection + price ranking (pure). The solver's "which reachable station" decisions live here so the
 * integrated walk in solver.ts stays about MOVEMENT (fuel/HOS) rather than preference. `isPreferred` is the
 * hard policy gate (avoid brands/states, preferred brands); `cheapest`/`nearest` are the two `select` strategies
 * the solver runs (smart plan vs. naive savings baseline).
 */
import type { SolverStation } from "./solver.js";
import type { RouteFuelSettings } from "./types.js";

const EPS = 1e-6;

/**
 * The brand ladder (D-FP4, FUEL-PLANNING-PRECISION-PLAN §2) — ONE predicate set, consulted on every path:
 *   preferred + priced  →  other non-avoided + priced (off-network)  →  non-avoided unpriced  →  avoided.
 * "Avoided" (an avoid-brand, or a station inside an avoid-state such as California) means EMERGENCY ONLY: the
 * truck buys there only when nothing else is reachable above reserve, and then a splash, never a full fill.
 * Until 2026-09-10 the solver's off-network fallback took the NEAREST reachable station of any kind, so ONE9 —
 * avoided, and 0 of 106 stations priced — was a legal non-emergency pick; unit 748's plan (fuel_plans
 * 67093503…) bought 55 gal there at an unknown price, which is also why its total cost was null. The spend
 * page grades the same gallons as an `avoided_brand_premium` finding from the same settings row.
 */

/** Emergency-only: an avoided brand, or any station inside an avoided state. Never a planned fill. */
export function isEmergencyOnly(s: SolverStation, cfg: RouteFuelSettings): boolean {
  if (cfg.avoidBrands.includes(s.brand)) return true;
  return !!s.state && cfg.avoidStates.includes(s.state);
}

/** A station eligible as a normal (non-emergency) fill: not emergency-only, and preferred when a
 *  preferred-brand list is set. */
export function isPreferred(s: SolverStation, cfg: RouteFuelSettings): boolean {
  if (isEmergencyOnly(s, cfg)) return false;
  return cfg.preferredBrands.length === 0 || cfg.preferredBrands.includes(s.brand);
}

/** A station the planner may send the truck to OUTSIDE its preferred network without calling it an emergency:
 *  an enabled, non-avoided brand. Flagged as off-network when chosen. */
export function isOffNetworkEligible(s: SolverStation, cfg: RouteFuelSettings): boolean {
  return !isEmergencyOnly(s, cfg) && !isPreferred(s, cfg);
}

/** A price the ranking can use. An unpriced station is never chosen while a priced one is reachable. */
export const isPriced = (s: SolverStation): boolean => s.netPrice != null;

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
