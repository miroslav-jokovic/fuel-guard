import { describe, it, expect } from "vitest";
import { planFuelStops, type SolverStation, type FuelPlanInput, type HosState } from "./solver.js";
import { DEFAULT_ROUTE_FUEL_SETTINGS } from "./types.js";
import type { TruckFuelState } from "./truckState.js";

const H = 3_600_000;

// Controllable TruckFuelState (dry van, 6 mpg, 200-gal tank, 20% reserve).
function mkTruck(over: Partial<TruckFuelState> = {}): TruckFuelState {
  return {
    gallonsOnHand: 100,
    effectiveTankCapacityGal: 200,
    usableGal: 190,
    reserveGal: 38,
    usableAboveReserveGal: 62,
    belowReserve: false,
    weightLegalFillGal: 1000,
    burn: { effMpg: 6, idleGalPerHour: 0.8, reeferGalPerHour: 0 },
    legalDriveMs: 10 * H,
    timeUntilBreakMs: 8 * H,
    hosReachableMiles: 550,
    fuelRangeMiles: 372,
    reachableMiles: 372,
    confidence: { fuelPresent: true, fuelFresh: true, postFillDistrust: false, hosPresent: true, hosFromTeam: false, mpgPresent: true },
    flags: [],
    ...over,
  };
}
const st = (id: string, milesAhead: number, netPrice: number | null, brand = "pilot", state: string | null = "TX", detourMiles = 0): SolverStation => ({ id, brand, state, milesAhead, detourMiles, netPrice });
const hos = (driveH: number, breakH: number, shiftH = driveH, cycleH = 70): HosState => ({ driveRemainingMs: driveH * H, shiftRemainingMs: shiftH * H, cycleRemainingMs: cycleH * H, breakRemainingMs: breakH * H });
const input = (over: Partial<FuelPlanInput>): FuelPlanInput => ({ distanceToGoMiles: 300, stations: [], truck: mkTruck(), settings: DEFAULT_ROUTE_FUEL_SETTINGS, ...over });

describe("planFuelStops — fuel", () => {
  it("no stop needed when fuel reaches the destination", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 300, stations: [st("a", 150, 3.5)] }));
    expect(plan.status).toBe("ok");
    expect(plan.stops).toHaveLength(0);
    expect(plan.reachesDestination).toBe(true);
  });

  it("inserts one stop and picks the CHEAPEST reachable preferred station", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 700, stations: [st("cheap", 350, 3.5), st("dear", 300, 4.0)] }));
    expect(plan.reachesDestination).toBe(true);
    expect(plan.stops).toHaveLength(1);
    expect(plan.stops[0]!.station!.id).toBe("cheap");
  });

  it("INVARIANT: never arrives at a stop below reserve", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 1200, stations: [st("s1", 300, 3.6), st("s2", 650, 3.4), st("s3", 980, 3.7)] }));
    for (const s of plan.stops) expect(s.arrivalGal).toBeGreaterThanOrEqual(38 - 1e-6);
  });

  it("caps a CA (avoided-state) emergency fill at emergencyFillGallons and flags it", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 700, stations: [st("ca1", 300, 4.9, "pilot", "CA")], settings: { ...DEFAULT_ROUTE_FUEL_SETTINGS, emergencyFillGallons: 50 } }));
    expect(plan.stops[0]!.isEmergency).toBe(true);
    expect(plan.stops[0]!.station!.state).toBe("CA");
    expect(plan.stops[0]!.fillGal).toBeLessThanOrEqual(50 + 1e-6);
    expect(plan.flags).toContain("avoided_state_fill_used");
  });

  it("LOUD INFEASIBLE (no best-guess stop) when nothing is reachable before reserve", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 800, stations: [st("far", 500, 3.5)] }));
    expect(plan.status).toBe("infeasible");
    expect(plan.flags).toContain("INFEASIBLE_no_reachable_fuel");
  });

  it("savings vs naive is >= 0", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 700, stations: [st("near-dear", 300, 4.0), st("far-cheap", 350, 3.4)] }));
    expect(plan.savingsVsNaive!).toBeGreaterThanOrEqual(0);
  });

  it("abstains when there is no fuel reading", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 300, stations: [st("a", 150, 3.5)], truck: mkTruck({ gallonsOnHand: null }) }));
    expect(plan.status).toBe("infeasible");
    expect(plan.flags).toContain("no_fuel_reading_cannot_plan");
  });
});

