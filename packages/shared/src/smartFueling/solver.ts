/**
 * Smart-fueling solver (pure). ONE walk down the route, placed by RANGE and annotated by hours of service.
 *
 * D-FP1 (docs/plans/fuel/FUEL-PLANNING-PRECISION-PLAN.md, owner ruling 2026-09-10 — "fueled when it gets to
 * 20% to the top, and the next stop based on MPG and fuel tank capacity"): a fuel stop goes where the tank
 * needs it and nowhere else — full fill, at the cheapest preferred priced station inside the last
 * `refuelBandMiles` of range above reserve, else the farthest reachable preferred station. Hours of service
 * ANNOTATE the plan (a stop that covers the 30-min break, a stop where the legal day ends, drive hours left on
 * arrival) and never PLACE one.
 *
 * Until 2026-09-10 the drive clock did place stops, two ways. A 10-hour reset "combined" a fill whenever the
 * tank had `minPurchaseGal` (50) of room — i.e. at or below 70% of a 200-gal tank — and the cycle clock was
 * never restarted and never charged for silent legs, so once it ran out the legal window collapsed to a few
 * miles and every station the truck passed became an "overnight" stop. Unit 748's Mansfield → Windsor plan
 * (fuel_plans 67093503…, 1,961 mi) bought fuel at 67% twice, once at a brand it avoids with no price; replayed
 * on a dense corridor it bought five times at 61–68%, and with no HOS at all it bought twice at 22%. The
 * replay is pinned by "unit 748 Mansfield → Windsor: two fills at the reserve, not five at two-thirds" in
 * solver.test.ts.
 *
 * Rules (audit-hardened, SMART-FUELING-PLAN invariants):
 *  1. Never arrive below reserve (incl. detour + reefer burn).                     [safety > cost, always]
 *  2. Prefer discounted, non-avoided stations; California/avoided = emergency only, capped at the 50-gal splash.
 *  3. Every planned fill is a full fill — the only capped fill is the avoided-state emergency splash (D-FP3).
 *  4. Cheapest reachable wins among preferred, inside the refuel band; run the tank down first.
 *  5. Breaks, 10-hour resets and the 34-hour restart are applied SILENTLY as the walk advances — the itinerary
 *     is FUEL STOPS ONLY. A fuel stop that lands where a clock runs out carries that clock's tag (coversBreak,
 *     isOvernight) as a LABEL; the clock never decided the stop.
 *  6. Pre-border top-off before an avoided or fuel-before state, unchanged — the California rule stays.
 * INFEASIBLE is a LOUD state, never a best-guess stop. Correctness is tested empirically.
 */
import { galPerMile } from "./consumption.js";
import { hoursFromMs } from "./units.js";
import type { RouteFuelSettings } from "./types.js";
import type { TruckFuelState } from "./truckState.js";
import { isPreferred, isEmergencyOnly, isPriced, cheapest, nearest } from "./stationSelect.js";
import { chooseFill } from "./fillPolicy.js";

const H = 3_600_000;
const DRIVE_RESET_MS = 11 * H; // fresh drive clock after a 10-hour reset
const SHIFT_RESET_MS = 14 * H; // fresh shift window after a 10-hour reset
const BREAK_INTERVAL_MS = 8 * H; // driving time allowed between required 30-min breaks
const BREAK_MS = 30 * 60_000;
const FUEL_SERVICE_MS = 45 * 60_000; // on-duty time consumed at a fuel stop (also covers the break)
/** Cycle window restored by a 34-hour restart. Samsara reports the REMAINING cycle, never its length; 70/8 is
 *  the ruleset this fleet runs (D-FP2, Q-FP3). Only tags and flags depend on it — placement never does. */
const CYCLE_RESTART_MS = 70 * H;
/** A fuel stop within this much legal driving of a clock running out carries that clock's tag (the break, the
 *  end of the day). One hour: the driver would stop for it before the next station anyway. */
const TAG_WINDOW_MS = H;

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
  /** true = netPrice is a history/brand estimate (Phase 5), not a fresh quote. Biases selection toward real prices. */
  priceEstimated?: boolean;
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
  /** Fuel % at/above which the pre-border top-off is skipped (default 80 — enter the avoided state full unless already near-full). */
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
  /** The legal driving day ends at this stop, so the 10-hour reset happens here. A LABEL for the dispatcher —
   *  never the reason for the stop (D-FP1); the stop is where the tank needed it. */
  isOvernight: boolean;
  /** Legal drive hours remaining on arrival (before any reset here) — for the itinerary. */
  driveHoursLeftOnArrival: number | null;
  /** This fuel stop is the mandated top-off just before entering an avoided state (e.g. the California border). */
  isBorderTopOff: boolean;
  /** Always false since D-FP3 retired min-drawdown; the field leaves with the API view in FP7. */
  isMinFill: boolean;
  /** An enabled but non-preferred brand, chosen only because no preferred station was reachable (a network
   *  coverage gap). NOT an emergency, and never an avoided brand — those are emergency-only (D-FP4). */
  isOffNetwork: boolean;
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

