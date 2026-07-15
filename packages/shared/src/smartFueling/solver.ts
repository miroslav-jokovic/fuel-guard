/**
 * Smart-fueling solver (pure). ONE integrated walk down the route that respects fuel AND hours-of-service
 * together, so the plan is a single Start → stop → … → End itinerary rather than a fuel plan with HOS bolted on.
 *
 * At every point the truck may drive only as far as the binding limit of: fuel above reserve, the legal drive
 * clock (min of 11h drive / 14h shift / 60-70h cycle), and the 30-min break interval. Rules (audit-hardened):
 *  1. Never arrive below reserve (incl. detour + reefer burn).                     [safety > cost, always]
 *  2. Prefer discounted, non-avoided stations; California/avoided = emergency only, capped at the 50-gal splash.
 *  3. Full fills (top off — so a truck heading into an avoided state enters it full).
 *  4. Cheapest reachable wins among preferred.
 *  5. A fuel stop (>=30 min) satisfies the required 30-min break — combine them; if the break falls due before
 *     any station, take a standalone break, then continue.
 *  6. When the legal drive clock is exhausted before the destination, take a 10-hour reset — at a fuel stop
 *     when one is within reach (fuel + overnight), else at a rest area.
 * INFEASIBLE is a LOUD state, never a best-guess stop. Correctness is tested empirically.
 */
import { galPerMile } from "./consumption.js";
import { hoursFromMs } from "./units.js";
import type { RouteFuelSettings } from "./types.js";
import type { TruckFuelState } from "./truckState.js";

const H = 3_600_000;
const DRIVE_RESET_MS = 11 * H; // fresh drive clock after a 10-hour reset
const SHIFT_RESET_MS = 14 * H; // fresh shift window after a 10-hour reset
const BREAK_INTERVAL_MS = 8 * H; // driving time allowed between required 30-min breaks
const BREAK_MS = 30 * 60_000;
const FUEL_SERVICE_MS = 45 * 60_000; // on-duty time consumed at a fuel stop (also covers the break)

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

/** Live HOS clocks fed to the solver (null → that clock unknown; the solver then plans on fuel alone + flags it). */
export interface HosState {
  driveRemainingMs: number | null;
  shiftRemainingMs: number | null;
  cycleRemainingMs: number | null;
  breakRemainingMs: number | null; // driving time until the 30-min break is due
}

export interface FuelPlanInput {
  distanceToGoMiles: number;
  stations: SolverStation[];
  truck: TruckFuelState;
  settings: RouteFuelSettings;
  avgSpeedMph?: number;
  hos?: HosState;
}

export type PlanStatus = "ok" | "emergency_used" | "infeasible";

export interface PlannedStop {
  /** Miles from the start where this stop happens. */
  milesAhead: number;
  /** The fuel station, or null for a rest-only stop (a required reset/break with no fuel purchase). */
  station: SolverStation | null;
  arrivalGal: number;
  fillGal: number;
  netPrice: number | null;
  cost: number | null;
  isEmergency: boolean;
  kind: "fuel" | "rest";
  /** This stop satisfies the required 30-min break. */
  coversBreak: boolean;
  /** This stop includes a 10-hour reset (overnight). */
  isOvernight: boolean;
  /** Legal drive hours remaining on arrival (before any reset here) — for the itinerary. */
  driveHoursLeftOnArrival: number | null;
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
  usedAvoidedState: boolean;
  usedReset: boolean;
  hosLimited: boolean;
  infeasible: boolean;
  droppedNoPrice: boolean;
}

/**
 * One integrated greedy pass. `select` chooses among reachable preferred stations ("smart" = cheapest,
 * "naive" = nearest) so the same safety + HOS machinery produces both the plan and its savings baseline.
 */