describe("planFuelStops — HOS integration", () => {
  it("HOS unknown → fuel-only (no break/reset stops inserted)", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 300, stations: [st("a", 150, 3.5)] })); // no hos
    expect(plan.stops).toHaveLength(0);
    expect(plan.flags).not.toContain("overnight_reset_required");
  });

  it("inserts a 10-hour reset (overnight) combined with a fuel stop when legal drive is exhausted first", () => {
    // Full tank (fuel not the binder); ~8h legal drive → must reset ~440 mi; a station sits there.
    const plan = planFuelStops(input({
      distanceToGoMiles: 1000,
      stations: [st("resetstop", 430, 3.5)],
      truck: mkTruck({ gallonsOnHand: 190 }),
      hos: hos(8, 8),
    }));
    expect(plan.reachesDestination).toBe(true);
    expect(plan.stops.some((s) => s.isOvernight)).toBe(true);
    expect(plan.flags).toContain("overnight_reset_required");
  });

  it("combines the 30-min break with a fuel stop when the break falls due there", () => {
    // Fuel needs a stop ~450 mi and the break is due ~440 mi → the fuel stop covers the break.
    const plan = planFuelStops(input({
      distanceToGoMiles: 800,
      stations: [st("s", 430, 3.5)],
      truck: mkTruck({ gallonsOnHand: 120 }),
      hos: hos(11, 8),
    }));
    const fuelStop = plan.stops.find((s) => s.kind === "fuel");
    expect(fuelStop).toBeTruthy();
    expect(fuelStop!.coversBreak).toBe(true);
  });

  it("takes a STANDALONE break (rest, no fuel) when the break is due but no fuel is needed yet", () => {
    // Fuel reaches the destination; break due ~440 mi with no station in the break window → standalone rest.
    const plan = planFuelStops(input({
      distanceToGoMiles: 500,
      stations: [],
      truck: mkTruck({ gallonsOnHand: 190 }),
      hos: hos(11, 8),
    }));
    expect(plan.reachesDestination).toBe(true);
    const rest = plan.stops.find((s) => s.kind === "rest");
    expect(rest).toBeTruthy();
    expect(rest!.station).toBeNull();
    expect(rest!.coversBreak).toBe(true);
    expect(rest!.fillGal).toBe(0);
  });

  it("places the overnight reset NEAR the drive limit, not at an early cheap station", () => {
    // Full tank (fuel not binding), ~8h drive -> reset due ~440 mi. A cheap station at 100 must NOT trigger an
    // early overnight; the reset combines with the station near the limit (420).
    const plan = planFuelStops(input({
      distanceToGoMiles: 1000,
      stations: [st("cheap-early", 100, 3.0), st("near-limit", 420, 4.0)],
      truck: mkTruck({ gallonsOnHand: 190 }),
      hos: hos(8, 8),
    }));
    const overnight = plan.stops.find((x) => x.isOvernight);
    expect(overnight).toBeTruthy();
    expect(overnight!.station!.id).toBe("near-limit");
    expect(plan.stops.some((x) => x.station?.id === "cheap-early")).toBe(false); // no wasteful early stop
  });

  it("does a real FULL fill (not 0 gallons) at a fuel stop", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 700, stations: [st("s", 300, 3.5)], truck: mkTruck({ gallonsOnHand: 100 }) }));
    expect(plan.stops[0]!.kind).toBe("fuel");
    expect(plan.stops[0]!.fillGal).toBeGreaterThan(50);
  });

    it("rests at a rest area (no fuel) when a reset is due but no station is reachable", () => {
    // Full tank, ~8h drive, destination far, and NO stations at all → forced rest-only reset, still progresses.
    const plan = planFuelStops(input({
      distanceToGoMiles: 900,
      stations: [],
      truck: mkTruck({ gallonsOnHand: 190 }),
      hos: hos(8, 8),
    }));
    const rest = plan.stops.find((s) => s.kind === "rest" && s.isOvernight);
    expect(rest).toBeTruthy();
    expect(rest!.station).toBeNull();
    expect(plan.flags).toContain("overnight_reset_required");
  });
});
