import { describe, it, expect } from "vitest";
import { planFuelStops, type SolverStation, type FuelPlanInput } from "./solver.js";
import { DEFAULT_ROUTE_FUEL_SETTINGS } from "./types.js";
import type { TruckFuelState } from "./truckState.js";

// A controllable TruckFuelState (dry van, 6 mpg, 200-gal tank, 20% reserve, ~100 gal on hand).
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
    legalDriveMs: 10 * 3_600_000,
    timeUntilBreakMs: 8 * 3_600_000,
    hosReachableMiles: 550,
    fuelRangeMiles: 372,
    reachableMiles: 372,
    confidence: { fuelPresent: true, fuelFresh: true, postFillDistrust: false, hosPresent: true, hosFromTeam: false, mpgPresent: true },
    flags: [],
    ...over,
  };
}
const st = (id: string, milesAhead: number, netPrice: number | null, brand = "pilot", state: string | null = "TX", detourMiles = 0): SolverStation => ({ id, brand, state, milesAhead, detourMiles, netPrice });
const input = (over: Partial<FuelPlanInput>): FuelPlanInput => ({ distanceToGoMiles: 300, stations: [], truck: mkTruck(), settings: DEFAULT_ROUTE_FUEL_SETTINGS, ...over });

describe("planFuelStops", () => {
  it("no stop needed when fuel reaches the destination", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 300, stations: [st("a", 150, 3.5)] }));
    expect(plan.status).toBe("ok");
    expect(plan.stops).toHaveLength(0);
    expect(plan.reachesDestination).toBe(true);
    expect(plan.arrivalFuelPct).not.toBeNull();
  });

  it("inserts one stop and picks the CHEAPEST reachable preferred station", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 700, stations: [st("cheap", 350, 3.5), st("dear", 300, 4.0)] }));
    expect(plan.reachesDestination).toBe(true);
    expect(plan.stops).toHaveLength(1);
    expect(plan.stops[0]!.station.id).toBe("cheap");
    expect(plan.stops[0]!.netPrice).toBe(3.5);
  });

  it("INVARIANT: never arrives at a stop below reserve", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 1200, stations: [st("s1", 300, 3.6), st("s2", 650, 3.4), st("s3", 980, 3.7)] }));
    for (const s of plan.stops) expect(s.arrivalGal).toBeGreaterThanOrEqual(38 - 1e-6);
  });

  it("uses an EMERGENCY (CA/ONE9) station only when no preferred is reachable, and flags it", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 500, stations: [st("ca", 300, 4.9, "pilot", "CA"), st("one9", 310, 4.7, "one9", "NV")] }));
    expect(plan.status).toBe("emergency_used");
    expect(plan.stops[0]!.isEmergency).toBe(true);
    expect(plan.flags).toContain("emergency_fill_used");
  });

  it("raises a LOUD INFEASIBLE state (no best-guess stop) when nothing is reachable before reserve", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 800, stations: [st("far", 500, 3.5)] }));
    expect(plan.status).toBe("infeasible");
    expect(plan.reachesDestination).toBe(false);
    expect(plan.flags).toContain("INFEASIBLE_no_reachable_fuel");
  });

  it("savings vs naive is >= 0 (smart never costs more than fill-at-nearest)", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 700, stations: [st("near-dear", 300, 4.0), st("far-cheap", 350, 3.4)] }));
    expect(plan.savingsVsNaive).not.toBeNull();
    expect(plan.savingsVsNaive!).toBeGreaterThanOrEqual(0);
  });

  it("reefer burn shortens range → needs a stop a dry van wouldn't", () => {
    const stations = [st("mid", 300, 3.5)];
    const dry = planFuelStops(input({ distanceToGoMiles: 350, stations }));
    const reefer = planFuelStops(input({ distanceToGoMiles: 350, stations, truck: mkTruck({ burn: { effMpg: 6, idleGalPerHour: 0.8, reeferGalPerHour: 0.75 } }) }));
    expect(dry.stops).toHaveLength(0);
    expect(reefer.stops).toHaveLength(1);
  });

  it("detour fuel counts against reachability (a far-detour station can be out of range)", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 800, stations: [st("bigdetour", 360, 3.5, "pilot", "TX", 40)] }));
    // 360 mi + 40 detour = 400 > ~372 range → not reachable → infeasible, not a stranding stop.
    expect(plan.status).toBe("infeasible");
  });

  it("abstains (no plan) when there is no fuel reading", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 300, stations: [st("a", 150, 3.5)], truck: mkTruck({ gallonsOnHand: null }) }));
    expect(plan.status).toBe("infeasible");
    expect(plan.flags).toContain("no_fuel_reading_cannot_plan");
  });

  it("flags HOS when the driver can't legally reach the destination in one duty period", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 300, stations: [st("a", 150, 3.5)], truck: mkTruck({ hosReachableMiles: 200 }) }));
    expect(plan.flags).toContain("hos_rest_required_before_destination");
  });
});
