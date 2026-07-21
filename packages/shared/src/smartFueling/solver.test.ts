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

  it("breaks a price tie toward the easier-access (lower-detour) station", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 700, stations: [
      st("hard", 300, 3.5, "pilot", "TX", 3), // same price, but a 3-mi opposite-side back-track
      st("easy", 305, 3.5, "pilot", "TX", 0),
    ] }));
    expect(plan.stops[0]!.station!.id).toBe("easy");
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
    expect(plan.stops.some((s) => s.isOvernight && s.kind === "fuel")).toBe(true); // shown as a FUEL stop, not a rest
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

  it("never emits a standalone break/rest stop — HOS breaks stay the driver's own (fuel-only itinerary)", () => {
    // Fuel + drive both reach the destination with a 30-min break due mid-route. We do NOT surface the break as
    // a stop: the itinerary is fuel stops only.
    const plan = planFuelStops(input({
      distanceToGoMiles: 500,
      stations: [],
      truck: mkTruck({ gallonsOnHand: 190 }),
      hos: hos(11, 8),
    }));
    expect(plan.reachesDestination).toBe(true);
    expect(plan.stops.some((s) => s.kind === "rest")).toBe(false);
    expect(plan.stops.every((s) => s.kind === "fuel")).toBe(true);
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

    it("applies a required reset SILENTLY when no station is reachable (no rest node, still flags it)", () => {
    // Full tank, ~8h drive, and NO stations → the 10-hour reset is applied silently so the route stays legal,
    // but never appears as a rest stop. The reset is still surfaced as a plan flag for the dispatcher.
    const plan = planFuelStops(input({
      distanceToGoMiles: 900,
      stations: [],
      truck: mkTruck({ gallonsOnHand: 190 }),
      hos: hos(8, 8),
    }));
    expect(plan.stops.some((s) => s.kind === "rest")).toBe(false);
    expect(plan.flags).toContain("overnight_reset_required");
  });

  it("does not falsely report infeasible on a long, sparse-station HOS-limited route (loop-guard sizing)", () => {
    // Huge tank (fuel never binds) + ~2,600 mi with NO loaded stations forces many silent HOS resets/breaks. The
    // old guard (stations*2 + 6 = 6) tripped and returned infeasible; the distance-aware guard reaches the end.
    const plan = planFuelStops(input({
      distanceToGoMiles: 2600,
      stations: [],
      truck: mkTruck({ gallonsOnHand: 5000, effectiveTankCapacityGal: 6000, usableGal: 6000, reserveGal: 100, usableAboveReserveGal: 5900 }),
      hos: hos(11, 8),
    }));
    expect(plan.reachesDestination).toBe(true);
    expect(plan.status).not.toBe("infeasible");
  });
});

