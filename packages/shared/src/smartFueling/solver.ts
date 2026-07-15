/**
 * Smart-fueling solver (pure, §Phase 4). Given corridor candidates + the truck's fuel/HOS state + prices, pick
 * the full-fill stops that reach the destination at least cost — with SAFETY OUTRANKING COST at every step.
 * Rule precedence (audit-hardened): (1) never below reserve incl. detour + reefer burn; (2) prefer discounted,
 * non-avoided stations; (3) full fills; (4) cheapest reachable. Emergency (CA/ONE9) only when no preferred is
 * reachable, safety-sized. INFEASIBLE is a LOUD state, never a best-guess stop. Full-fill is a policy variant,
 * not a proved optimum — correctness is tested empirically (property + adversarial + golden).
 */
import { galPerMile } from "./consumption.js";
import type { RouteFuelSettings } from "./types.js";
import type { TruckFuelState } from "./truckState.js";

export interface SolverStation {
  id: string;
  brand: string;
  state: string | null;
  /** Miles along the route ahead of the truck's current position. */
  milesAhead: number;
  /** Approx round-trip detour off the route to the pump. */
  detourMiles: number;
  /** Net $/gal (diesel). null = price unknown for this station. */
  netPrice: number | null;
}

export interface FuelPlanInput {
  distanceToGoMiles: number;
  stations: SolverStation[];
  truck: TruckFuelState;
  settings: RouteFuelSettings;
  avgSpeedMph?: number;
}

export type PlanStatus = "ok" | "emergency_used" | "infeasible";

export interface PlannedStop {
  station: SolverStation;
  arrivalGal: number;
  fillGal: number;
  netPrice: number | null;
  cost: number | null;
  isEmergency: boolean;
}

export interface FuelPlan {
  status: PlanStatus;
  stops: PlannedStop[];
  reachesDestination: boolean;
  totalGallons: number;
  totalCost: number | null;
  arrivalFuelPct: number | null;
  savingsVsNaive: number | null;
  flags: string[];
}

const EPS = 1e-6;

function isPreferred(s: SolverStation, cfg: RouteFuelSettings): boolean {
  if (cfg.avoidBrands.includes(s.brand)) return false;
  if (s.state && cfg.avoidStates.includes(s.state)) return false;
  return cfg.preferredBrands.length === 0 || cfg.preferredBrands.includes(s.brand);
}

interface GreedyResult {
  stops: PlannedStop[];
  reaches: boolean;
  arrivalGal: number | null;
  usedEmergency: boolean;
  infeasible: boolean;
  droppedNoPrice: boolean;
}

/**
 * One greedy pass. `select` chooses among reachable preferred stations ("smart" = cheapest, "naive" = nearest)
 * so the same safety machinery produces both the plan and its savings baseline.
 */
function runGreedy(input: FuelPlanInput, select: (opts: SolverStation[]) => SolverStation): GreedyResult {
  const { distanceToGoMiles: dest, truck, settings: cfg } = input;
  const avgSpeed = input.avgSpeedMph ?? 55;
  const gpm = galPerMile(truck.burn, avgSpeed);
  const galFor = (mi: number) => mi * gpm;
  const usable = truck.usableGal;
  const reserve = truck.reserveGal;
  const stations = [...input.stations].sort((a, b) => a.milesAhead - b.milesAhead);

  const stops: PlannedStop[] = [];
  const used = new Set<string>();
  let pos = 0;
  let gal = truck.gallonsOnHand ?? 0;
  let usedEmergency = false;
  let droppedNoPrice = false;

  for (let guard = 0; guard <= stations.length + 1; guard++) {
    const aboveReserve = gal - reserve;
    const rangeMi = aboveReserve > 0 ? aboveReserve / gpm : 0;
    if (pos + rangeMi + EPS >= dest) {
      const arrivalGal = gal - galFor(dest - pos);
      return { stops, reaches: true, arrivalGal, usedEmergency, infeasible: false, droppedNoPrice };
    }
    const reachable = stations.filter((s) => !used.has(s.id) && s.milesAhead > pos + EPS && (s.milesAhead - pos) + s.detourMiles <= rangeMi + EPS);
    if (reachable.length === 0) {
      return { stops, reaches: false, arrivalGal: null, usedEmergency, infeasible: true, droppedNoPrice };
    }
    const preferredPriced = reachable.filter((s) => isPreferred(s, cfg) && s.netPrice != null);
    if (reachable.some((s) => isPreferred(s, cfg) && s.netPrice == null)) droppedNoPrice = true;

    let pick: SolverStation;
    let emergency = false;
    if (preferredPriced.length > 0) {
      pick = select(preferredPriced);
    } else {
      // No preferred, priced, reachable station → emergency: the NEAREST reachable of any tier (minimize risk).
      pick = reachable.reduce((a, b) => (a.milesAhead <= b.milesAhead ? a : b));
      emergency = true;
      usedEmergency = true;
    }

    const arrivalGal = gal - galFor((pick.milesAhead - pos) + pick.detourMiles);
    const weightCap = truck.weightLegalFillGal;
    let fill: number;
    if (emergency) {
      // Safety-sized: reach the NEXT preferred station (or the destination) + reserve; soft target the config
      // gallons, but safety always wins; never exceed tank/weight.
      const nextPreferred = stations.find((s) => s.milesAhead > pick.milesAhead + EPS && isPreferred(s, cfg));
      const nextDist = (nextPreferred ? nextPreferred.milesAhead + (nextPreferred.detourMiles) : dest) - pick.milesAhead;
      const needed = galFor(Math.max(0, nextDist)) + reserve - arrivalGal;
      fill = Math.max(cfg.emergencyFillGallons, needed);
      fill = Math.min(fill, usable - arrivalGal, weightCap);
    } else {
      fill = Math.min(usable - arrivalGal, weightCap); // full fill
    }
    fill = Math.max(0, fill);
    gal = arrivalGal + fill;
    stops.push({ station: pick, arrivalGal, fillGal: fill, netPrice: pick.netPrice, cost: pick.netPrice != null ? pick.netPrice * fill : null, isEmergency: emergency });
    used.add(pick.id);
    pos = pick.milesAhead;
  }
  // Guard tripped without reaching (should be rare) → treat as not reachable.
  return { stops, reaches: false, arrivalGal: null, usedEmergency, infeasible: true, droppedNoPrice };
}

