/**
 * Fill-amount policy (pure). Decides HOW MANY gallons to buy at a chosen stop, isolated from the solver's state
 * machine so the policy is independently testable. Order of rules:
 *   1. Border top-off  → full (enter an avoided state as full as possible, whatever the price).
 *   2. Emergency in an avoided state (California) → the capped ~50-gal splash.
 *   3. Low-fuel emergency elsewhere → a minimal splash: just enough to reach the next preferred station.
 *   4. Otherwise → full top-off. Every planned fill is a full fill (D-FP3, owner ruling 2026-09-10: "fueled
 *      when it gets to 20% to the top … without any overcomplications"). Min-drawdown — buy only enough to
 *      reach the next cheaper station, opt-in since 0061 — was retired with that ruling; its three columns
 *      (`always_fill_full`, `fill_cap_pct`, `min_purchase_gal`) stay on the table with no reader.
 * Returns only the DECISION (gallons + flags); the caller applies it to tank/clock state.
 */
import type { SolverStation } from "./solver.js";
import type { RouteFuelSettings } from "./types.js";
import { isPreferred } from "./stationSelect.js";

const EPS = 1e-6;

export interface FillContext {
  pick: SolverStation;
  arrivalGal: number;
  emergency: boolean;
  borderTopOff: boolean;
  cfg: RouteFuelSettings;
  /** Gallons on board after a full fill — tank × fillTargetPct (D-FP3). */
  fillTargetGal: number;
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
  /** This fill happened inside an avoided state (California splash) — surfaces the avoided-state flag. */
  isAvoidedState: boolean;
}

export function chooseFill(ctx: FillContext): FillDecision {
  const { pick, arrivalGal, emergency, borderTopOff, cfg, fillTargetGal, reserve, weightCap, dest, stations, galFor } = ctx;
  const inAvoided = pick.state != null && cfg.avoidStates.includes(pick.state);
  let fill: number;
  let isAvoidedState = false;

  if (borderTopOff) {
    fill = Math.min(fillTargetGal - arrivalGal, weightCap); // enter the avoided state full, whatever the price
  } else if (emergency && inAvoided) {
    isAvoidedState = true;
    fill = Math.min(cfg.emergencyFillGallons, fillTargetGal - arrivalGal, weightCap);
  } else if (emergency) {
    // Low-fuel emergency (driver missed a planned fill, no Pilot reachable): a MINIMAL splash — just enough to
    // safely reach the next preferred station (or the destination), floored at the emergency splash size. Not a
    // full fill: we don't want to load a lot of fuel at an off-network/expensive pump beyond what's needed.
    const nextPreferred = stations.find((x) => x.milesAhead > pick.milesAhead + EPS && isPreferred(x, cfg));
    const nextDist = (nextPreferred ? nextPreferred.milesAhead + nextPreferred.detourMiles : dest) - pick.milesAhead;
    const needed = galFor(Math.max(0, nextDist)) + reserve - arrivalGal;
    fill = Math.min(Math.max(cfg.emergencyFillGallons, needed), fillTargetGal - arrivalGal, weightCap);
  } else {
    fill = Math.min(fillTargetGal - arrivalGal, weightCap); // full fill
  }

  return { fillGal: Math.max(0, fill), isAvoidedState };
}