describe("planFuelStops — avoided-state border top-off (California rule)", () => {
  it("tops off before the border when the truck would enter the avoided state below 85%", () => {
    // 50% tank could coast to the destination, but the CA border is at mile 150 and the truck would cross it
    // at ~37% → it must top off at the preferred station just before the line and enter CA full.
    const plan = planFuelStops(input({
      distanceToGoMiles: 300,
      stations: [st("pre", 140, 3.5)],
      avoidedBorderMiles: 150,
    }));
    expect(plan.reachesDestination).toBe(true);
    const border = plan.stops.find((s) => s.isBorderTopOff);
    expect(border).toBeTruthy();
    expect(border!.station!.id).toBe("pre");
    expect(border!.fillGal).toBeGreaterThan(50); // a real full fill, not a splash
    expect(border!.isEmergency).toBe(false); // preferred + priced → normal (cheap) fill, not emergency
    expect(plan.flags).toContain("topped_off_before_avoided_state");
  });

  it("does NOT top off when the truck would already cross the border above 85%", () => {
    // Near-full tank (95%), border only 30 mi ahead → crosses at ~92% → no top-off inserted.
    const plan = planFuelStops(input({
      distanceToGoMiles: 250,
      stations: [st("pre", 25, 3.5)],
      truck: mkTruck({ gallonsOnHand: 190 }),
      avoidedBorderMiles: 30,
    }));
    expect(plan.reachesDestination).toBe(true);
    expect(plan.stops.some((s) => s.isBorderTopOff)).toBe(false);
    expect(plan.flags).not.toContain("topped_off_before_avoided_state");
  });

  it("respects a custom borderTopOffPct threshold", () => {
    // Crosses at ~92%; with the threshold raised to 95% the truck is now 'below' it → must top off.
    const plan = planFuelStops(input({
      distanceToGoMiles: 250,
      stations: [st("pre", 25, 3.5)],
      truck: mkTruck({ gallonsOnHand: 190 }),
      avoidedBorderMiles: 30,
      borderTopOffPct: 95,
    }));
    expect(plan.stops.some((s) => s.isBorderTopOff)).toBe(true);
    expect(plan.flags).toContain("topped_off_before_avoided_state");
  });

  it("tops off at the FURTHEST reachable station before the border (closest to the line), not the cheapest", () => {
    // A cheaper station sits at mile 50 and a dearer one at 130 with the border at 150. To enter CA as full as
    // possible the truck should fill at the furthest one (130), overriding the usual cheapest-wins rule.
    const plan = planFuelStops(input({
      distanceToGoMiles: 300,
      stations: [st("near-cheap", 50, 3.0), st("far-dear", 130, 4.0)],
      avoidedBorderMiles: 150,
    }));
    const border = plan.stops.filter((s) => s.isBorderTopOff);
    expect(border).toHaveLength(1); // exactly one top-off
    expect(border[0]!.station!.id).toBe("far-dear");
    expect(plan.stops.some((s) => s.station?.id === "near-cheap")).toBe(false);
  });

  it("no border logic runs when avoidedBorderMiles is unset", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 300, stations: [st("a", 140, 3.5)] }));
    expect(plan.stops.some((s) => s.isBorderTopOff)).toBe(false);
    expect(plan.flags).not.toContain("topped_off_before_avoided_state");
  });
});

describe("planFuelStops — min-drawdown (partial fills)", () => {
  const fuelStop = (plan: ReturnType<typeof planFuelStops>, id: string) => plan.stops.find((s) => s.station?.id === id);

  it("partial-fills at a pricey stop when a cheaper station is reachable ahead (min-drawdown opt-in)", () => {
    // Only the dear station (a@200, $4.00) is in the initial fuel window; a cheaper one (b@500, $3.00) sits
    // beyond it. With min-drawdown ON, buy just enough at `a` to reach `b`, then top off at `b`.
    const plan = planFuelStops(input({ distanceToGoMiles: 900, stations: [st("a", 200, 4.0), st("b", 500, 3.0)], settings: { ...DEFAULT_ROUTE_FUEL_SETTINGS, alwaysFillFull: false } }));
    expect(plan.reachesDestination).toBe(true);
    const a = fuelStop(plan, "a")!, b = fuelStop(plan, "b")!;
    expect(a.isMinFill).toBe(true);
    expect(a.fillGal).toBeGreaterThanOrEqual(50 - 1e-6); // honors the min purchase
    expect(a.fillGal).toBeLessThan(100);                 // ...but is NOT a full top-off
    expect(b.isMinFill).toBe(false);                     // cheapest ahead → full fill
    expect(b.fillGal).toBeGreaterThan(a.fillGal);
    expect(plan.flags).toContain("min_drawdown_partial_fills");
  });

  it("full-fills at the cheapest reachable stop (no cheaper ahead), even with min-drawdown on", () => {
    // a@200 ($3.00) is cheapest; b@500 ($4.00) is pricier → `a` is the cheapest in the horizon → top off.
    const plan = planFuelStops(input({ distanceToGoMiles: 900, stations: [st("a", 200, 3.0), st("b", 500, 4.0)], settings: { ...DEFAULT_ROUTE_FUEL_SETTINGS, alwaysFillFull: false } }));
    const a = fuelStop(plan, "a")!;
    expect(a.isMinFill).toBe(false);
    expect(a.fillGal).toBeGreaterThan(100); // full fill
    expect(plan.flags).not.toContain("min_drawdown_partial_fills");
  });

  it("alwaysFillFull=true disables min-drawdown (full fill even with cheaper fuel ahead)", () => {
    const plan = planFuelStops(input({
      distanceToGoMiles: 900,
      stations: [st("a", 200, 4.0), st("b", 500, 3.0)],
      settings: { ...DEFAULT_ROUTE_FUEL_SETTINGS, alwaysFillFull: true },
    }));
    const a = fuelStop(plan, "a")!;
    expect(a.isMinFill).toBe(false);
    expect(a.fillGal).toBeGreaterThan(100);            // topped off at the first stop...
    expect(fuelStop(plan, "b")).toBeUndefined();       // ...so the cheaper station is never needed
    expect(plan.flags).not.toContain("min_drawdown_partial_fills");
  });

  it("caps a partial fill at fillCapPct of tank when the next cheaper station is far", () => {
    // The only cheaper station (b@1000) needs ~94% of tank to reach in one hop; the 75% cap limits the fill so
    // the truck doesn't haul that much expensive fuel — it refuels again at c on the way.
    const plan = planFuelStops(input({
      distanceToGoMiles: 1200,
      stations: [st("a", 100, 4.0), st("c", 600, 4.5), st("b", 1000, 3.0)],
      settings: { ...DEFAULT_ROUTE_FUEL_SETTINGS, alwaysFillFull: false },
    }));
    expect(plan.reachesDestination).toBe(true);
    const a = fuelStop(plan, "a")!;
    expect(a.isMinFill).toBe(true);
    expect(a.arrivalGal + a.fillGal).toBeLessThanOrEqual(0.75 * 200 + 1.5); // onboard capped at ~75% of a 200-gal tank
    expect(a.arrivalGal + a.fillGal).toBeLessThan(190 - 5);                 // clearly not a full fill (~94% need)
  });

  it("border top-off is always a FULL fill, overriding min-drawdown", () => {
    const plan = planFuelStops(input({
      distanceToGoMiles: 300,
      stations: [st("pre", 140, 3.5), st("cheaper-in-ca", 200, 2.9, "pilot", "CA")],
      avoidedBorderMiles: 150,
      settings: { ...DEFAULT_ROUTE_FUEL_SETTINGS, alwaysFillFull: false },
    }));
    const border = plan.stops.find((s) => s.isBorderTopOff)!;
    expect(border.isMinFill).toBe(false);
    expect(border.fillGal).toBeGreaterThan(50);
  });
});