function runGreedy(input: FuelPlanInput, select: (opts: SolverStation[]) => SolverStation): GreedyResult {
  const { distanceToGoMiles: dest, truck, settings: cfg } = input;
  const avgSpeed = input.avgSpeedMph ?? 55;
  const gpm = galPerMile(truck.burn, avgSpeed);
  const galFor = (mi: number) => mi * gpm;
  const msPerMile = H / avgSpeed;
  const miPerMs = avgSpeed / H;
  const usable = truck.usableGal;
  const reserve = truck.reserveGal;
  const weightCap = truck.weightLegalFillGal;
  const stations = [...input.stations].sort((a, b) => a.milesAhead - b.milesAhead);

  const hos = input.hos;
  const hosKnown = !!hos && (hos.driveRemainingMs != null || hos.shiftRemainingMs != null || hos.cycleRemainingMs != null);
  let drive = hos?.driveRemainingMs ?? Infinity;
  let shift = hos?.shiftRemainingMs ?? Infinity;
  let cycle = hos?.cycleRemainingMs ?? Infinity;
  let brk = hos?.breakRemainingMs ?? Infinity;
  const legalDriveMsNow = () => Math.min(drive, shift, cycle);

  const stops: PlannedStop[] = [];
  const used = new Set<string>();
  let pos = 0;
  let gal = truck.gallonsOnHand ?? 0;
  let usedEmergency = false;
  let usedAvoidedState = false;
  let usedReset = false;
  let hosLimited = false;
  let droppedNoPrice = false;

  const done = (reaches: boolean, infeasible: boolean, arrivalGal: number | null): GreedyResult => ({
    stops, reaches, arrivalGal, usedEmergency, usedAvoidedState, usedReset, hosLimited, infeasible, droppedNoPrice,
  });

  for (let guard = 0; guard <= stations.length * 2 + 6; guard++) {
    const fuelMi = Math.max(0, gal - reserve) / gpm;
    const driveMi = legalDriveMsNow() * miPerMs; // Infinity when HOS unknown
    const breakMi = brk * miPerMs; // Infinity when unknown
    const remaining = dest - pos;

    // Reached — fuel and legal drive both cover the rest of the trip.
    if (fuelMi + EPS >= remaining && driveMi + EPS >= remaining) {
      // A 30-min break may still fall due before arrival — take it standalone (it never blocks arrival, only adds time).
      if (hosKnown && breakMi + EPS < remaining) {
        const at = pos + breakMi;
        gal -= galFor(breakMi);
        drive -= breakMi * msPerMile; shift -= breakMi * msPerMile + BREAK_MS; cycle -= breakMi * msPerMile;
        brk = BREAK_INTERVAL_MS;
        stops.push({ milesAhead: at, station: null, arrivalGal: gal, fillGal: 0, netPrice: null, cost: null, isEmergency: false, kind: "rest", coversBreak: true, isOvernight: false, driveHoursLeftOnArrival: hoursFromMs(legalDriveMsNow()) });
        pos = at;
        continue;
      }
      return done(true, false, gal - galFor(remaining));
    }

    // Must stop. Hard limit on how far we can go = the tighter of fuel and legal drive.
    const hardLimit = Math.min(fuelMi, driveMi);
    const resetBinds = hosKnown && driveMi <= fuelMi + EPS && driveMi + EPS < remaining;

    // If a break falls due strictly before we must fuel/reset, and no station sits inside the break window,
    // take the break standalone at the break mile, then continue (the next pass fuels/resets).
    const stationsInWindow = stations.filter((s) => !used.has(s.id) && s.milesAhead > pos + EPS && (s.milesAhead - pos) + s.detourMiles <= hardLimit + EPS);
    if (hosKnown && breakMi + EPS < hardLimit && !stationsInWindow.some((s) => s.milesAhead - pos <= breakMi + EPS)) {
      const at = pos + breakMi;
      gal -= galFor(breakMi);
      drive -= breakMi * msPerMile; shift -= breakMi * msPerMile + BREAK_MS; cycle -= breakMi * msPerMile;
      brk = BREAK_INTERVAL_MS;
      stops.push({ milesAhead: at, station: null, arrivalGal: gal, fillGal: 0, netPrice: null, cost: null, isEmergency: false, kind: "rest", coversBreak: true, isOvernight: false, driveHoursLeftOnArrival: hoursFromMs(legalDriveMsNow()) });
      pos = at;
      continue;
    }

    if (stationsInWindow.length === 0) {
      // No fuel station reachable within the binding window.
      if (resetBinds) {
        // Legal drive is exhausted before any station and fuel is still fine → rest at a rest area, reset, continue.
        const at = pos + driveMi;
        gal -= galFor(driveMi);
        drive = DRIVE_RESET_MS; shift = SHIFT_RESET_MS; brk = BREAK_INTERVAL_MS; // cycle unchanged (10h off-duty)
        usedReset = true; hosLimited = true;
        stops.push({ milesAhead: at, station: null, arrivalGal: gal, fillGal: 0, netPrice: null, cost: null, isEmergency: false, kind: "rest", coversBreak: true, isOvernight: true, driveHoursLeftOnArrival: 0 });
        pos = at;
        continue;
      }
      return done(false, true, null); // fuel binds and nothing reachable → cannot refuel
    }

    // Choose the fuel station.
    const preferredPriced = stationsInWindow.filter((s) => isPreferred(s, cfg) && s.netPrice != null);
    if (stationsInWindow.some((s) => isPreferred(s, cfg) && s.netPrice == null)) droppedNoPrice = true;
    let pick: SolverStation;
    let emergency = false;
    if (preferredPriced.length > 0) {
      pick = select(preferredPriced);
    } else {
      pick = stationsInWindow.reduce((a, b) => (a.milesAhead <= b.milesAhead ? a : b)); // nearest of any tier
      emergency = true;
      usedEmergency = true;
    }

    const dist = pick.milesAhead - pos;
    const arrivalGal = gal - galFor(dist + pick.detourMiles);
    // Drive to the stop — advance every clock by the main-route driving time.
    const legMs = dist * msPerMile;
    drive -= legMs; shift -= legMs; cycle -= legMs; brk -= legMs;
    // Tag as covering the break when the driver is within an hour of the 8h break at this stop (a fuel stop
    // >=30 min satisfies it), so combining fuel + break here saves a separate 30-min stop.
    const breakWasDue = hosKnown && brk <= H;

    // Fill.
    const inAvoided = pick.state != null && cfg.avoidStates.includes(pick.state);
    let fill: number;
    if (emergency && inAvoided) {
      usedAvoidedState = true;
      fill = Math.min(cfg.emergencyFillGallons, usable - arrivalGal, weightCap); // last-resort splash, capped
    } else if (emergency) {
      const nextPreferred = stations.find((s) => s.milesAhead > pick.milesAhead + EPS && isPreferred(s, cfg));
      const nextDist = (nextPreferred ? nextPreferred.milesAhead + nextPreferred.detourMiles : dest) - pick.milesAhead;
      const needed = galFor(Math.max(0, nextDist)) + reserve - arrivalGal;
      fill = Math.min(Math.max(cfg.emergencyFillGallons, needed), usable - arrivalGal, weightCap);
    } else {
      fill = Math.min(usable - arrivalGal, weightCap); // full fill
    }
    fill = Math.max(0, fill);

    // Any fuel stop (>=30 min) satisfies the 30-min break → reset the break clock.
    brk = BREAK_INTERVAL_MS;
    // Combine a reset here when the legal drive clock is the binder (overnight); else the stop just spends service time.
    let isOvernight = false;
    if (resetBinds) {
      drive = DRIVE_RESET_MS; shift = SHIFT_RESET_MS; // cycle unchanged (off-duty)
      isOvernight = true; usedReset = true; hosLimited = true;
    } else {
      shift -= FUEL_SERVICE_MS; cycle -= FUEL_SERVICE_MS;
    }

    gal = arrivalGal + fill;
    stops.push({
      milesAhead: pick.milesAhead, station: pick, arrivalGal, fillGal: fill, netPrice: pick.netPrice,
      cost: pick.netPrice != null ? pick.netPrice * fill : null, isEmergency: emergency, kind: "fuel",
      coversBreak: breakWasDue, isOvernight, driveHoursLeftOnArrival: hosKnown ? hoursFromMs(Math.min(drive, shift, cycle)) : null,
    });
    used.add(pick.id);
    pos = pick.milesAhead;
  }
  return done(false, true, null); // guard tripped without reaching
}

