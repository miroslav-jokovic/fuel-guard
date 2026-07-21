/**
 * Fill-amount policy (pure). Decides HOW MANY gallons to buy at a chosen stop, isolated from the solver's state
 * machine so the policy is independently testable. Order of rules:
 *   1. Border top-off  → full (enter an avoided state as full as possible, whatever the price).
 *   2. Emergency in an avoided state (California) → the capped ~50-gal splash.
 *   3. Emergency elsewhere → full (the driver may not get another reachable pump).
 *   4. Min-drawdown (opt-in: alwaysFillFull=false, non-overnight) → buy just enough to reach the next cheaper
 *      station, floored at the min purchase and capped at fillCapPct — but never so little it strands the route.
 *   5. Otherwise → full top-off.
 * Returns only the DECISION (gallons + flags); the caller applies it to tank/clock state.
 */
import type { SolverStation } from "./solver.js";
import type { RouteFuelSettings } from "./types.js";
import { isPreferred, rankPrice } from "./stationSelect.js";

const EPS = 1e-6;

export interface FillContext {
  pick: SolverStation;
  arrivalGal: number;
  emergency: boolean;
  overnight: boolean;
  borderTopOff: boolean;
  cfg: RouteFuelSettings;
  usable: number;
  reserve: number;
  weightCap: number;
  tankCap: number;
  gpm: number;
  dest: number;
  /** Stations sorted by milesAhead. */
  stations: SolverStation[];
  used: Set<string>;
  galFor: (mi: number) => number;
}

export interface FillDecision {
  fillGal: number;
  /** A genuine partial (min-drawdown) fill, not a full top-off. */
  isMinFill: boolean;
  /** This fill happened inside an avoided state (California splash) — surfaces the avoided-state flag. */
  isAvoidedState: boolean;
}

export function chooseFill(ctx: FillContext): FillDecision {
  const { pick, arrivalGal, emergency, overnight, borderTopOff, cfg, usable, reserve, weightCap, tankCap, gpm, dest, stations, used, galFor } = ctx;
  const inAvoided = pick.state != null && cfg.avoidStates.includes(pick.state);
  let fill: number;
  let isMinFill = false;
  let isAvoidedState = false;

  if (borderTopOff) {
    fill = Math.min(usable - arrivalGal, weightCap); // enter the avoided state full, whatever the price
  } else if (emergency && inAvoided) {
    isAvoidedState = true;
    fill = Math.min(cfg.emergencyFillGallons, usable - arrivalGal, weightCap);
  } else if (emergency) {
    // Outside an avoided state, an emergency stop still fills the tank FULL — the driver may not get another
    // reachable pump. Only California (the avoided-state branch above) is capped at the ~50-gal splash.
    fill = Math.min(usable - arrivalGal, weightCap);
  } else if (!cfg.alwaysFillFull && !overnight) {
    // Min-drawdown: full top-off ONLY when this is the cheapest reachable stop; otherwise buy just enough to
    // reach the next cheaper station (floored at the min purchase, capped at fillCapPct of tank) so the truck
    // doesn't haul expensive fuel past a cheaper pump.
    const fullRangeMi = Math.max(0, usable - reserve) / gpm;
    const cheaperAhead = stations
      .filter((x) => !used.has(x.id) && x.id !== pick.id && x.milesAhead > pick.milesAhead + EPS
        && isPreferred(x, cfg) && x.netPrice != null && pick.netPrice != null && rankPrice(x) < rankPrice(pick) - EPS
        && (x.milesAhead + x.detourMiles - pick.milesAhead) <= fullRangeMi + EPS)
      .sort((a, b) => a.milesAhead - b.milesAhead)[0];
    if (!cheaperAhead) {
      fill = Math.min(usable - arrivalGal, weightCap); // cheapest in the reachable horizon → top off
    } else {
      const capGal = Math.min(usable, (cfg.fillCapPct / 100) * tankCap);
      const needOnboard = galFor((cheaperAhead.milesAhead + cheaperAhead.detourMiles) - pick.milesAhead) + reserve;
      // Safety floor: never fill so little that the truck can't reach the next reachable station or the
      // destination. The cap yields to feasibility, so min-drawdown never strands a route a full fill would make.
      let nearestReachMi = Infinity;
      for (const x of stations) {
        if (used.has(x.id) || x.id === pick.id || x.milesAhead <= pick.milesAhead + EPS) continue;
        const d2 = x.milesAhead + x.detourMiles - pick.milesAhead;
        if (d2 <= fullRangeMi + EPS && d2 < nearestReachMi) nearestReachMi = d2;
      }
      const destDist = dest - pick.milesAhead;
      if (destDist <= fullRangeMi + EPS && destDist < nearestReachMi) nearestReachMi = destDist;
      const safetyOnboard = Number.isFinite(nearestReachMi) ? galFor(nearestReachMi) + reserve : usable;
      let onboard = Math.max(Math.min(needOnboard, capGal), safetyOnboard, arrivalGal);
      onboard = Math.min(onboard, usable);
      let f = onboard - arrivalGal;
      if (f < cfg.minPurchaseGal) f = Math.min(cfg.minPurchaseGal, usable - arrivalGal); // honor the min purchase
      fill = Math.min(Math.max(0, f), weightCap);
      isMinFill = arrivalGal + fill < usable - EPS; // a genuine partial fill (not forced up to full by safety/min-purchase)
    }
  } else {
    fill = Math.min(usable - arrivalGal, weightCap); // full fill
  }

  return { fillGal: Math.max(0, fill), isMinFill, isAvoidedState };
}