interface GreedyResult {
  stops: PlannedStop[];
  reaches: boolean;
  arrivalGal: number | null;
  usedEmergency: boolean;
  usedAvoidedState: boolean;
  usedReset: boolean;
  usedRestart: boolean;
  hosLimited: boolean;
  infeasible: boolean;
  droppedNoPrice: boolean;
  usedBorderTopOff: boolean;
  usedMinFill: boolean;
  usedEstimatedPrice: boolean;
  usedOffNetwork: boolean;
}

/**
 * One greedy pass by RANGE. `select` chooses among reachable preferred stations ("smart" = cheapest, "naive" =
 * nearest) so the same safety machinery produces both the plan and its savings baseline. Hours of service are
 * carried along as a clock the walk advances (breaks, resets, restart applied silently) and consulted only to
 * tag the stops the range placed.
 */
function runGreedy(input: FuelPlanInput, select: (opts: SolverStation[]) => SolverStation): GreedyResult {
  const { distanceToGoMiles: dest, truck, settings: cfg } = input;
  const avgSpeed = input.avgSpeedMph ?? 55;
  const gpm = galPerMile(truck.burn, avgSpeed);
  const galFor = (mi: number) => mi * gpm;
  const msPerMile = H / avgSpeed;
  const fillTargetGal = truck.fillTargetGal;
  const reserve = truck.reserveGal;
  const weightCap = truck.weightLegalFillGal;
  const tankCap = truck.effectiveTankCapacityGal;
  const avoidedBorderMi = input.avoidedBorderMiles;
  const topOffPct = input.borderTopOffPct ?? 80;
  const stations = [...input.stations].sort((a, b) => a.milesAhead - b.milesAhead);

  const hos = input.hos;
  const hosKnown = !!hos && (hos.driveRemainingMs != null || hos.shiftRemainingMs != null || hos.cycleRemainingMs != null);
  const clock = {
    drive: hos?.driveRemainingMs ?? Infinity,
    shift: hos?.shiftRemainingMs ?? Infinity,
    cycle: hos?.cycleRemainingMs ?? Infinity,
    brk: hos?.breakRemainingMs ?? Infinity,
  };
  const legalDriveMsNow = () => Math.min(clock.drive, clock.shift, clock.cycle);

  const stops: PlannedStop[] = [];
  const used = new Set<string>();
  let pos = 0;
  let gal = truck.gallonsOnHand ?? 0;
  let usedEmergency = false;
  let usedAvoidedState = false;
  let usedReset = false;
  let usedRestart = false;
  let droppedNoPrice = false;
  let usedBorderTopOff = false;
  let borderToppedOff = false; // guard so we top off before the avoided border at most once
  let usedEstimatedPrice = false;
  let usedOffNetwork = false;

  const done = (reaches: boolean, infeasible: boolean, arrivalGal: number | null): GreedyResult => ({
    stops, reaches, arrivalGal, usedEmergency, usedAvoidedState, usedReset, usedRestart, hosLimited: usedReset || usedRestart,
    infeasible, droppedNoPrice, usedBorderTopOff, usedMinFill: false, usedEstimatedPrice, usedOffNetwork,
  });

  // The driver's rest, taken wherever the clocks say — never a stop. A spent cycle means a 34-hour restart
  // (D-FP2); a spent drive or shift clock means the 10-hour reset. Both give the day back.
  const rest = () => {
    if (clock.cycle <= EPS) { clock.cycle = CYCLE_RESTART_MS; usedRestart = true; }
    clock.drive = DRIVE_RESET_MS; clock.shift = SHIFT_RESET_MS; clock.brk = BREAK_INTERVAL_MS;
    usedReset = true;
  };

  // Advance the clocks over `miles` of driving, taking the 30-min break and every reset/restart SILENTLY along
  // the way. Every clock is charged for every mile — the pre-2026-09-10 walk reset drive and shift on a rest
  // and forgot to charge the cycle for the leg, which is how a 12.9-h cycle became a plan with five stops.
  // Each iteration either consumes leg time or restores a clock to a positive value, so it terminates.
  const driveMiles = (miles: number) => {
    let ms = miles * msPerMile;
    while (ms > EPS) {
      if (legalDriveMsNow() <= EPS) { rest(); continue; }
      if (clock.brk <= EPS) { clock.brk = BREAK_INTERVAL_MS; clock.shift -= BREAK_MS; continue; }
      const step = Math.min(ms, clock.brk, legalDriveMsNow());
      clock.drive -= step; clock.shift -= step; clock.cycle -= step; clock.brk -= step;
      ms -= step;
    }
  };

  // Apply a fuel stop the RANGE chose: drive to it (clocks advance silently), fill, tag from the clocks.
  const applyFuelStop = (pick: SolverStation, emergency: boolean, borderTopOff = false, offNetwork = false) => {
    const dist = pick.milesAhead - pos;
    const arrivalGal = gal - galFor(dist + pick.detourMiles);
    driveMiles(dist);
    const driveLeftOnArrival = hosKnown ? hoursFromMs(legalDriveMsNow()) : null;
    const coversBreak = hosKnown && clock.brk <= TAG_WINDOW_MS;
    const dayEndsHere = hosKnown && legalDriveMsNow() <= TAG_WINDOW_MS;
    if (pick.priceEstimated && pick.netPrice != null) usedEstimatedPrice = true;
    const { fillGal: fill, isAvoidedState } = chooseFill({
      pick, arrivalGal, emergency, borderTopOff, cfg, fillTargetGal, reserve, weightCap, tankCap, gpm, dest, stations, used, galFor,
    });
    if (isAvoidedState) usedAvoidedState = true;
    // A fuel stop is >= 30 min off the wheel, so it covers the break; where the day ends, the driver rests here.
    if (dayEndsHere) rest();
    else { clock.shift -= FUEL_SERVICE_MS; clock.cycle -= FUEL_SERVICE_MS; }
    clock.brk = BREAK_INTERVAL_MS;
    gal = arrivalGal + fill;
    stops.push({
      milesAhead: pick.milesAhead, station: pick, arrivalGal, fillGal: fill, netPrice: pick.netPrice,
      cost: pick.netPrice != null ? pick.netPrice * fill : null, isEmergency: emergency, kind: "fuel",
      coversBreak, isOvernight: dayEndsHere, driveHoursLeftOnArrival: driveLeftOnArrival,
      isBorderTopOff: borderTopOff, isMinFill: false, isOffNetwork: offNetwork,
    });
    used.add(pick.id);
    pos = pick.milesAhead;
  };

  // Choose among reachable stations when no preferred priced one is in the band — the brand ladder (D-FP4),
  // top to bottom: preferred priced → other non-avoided priced (OFF-NETWORK, flagged) → non-avoided unpriced
  // (flagged "price unknown", preferred first) → avoided brand/state, which is a genuine EMERGENCY: the truck
  // is inside California with no preferred way out, or only a ONE9 sits in range. A truck under criticalFuelPct
  // (a missed planned fill) is an emergency at the nearest pump whatever its brand. Before 2026-09-10 the
  // fallback was "the nearest pump of any kind", which is how an avoided, unpriced ONE9 became a normal stop.
  const pickStop = (opts: SolverStation[]): { pick: SolverStation; emergency: boolean; offNetwork: boolean } => {
    if (opts.some((x) => !isEmergencyOnly(x, cfg) && !isPriced(x))) droppedNoPrice = true;
    const preferredPriced = opts.filter((x) => isPreferred(x, cfg) && isPriced(x));
    if (preferredPriced.length > 0) return { pick: select(preferredPriced), emergency: false, offNetwork: false };
    const curPct = tankCap > 0 ? (gal / tankCap) * 100 : 0;
    if (curPct <= cfg.criticalFuelPct + EPS) {
      usedEmergency = true;
      return { pick: nearest(opts), emergency: true, offNetwork: false };
    }
    const otherPriced = opts.filter((x) => !isEmergencyOnly(x, cfg) && isPriced(x));
    if (otherPriced.length > 0) {
      usedOffNetwork = true;
      return { pick: select(otherPriced), emergency: false, offNetwork: true };
    }
    const unpricedPreferred = opts.filter((x) => isPreferred(x, cfg));
    if (unpricedPreferred.length > 0) return { pick: nearest(unpricedPreferred), emergency: false, offNetwork: false };
    const unpricedOther = opts.filter((x) => !isEmergencyOnly(x, cfg));
    if (unpricedOther.length > 0) {
      usedOffNetwork = true;
      return { pick: nearest(unpricedOther), emergency: false, offNetwork: true };
    }
    usedEmergency = true; // only avoided pumps in range → a splash at the nearest, never a full fill
    return { pick: nearest(opts), emergency: true, offNetwork: false };
  };

  // Loop guard: every iteration either returns or applies a fuel stop at a station not used before, so this
  // only backstops a true bug.
  const guardMax = stations.length + 2;
  for (let guard = 0; guard <= guardMax; guard++) {
    const fuelMi = Math.max(0, gal - reserve) / gpm; // range above reserve — the ONLY window that places a stop
    const remaining = dest - pos;

    // Pre-border top-off (avoided-state rule, e.g. California): if the avoided border lies ahead and the truck
    // would cross it below the top-off threshold, fill up at the LAST preferred station before the line so it
    // enters the avoided state as full as possible. Fire only once that last-before-border station is reachable
    // on the current tank — so on a long route we do NOT top off hundreds of miles early. Skipped when the truck
    // would already cross at/above the threshold. Checked BEFORE "reached" so a truck that could coast into the
    // state on its current tank is still told to top off first.
    if (avoidedBorderMi != null && !borderToppedOff && pos < avoidedBorderMi - EPS) {
      const lastPreBorder = stations
        .filter((x) => !used.has(x.id) && x.milesAhead > pos + EPS && x.milesAhead <= avoidedBorderMi + EPS
          && isPreferred(x, cfg) && x.netPrice != null)
        .reduce<SolverStation | null>((best, x) => (best == null || x.milesAhead > best.milesAhead ? x : best), null);
      if (lastPreBorder != null && (lastPreBorder.milesAhead - pos) + lastPreBorder.detourMiles <= fuelMi + EPS) {
        const galAtBorder = gal - galFor(avoidedBorderMi - pos);
        const pctAtBorder = tankCap > 0 ? (galAtBorder / tankCap) * 100 : 0;
        if (pctAtBorder < topOffPct - EPS) {
          borderToppedOff = true;
          usedBorderTopOff = true;
          applyFuelStop(lastPreBorder, false, true);
          continue;
        }
      }
    }

    // Reached — the fuel above reserve covers the rest of the trip. Any break or reset still due before the end
    // is the driver's own to take; it is not emitted as a stop.
    if (fuelMi + EPS >= remaining) {
      driveMiles(remaining); // so the flags say whether the trip needs a reset or a restart
      return done(true, false, gal - galFor(remaining));
    }

    const inWindow = stations.filter((x) => !used.has(x.id) && x.milesAhead > pos + EPS && (x.milesAhead - pos) + x.detourMiles <= fuelMi + EPS);
    if (inWindow.length === 0) {
      // Nothing reachable ABOVE reserve. Case (b): if the truck is critically low (missed a planned fill), let it
      // dip into the reserve to reach the NEAREST station (any brand) as a genuine emergency, rather than strand.
      const curPct = tankCap > 0 ? (gal / tankCap) * 100 : 0;
      const emergencyRangeMi = gpm > 0 ? gal / gpm : 0; // uses reserve fuel too
      const onReserve = stations.filter((x) => !used.has(x.id) && x.milesAhead > pos + EPS && (x.milesAhead - pos) + x.detourMiles <= emergencyRangeMi + EPS);
      if (curPct <= cfg.criticalFuelPct + EPS && onReserve.length > 0) {
        const near = onReserve.reduce((a, b) => (a.milesAhead <= b.milesAhead ? a : b));
        usedEmergency = true;
        applyFuelStop(near, true);
        continue;
      }
      return done(false, true, null);
    }

    // Fuel is the binding constraint → refuel (full fill). DEFER the stop toward the reserve so the tank runs
    // down (fewest stops) instead of topping off early at a station the truck merely passes: prefer a preferred,
    // priced station in the last `refuelBandMiles` of range. If none sits that close to the reserve, DRIVE AS FAR
    // AS POSSIBLE — the farthest reachable preferred station, never a cheap early one. Fall back to the whole
    // reachable set (off-network or a true emergency) only when no preferred priced station is reachable at all.
    if (inWindow.some((x) => isPreferred(x, cfg) && !isPriced(x))) droppedNoPrice = true;
    const reachablePreferred = inWindow.filter((x) => isPreferred(x, cfg) && isPriced(x));
    if (reachablePreferred.length === 0) {
      const { pick, emergency, offNetwork } = pickStop(inWindow);
      applyFuelStop(pick, emergency, false, offNetwork);
      continue;
    }
    const inBand = reachablePreferred.filter((x) => (x.milesAhead - pos) + x.detourMiles >= fuelMi - cfg.refuelBandMiles - EPS);
    const pick = inBand.length > 0
      ? select(inBand)
      : reachablePreferred.reduce((a, b) => ((a.milesAhead + a.detourMiles) >= (b.milesAhead + b.detourMiles) ? a : b));
    applyFuelStop(pick, false);
  }
  return done(false, true, null); // guard tripped without reaching
}

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
  if (smart.usedOffNetwork) flags.push("off_network_stop_used");
  if (smart.usedAvoidedState) flags.push("avoided_state_fill_used");
  if (smart.usedBorderTopOff) flags.push("topped_off_before_avoided_state");
  if (smart.usedEstimatedPrice) flags.push("estimated_prices_used");
  if (smart.usedReset) flags.push("overnight_reset_required");
  if (smart.usedRestart) flags.push("cycle_restart_required");
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