const cheapest = (opts: SolverStation[]): SolverStation =>
  opts.reduce((a, b) => (a.netPrice! < b.netPrice! || (a.netPrice! === b.netPrice! && a.milesAhead > b.milesAhead) ? a : b));
const nearest = (opts: SolverStation[]): SolverStation => opts.reduce((a, b) => (a.milesAhead <= b.milesAhead ? a : b));

const sumCost = (stops: PlannedStop[]): number | null =>
  stops.some((s) => s.cost == null) ? null : stops.reduce((t, s) => t + (s.cost ?? 0), 0);

/** Plan the fuel stops for one route. Runs the safe greedy, plus a naive nearest-station baseline for savings. */
export function planFuelStops(input: FuelPlanInput): FuelPlan {
  const flags: string[] = [];
  // Abstain rather than plan on data we can't stand behind.
  if (input.truck.gallonsOnHand == null) {
    return { status: "infeasible", stops: [], reachesDestination: false, totalGallons: 0, totalCost: null, arrivalFuelPct: null, savingsVsNaive: null, flags: ["no_fuel_reading_cannot_plan", ...input.truck.flags] };
  }
  if (input.truck.belowReserve) flags.push("starts_below_reserve");
  if (input.truck.hosReachableMiles != null && input.truck.hosReachableMiles + EPS < input.distanceToGoMiles) flags.push("hos_rest_required_before_destination");

  const smart = runGreedy(input, cheapest);
  if (smart.droppedNoPrice) flags.push("some_stations_missing_price");
  if (smart.usedEmergency) flags.push("emergency_fill_used");

  if (smart.infeasible) {
    return { status: "infeasible", stops: smart.stops, reachesDestination: false, totalGallons: smart.stops.reduce((t, s) => t + s.fillGal, 0), totalCost: sumCost(smart.stops), arrivalFuelPct: null, savingsVsNaive: null, flags: ["INFEASIBLE_no_reachable_fuel", ...flags, ...input.truck.flags] };
  }

  const naive = runGreedy(input, nearest);
  const smartCost = sumCost(smart.stops);
  const naiveCost = sumCost(naive.stops);
  const savings = smartCost != null && naiveCost != null && !naive.infeasible ? Math.max(0, naiveCost - smartCost) : null;
  const arrivalPct = smart.arrivalGal != null ? (smart.arrivalGal / input.truck.effectiveTankCapacityGal) * 100 : null;

  return {
    status: smart.usedEmergency ? "emergency_used" : "ok",
    stops: smart.stops,
    reachesDestination: smart.reaches,
    totalGallons: smart.stops.reduce((t, s) => t + s.fillGal, 0),
    totalCost: smartCost,
    arrivalFuelPct: arrivalPct != null ? Math.round(arrivalPct * 10) / 10 : null,
    savingsVsNaive: savings != null ? Math.round(savings * 100) / 100 : null,
    flags: [...flags, ...input.truck.flags],
  };
}