const cheapest = (opts: SolverStation[]): SolverStation =>
  opts.reduce((a, b) => (a.netPrice! < b.netPrice! || (a.netPrice! === b.netPrice! && a.milesAhead > b.milesAhead) ? a : b));
const nearest = (opts: SolverStation[]): SolverStation => opts.reduce((a, b) => (a.milesAhead <= b.milesAhead ? a : b));

const sumCost = (stops: PlannedStop[]): number | null =>
  stops.some((s) => s.kind === "fuel" && s.cost == null) ? null : stops.reduce((t, s) => t + (s.cost ?? 0), 0);

/** Plan the fuel + HOS stops for one route. Runs the safe greedy, plus a naive nearest-station baseline for savings. */
export function planFuelStops(input: FuelPlanInput): FuelPlan {
  const flags: string[] = [];
  if (input.truck.gallonsOnHand == null) {
    return { status: "infeasible", stops: [], reachesDestination: false, totalGallons: 0, totalCost: null, arrivalFuelPct: null, savingsVsNaive: null, flags: ["no_fuel_reading_cannot_plan", ...input.truck.flags] };
  }
  if (input.truck.belowReserve) flags.push("starts_below_reserve");

  const smart = runGreedy(input, cheapest);
  if (smart.droppedNoPrice) flags.push("some_stations_missing_price");
  if (smart.usedEmergency) flags.push("emergency_fill_used");
  if (smart.usedAvoidedState) flags.push("avoided_state_fill_used");
  if (smart.usedReset) flags.push("overnight_reset_required");
  if (smart.hosLimited) flags.push("hos_limited");

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