describe("planFuelStops — estimated prices (Phase 5)", () => {
  const est = (id: string, mi: number, price: number): SolverStation => ({ ...st(id, mi, price), priceEstimated: true });

  it("a real fresh price wins a near-tie over a slightly cheaper ESTIMATE", () => {
    // est is 1¢ cheaper but only an estimate → the 3¢ estimate penalty makes the real quote win.
    const plan = planFuelStops(input({ distanceToGoMiles: 900, stations: [st("real", 300, 3.5), est("guess", 320, 3.49)] }));
    expect(plan.stops[0]!.station!.id).toBe("real");
    expect(plan.flags).not.toContain("estimated_prices_used");
  });

  it("a clearly cheaper estimate still wins (beats the penalty band)", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 900, stations: [st("real", 300, 3.6), est("guess", 320, 3.5)] }));
    expect(plan.stops[0]!.station!.id).toBe("guess");
    expect(plan.flags).toContain("estimated_prices_used");
  });

  it("an estimated price is usable (a normal fill, not emergency) when it's the only priced option", () => {
    const plan = planFuelStops(input({ distanceToGoMiles: 700, stations: [est("only", 300, 3.5)] }));
    expect(plan.reachesDestination).toBe(true);
    expect(plan.stops[0]!.isEmergency).toBe(false);
    expect(plan.flags).toContain("estimated_prices_used");
  });
});

describe("planFuelStops — fuel-before state (Massachusetts rule)", () => {
  it("tops off before the border yet keeps the state's own stations usable as normal fills", () => {
    // MA is NOT in avoidStates, so its station is a normal preferred fill (not emergency-only like CA). The
    // border top-off still fires before the line (same avoidedBorderMiles the API computes for a fuel-before state).
    const plan = planFuelStops(input({
      distanceToGoMiles: 1400,
      stations: [st("pre", 140, 3.6), st("ma", 900, 3.4, "pilot", "MA")],
      avoidedBorderMiles: 150,
      truck: mkTruck({ gallonsOnHand: 100 }),
    }));
    const border = plan.stops.find((s) => s.isBorderTopOff);
    expect(border?.station?.id).toBe("pre");        // topped off just before the MA border
    const maStop = plan.stops.find((s) => s.station?.id === "ma");
    expect(maStop).toBeTruthy();
    expect(maStop!.isEmergency).toBe(false);         // the MA stop is a normal fill, not an avoided-state splash
  });
});
