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
  /** Route mile where the truck crosses into an avoided state (e.g. California). undefined = no avoided border ahead. */
  avoidedBorderMiles?: number;
  /** Fuel % at/above which the pre-border top-off is skipped (default 85 — enter the avoided state full unless already near-full). */
  borderTopOffPct?: number;
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
  /** This fuel stop is the mandated top-off just before entering an avoided state (e.g. the California border). */
  isBorderTopOff: boolean;
  /** This is a min-drawdown partial fill (bought only enough to reach the next cheaper stop), not a full top-off. */
  isMinFill: boolean;
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
  usedBorderTopOff: boolean;
  usedMinFill: boolean;
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
  const tankCap = truck.effectiveTankCapacityGal;
  const avoidedBorderMi = input.avoidedBorderMiles;
  const topOffPct = input.borderTopOffPct ?? 85;
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
  let usedBorderTopOff = false;
  let borderToppedOff = false; // guard so we top off before the avoided border at most once
  let usedMinFill = false;

  const done = (reaches: boolean, infeasible: boolean, arrivalGal: number | null): GreedyResult => ({
    stops, reaches, arrivalGal, usedEmergency, usedAvoidedState, usedReset, hosLimited, infeasible, droppedNoPrice, usedBorderTopOff, usedMinFill,
  });

  const COMBINE_BAND_MI = 75; // a reset combines with a fuel stop within this many miles before the drive limit

  // Apply a fuel stop: drive to it, fill (full / emergency-sized / CA-capped), optionally reset here.
  const applyFuelStop = (pick: SolverStation, emergency: boolean, overnight: boolean, borderTopOff = false) => {
    const dist = pick.milesAhead - pos;
    const arrivalGal = gal - galFor(dist + pick.detourMiles);
    const legMs = dist * msPerMile;
    drive -= legMs; shift -= legMs; cycle -= legMs; brk -= legMs;
    const breakWasDue = hosKnown && brk <= H;
    const inAvoided = pick.state != null && cfg.avoidStates.includes(pick.state);
    let fill;
    let minFill = false;
    if (borderTopOff) {
      fill = Math.min(usable - arrivalGal, weightCap); // enter the avoided state full, whatever the price
    } else if (emergency && inAvoided) {
      usedAvoidedState = true;
      fill = Math.min(cfg.emergencyFillGallons, usable - arrivalGal, weightCap);
    } else if (emergency) {
      const nextPreferred = stations.find((x) => x.milesAhead > pick.milesAhead + EPS && isPreferred(x, cfg));
      const nextDist = (nextPreferred ? nextPreferred.milesAhead + nextPreferred.detourMiles : dest) - pick.milesAhead;
      const needed = galFor(Math.max(0, nextDist)) + reserve - arrivalGal;
      fill = Math.min(Math.max(cfg.emergencyFillGallons, needed), usable - arrivalGal, weightCap);
    } else if (!cfg.alwaysFillFull && !overnight) {
      // Min-drawdown: full top-off ONLY when this is the cheapest reachable stop; otherwise buy just enough to
      // reach the next cheaper station (floored at the min purchase, capped at fillCapPct of tank) so the truck
      // doesn't haul expensive fuel past a cheaper pump.
      const fullRangeMi = Math.max(0, usable - reserve) / gpm;
      const cheaperAhead = stations
        .filter((x) => !used.has(x.id) && x.id !== pick.id && x.milesAhead > pick.milesAhead + EPS
          && isPreferred(x, cfg) && x.netPrice != null && pick.netPrice != null && x.netPrice < pick.netPrice - EPS
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
        minFill = arrivalGal + fill < usable - EPS; // a genuine partial fill (not forced up to full by safety/min-purchase)
      }
    } else {
      fill = Math.min(usable - arrivalGal, weightCap); // full fill
    }
    fill = Math.max(0, fill);
    if (minFill) usedMinFill = true;
    brk = BREAK_INTERVAL_MS; // a fuel stop (>=30 min) covers the break
    if (overnight) { drive = DRIVE_RESET_MS; shift = SHIFT_RESET_MS; usedReset = true; hosLimited = true; }
    else { shift -= FUEL_SERVICE_MS; cycle -= FUEL_SERVICE_MS; }
    gal = arrivalGal + fill;
    stops.push({
      milesAhead: pick.milesAhead, station: pick, arrivalGal, fillGal: fill, netPrice: pick.netPrice,
      cost: pick.netPrice != null ? pick.netPrice * fill : null, isEmergency: emergency, kind: "fuel",
      coversBreak: breakWasDue, isOvernight: overnight, driveHoursLeftOnArrival: hosKnown ? hoursFromMs(Math.min(drive, shift, cycle)) : null,
      isBorderTopOff: borderTopOff, isMinFill: minFill,
    });
    used.add(pick.id);
    pos = pick.milesAhead;
  };

  const restOvernightAt = (atMile: number) => {
    gal -= galFor(atMile - pos);
    drive = DRIVE_RESET_MS; shift = SHIFT_RESET_MS; brk = BREAK_INTERVAL_MS; usedReset = true; hosLimited = true;
    stops.push({ milesAhead: atMile, station: null, arrivalGal: gal, fillGal: 0, netPrice: null, cost: null, isEmergency: false, kind: "rest", coversBreak: true, isOvernight: true, driveHoursLeftOnArrival: 0, isBorderTopOff: false, isMinFill: false });
    pos = atMile;
  };

  const pickStop = (opts: SolverStation[]): { pick: SolverStation; emergency: boolean } => {
    const preferredPriced = opts.filter((x) => isPreferred(x, cfg) && x.netPrice != null);
    if (opts.some((x) => isPreferred(x, cfg) && x.netPrice == null)) droppedNoPrice = true;
    if (preferredPriced.length > 0) return { pick: select(preferredPriced), emergency: false };
    usedEmergency = true;
    return { pick: opts.reduce((a, b) => (a.milesAhead <= b.milesAhead ? a : b)), emergency: true };
  };

  for (let guard = 0; guard <= stations.length * 2 + 6; guard++) {
    const fuelMi = Math.max(0, gal - reserve) / gpm;
    const driveMi = legalDriveMsNow() * miPerMs; // Infinity when HOS unknown
    const breakMi = brk * miPerMs;
    const remaining = dest - pos;
    const windowMi = Math.min(fuelMi, driveMi);

    // Pre-border top-off (avoided-state rule, e.g. California): if the avoided border lies ahead and the truck
    // would cross it below the top-off threshold, fill up at the furthest reachable preferred station before the
    // line so it enters the avoided state as full as possible. Skipped when it would already cross at/above the
    // threshold (default 85%), or when no station sits between here and the border. Checked BEFORE "reached" so a
    // truck that could coast into the state on its current tank is still told to top off first.
    if (avoidedBorderMi != null && !borderToppedOff && pos < avoidedBorderMi - EPS && fuelMi + EPS >= avoidedBorderMi - pos) {
      const galAtBorder = gal - galFor(avoidedBorderMi - pos);
      const pctAtBorder = tankCap > 0 ? (galAtBorder / tankCap) * 100 : 0;
      if (pctAtBorder < topOffPct - EPS) {
        const preBorder = stations.filter((x) => !used.has(x.id) && x.milesAhead > pos + EPS
          && x.milesAhead <= avoidedBorderMi + EPS && (x.milesAhead - pos) + x.detourMiles <= windowMi + EPS);
        if (preBorder.some((x) => isPreferred(x, cfg) && x.netPrice == null)) droppedNoPrice = true;
        const preferredPre = preBorder.filter((x) => isPreferred(x, cfg) && x.netPrice != null);
        const pool = preferredPre.length > 0 ? preferredPre : preBorder;
        if (pool.length > 0) {
          const pick = pool.reduce((a, b) => (a.milesAhead >= b.milesAhead ? a : b)); // furthest = closest to the border
          const emergency = !(isPreferred(pick, cfg) && pick.netPrice != null);
          if (emergency) usedEmergency = true;
          borderToppedOff = true;
          usedBorderTopOff = true;
          applyFuelStop(pick, emergency, false, true);
          continue;
        }
      }
    }

    // Reached — fuel and legal drive both cover the rest of the trip.
    if (fuelMi + EPS >= remaining && driveMi + EPS >= remaining) {
      if (hosKnown && breakMi + EPS < remaining) {
        const at = pos + breakMi;
        gal -= galFor(breakMi);
        drive -= breakMi * msPerMile; shift -= breakMi * msPerMile + BREAK_MS; cycle -= breakMi * msPerMile;
        brk = BREAK_INTERVAL_MS;
        stops.push({ milesAhead: at, station: null, arrivalGal: gal, fillGal: 0, netPrice: null, cost: null, isEmergency: false, kind: "rest", coversBreak: true, isOvernight: false, driveHoursLeftOnArrival: hoursFromMs(legalDriveMsNow()), isBorderTopOff: false, isMinFill: false });
        pos = at;
        continue;
      }
      return done(true, false, gal - galFor(remaining));
    }

    const fuelBinds = fuelMi <= driveMi + EPS;
    const inWindow = stations.filter((x) => !used.has(x.id) && x.milesAhead > pos + EPS && (x.milesAhead - pos) + x.detourMiles <= windowMi + EPS);

    // Break falls due before we must stop and no station sits inside the break window → standalone break.
    if (hosKnown && breakMi + EPS < windowMi && !inWindow.some((x) => x.milesAhead - pos <= breakMi + EPS)) {
      const at = pos + breakMi;
      gal -= galFor(breakMi);
      drive -= breakMi * msPerMile; shift -= breakMi * msPerMile + BREAK_MS; cycle -= breakMi * msPerMile;
      brk = BREAK_INTERVAL_MS;
      stops.push({ milesAhead: at, station: null, arrivalGal: gal, fillGal: 0, netPrice: null, cost: null, isEmergency: false, kind: "rest", coversBreak: true, isOvernight: false, driveHoursLeftOnArrival: hoursFromMs(legalDriveMsNow()), isBorderTopOff: false, isMinFill: false });
      pos = at;
      continue;
    }

    if (!fuelBinds) {
      // The legal drive clock runs out before fuel → a 10-hour reset is due around the drive limit. Combine it
      // with a fuel stop only if one sits close to that limit; otherwise rest at a rest area at the limit.
      const combine = inWindow.filter((x) => x.milesAhead - pos >= driveMi - COMBINE_BAND_MI);
      if (combine.length === 0) { restOvernightAt(pos + driveMi); continue; }
      const { pick, emergency } = pickStop(combine);
      applyFuelStop(pick, emergency, true);
      continue;
    }

    // Fuel is the binding constraint → cheapest reachable fuel stop, full fill, no reset.
    if (inWindow.length === 0) return done(false, true, null);
    const { pick, emergency } = pickStop(inWindow);
    applyFuelStop(pick, emergency, false);
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
  if (smart.usedBorderTopOff) flags.push("topped_off_before_avoided_state");
  if (smart.usedMinFill) flags.push("min_drawdown_partial_fills");
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
