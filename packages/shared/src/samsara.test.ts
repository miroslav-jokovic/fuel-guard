import { describe, it, expect } from "vitest";
import {
  parseSamsaraSamples,
  matchFuelingMoment,
  reconcileOdometerMiles,
  metersToMiles,
  parseFuelPercents,
  tankPercentNear,
  reconcileTankFill,
  parseSamsaraVehicles,
  parseVehicleStatsOdometer,
  parseVehicleFuelPercents,
  parseSamsaraDrivers,
  parseCurrentAssignments,
  parseSamsaraTrailers,
  parseTrailerAssignments,
  sampleNearestTime,
  stateFromAddress,
  cityFromAddress,
  compareLocationState,
  matchFuelingStop,
  approxFuelingUtcMs,
  minSampleDistanceMiles,
  resolveLocationConfidence,
  odometerAtTime,
  findFuelingEvent,
} from "./index.js";

describe("metersToMiles", () => {
  it("converts and rounds", () => {
    expect(metersToMiles(1609.344)).toBe(1);
    expect(metersToMiles(241094660)).toBeCloseTo(149809.4, 0);
  });
});

// A simulated Samsara day for one truck: driving, then a fuel stop in Belgrade MT, then driving.
const odoMeters = (mi: number) => mi * 1609.344;
const vehicleStats = {
  gps: [
    { time: "2026-06-29T12:00:00Z", latitude: 45.9, longitude: -110.9, speedMilesPerHour: 62, reverseGeo: { formattedLocation: "I-90, Bozeman, MT" }, decorations: { obdOdometerMeters: { value: odoMeters(438700) } } },
    { time: "2026-06-29T14:25:00Z", latitude: 45.776, longitude: -111.18, speedMilesPerHour: 0, reverseGeo: { formattedLocation: "Pilot Town Pump, Belgrade, MT" }, decorations: { obdOdometerMeters: { value: odoMeters(438795) } } },
    { time: "2026-06-29T14:35:00Z", latitude: 45.776, longitude: -111.18, speedMilesPerHour: 0, reverseGeo: { formattedLocation: "Pilot Town Pump, Belgrade, MT" }, decorations: { obdOdometerMeters: { value: odoMeters(438795) } } },
    { time: "2026-06-29T16:00:00Z", latitude: 45.6, longitude: -111.9, speedMilesPerHour: 58, reverseGeo: { formattedLocation: "US-287, Helena, MT" }, decorations: { obdOdometerMeters: { value: odoMeters(438880) } } },
  ],
};

describe("parseSamsaraSamples", () => {
  it("merges gps + decorated odometer into miles", () => {
    const s = parseSamsaraSamples(vehicleStats);
    expect(s).toHaveLength(4);
    expect(s[1]!.odometerMiles).toBe(438795);
    expect(s[1]!.address).toContain("Belgrade");
  });
});

describe("matchFuelingMoment", () => {
  const samples = parseSamsaraSamples(vehicleStats);

  it("finds the stopped sample in the EFS city and recovers the time + odometer", () => {
    const m = matchFuelingMoment(samples, { city: "BELGRADE", state: "MT", stationName: "PILOT TOWN PUMP BELGRADE" });
    expect(m).not.toBeNull();
    expect(m!.locationMatched).toBe(true);
    expect(m!.samsaraOdometerMiles).toBe(438795);
    expect(m!.matchedAt).toBe("2026-06-29T14:25:00Z"); // fueling time recovered from telematics
  });

  it("returns null when the truck was never in the EFS city (theft signal)", () => {
    expect(matchFuelingMoment(samples, { city: "DALLAS", state: "TX" })).toBeNull();
  });
});

describe("precise location comparison", () => {
  const samples = parseSamsaraSamples(vehicleStats);

  it("sampleNearestTime finds the sample closest to the exact fueling minute", () => {
    const s = sampleNearestTime(samples, "2026-06-29T14:28:00Z", 15);
    expect(s!.time).toBe("2026-06-29T14:25:00Z");
  });
  it("sampleNearestTime returns null when nothing is within the window", () => {
    expect(sampleNearestTime(samples, "2026-06-29T20:00:00Z", 15)).toBeNull();
  });

  it("stateFromAddress + cityFromAddress parse the Samsara formatted address", () => {
    expect(stateFromAddress("Fuller Drive, Boylston, MA, 01505")).toBe("MA");
    expect(cityFromAddress("Fuller Drive, Boylston, MA, 01505")).toBe("Boylston");
    expect(stateFromAddress("Pilot Town Pump, Belgrade, MT")).toBe("MT");
    expect(stateFromAddress("no state here")).toBeNull();
  });

  it("compareLocationState: same state true, different state false, unknown null", () => {
    expect(compareLocationState("MT", "Pilot Town Pump, Belgrade, MT")).toBe(true);
    expect(compareLocationState("GA", "I-10, Houston, TX, 77002")).toBe(false);
    expect(compareLocationState("GA", null)).toBeNull();
    expect(compareLocationState(null, "Belgrade, MT")).toBeNull();
    expect(compareLocationState("MT", "some road with no state")).toBeNull();
  });
});

describe("reconcileOdometerMiles (±5)", () => {
  it("passes when EFS matches Samsara within tolerance", () => {
    expect(reconcileOdometerMiles(438795, 438797, 5)).toEqual({ mismatch: false, diffMiles: 2 });
  });
  it("flags a mismatch beyond tolerance", () => {
    const r = reconcileOdometerMiles(438795, 438845, 5);
    expect(r!.mismatch).toBe(true);
    expect(r!.diffMiles).toBe(50);
  });
  it("returns null when either reading is missing", () => {
    expect(reconcileOdometerMiles(null, 100, 5)).toBeNull();
  });
});

// Tank level around the Belgrade fuel stop: ~20% before, ~95% after a full fill.
const fuelStats = {
  fuelPercents: [
    { time: "2026-06-29T14:10:00Z", value: 20 },
    { time: "2026-06-29T14:25:00Z", value: 21 },
    { time: "2026-06-29T15:05:00Z", value: 95 },
    { time: "2026-06-29T16:00:00Z", value: 92 },
  ],
};

describe("parseFuelPercents", () => {
  it("keeps valid 0..100 readings only", () => {
    const r = parseFuelPercents({ fuelPercents: [{ time: "t", value: 50 }, { time: "t2", value: 150 }, { value: 10 }] });
    expect(r).toHaveLength(1);
    expect(r[0]!.percent).toBe(50);
  });
});

describe("tankPercentNear", () => {
  const readings = parseFuelPercents(fuelStats);
  it("finds the latest reading just before the moment", () => {
    expect(tankPercentNear(readings, "2026-06-29T14:25:00Z", "before")!.percent).toBe(21);
  });
  it("finds the earliest reading after the fill completes", () => {
    expect(tankPercentNear(readings, "2026-06-29T14:40:00Z", "after")!.percent).toBe(95);
  });
  it("returns null when nothing is within the window", () => {
    expect(tankPercentNear(readings, "2026-06-29T20:00:00Z", "after", 30)).toBeNull();
  });
});

describe("reconcileTankFill (advisory)", () => {
  it("does not flag when the tank rise roughly matches the billed gallons", () => {
    // 120-gal tank, 21%→95% = ~88.8 gal observed vs 90 billed → within generous tolerance.
    const r = reconcileTankFill({ gallonsBilled: 90, pctBefore: 21, pctAfter: 95, tankCapacityGal: 120 });
    expect(r).not.toBeNull();
    expect(r!.short).toBe(false);
    expect(r!.observedRiseGal).toBeCloseTo(88.8, 1);
  });
  it("flags a shortfall when far less fuel entered the tank than billed", () => {
    // billed 90 gal but tank only rose 21%→40% = ~22.8 gal → ~67 gal short, well past tolerance.
    const r = reconcileTankFill({ gallonsBilled: 90, pctBefore: 21, pctAfter: 40, tankCapacityGal: 120 });
    expect(r!.short).toBe(true);
    expect(r!.shortGal).toBeGreaterThan(60);
  });
  it("returns null when capacity or a reading is missing", () => {
    expect(reconcileTankFill({ gallonsBilled: 90, pctBefore: null, pctAfter: 95, tankCapacityGal: 120 })).toBeNull();
    expect(reconcileTankFill({ gallonsBilled: 90, pctBefore: 21, pctAfter: 95, tankCapacityGal: null })).toBeNull();
  });
});

describe("parseSamsaraVehicles", () => {
  it("maps identity fields and coerces the year to a number", () => {
    const v = parseSamsaraVehicles({
      data: [
        { id: "212014918732717", name: "T-101", vin: "JTMBK32V895081147", make: "Freightliner", model: "Cascadia", year: "2021", licensePlate: "SIL101" },
      ],
    });
    expect(v).toHaveLength(1);
    expect(v[0]).toEqual({
      samsaraId: "212014918732717",
      name: "T-101",
      vin: "JTMBK32V895081147",
      make: "Freightliner",
      model: "Cascadia",
      year: 2021,
      licensePlate: "SIL101",
    });
  });
  it("skips entries with no id and blanks empty fields; falls back name→id", () => {
    const v = parseSamsaraVehicles({ data: [{ id: "", name: "x" }, { id: "9", name: "  ", vin: "", year: "n/a" }] });
    expect(v).toHaveLength(1);
    expect(v[0]!.name).toBe("9"); // no usable name → falls back to the id
    expect(v[0]!.vin).toBeNull();
    expect(v[0]!.year).toBeNull();
  });
});

describe("parseVehicleFuelPercents", () => {
  it("maps id → current tank level %, skipping out-of-range/absent", () => {
    const m = parseVehicleFuelPercents({
      data: [
        { id: "1", fuelPercents: { value: 62.4, time: "2026-06-30T10:00:00Z" } },
        { id: "2", fuelPercents: { value: 150 } }, // invalid
        { id: "3" }, // absent
      ],
    });
    expect(m.get("1")).toEqual({ percent: 62.4, time: "2026-06-30T10:00:00Z" });
    expect(m.has("2")).toBe(false);
    expect(m.has("3")).toBe(false);
  });
});

describe("parseVehicleStatsOdometer", () => {
  it("maps id → miles, preferring OBD over GPS", () => {
    const m = parseVehicleStatsOdometer({
      data: [
        { id: "1", obdOdometerMeters: { value: 1609344 }, gpsOdometerMeters: { value: 999 } }, // 1000 mi
        { id: "2", gpsOdometerMeters: { value: 1609344 } }, // GPS fallback → 1000 mi
        { id: "3" }, // no reading → omitted
      ],
    });
    expect(m.get("1")).toBe(1000);
    expect(m.get("2")).toBe(1000);
    expect(m.has("3")).toBe(false);
  });
});

describe("parseSamsaraTrailers", () => {
  it("maps trailer identity and coerces year; skips id-less rows", () => {
    const t = parseSamsaraTrailers({
      data: [
        { id: "asset-1", name: "R-402", make: "Utility", model: "3000R", year: "2022", licensePlate: "TR402", serialNumber: "SN9" },
        { id: "", name: "x" },
      ],
    });
    expect(t).toHaveLength(1);
    expect(t[0]).toEqual({ samsaraId: "asset-1", name: "R-402", make: "Utility", model: "3000R", year: 2022, licensePlate: "TR402", serial: "SN9" });
  });
});

describe("parseTrailerAssignments (latest tractor per trailer)", () => {
  it("keeps the most-recent vehicle per trailer (flat + grouped shapes)", () => {
    const links = parseTrailerAssignments({
      data: [
        { trailer: { id: "t1" }, vehicle: { id: "v-old" }, startTime: "2026-06-01T00:00:00Z" },
        { trailer: { id: "t1" }, vehicle: { id: "v-new" }, startTime: "2026-06-20T00:00:00Z" },
        { trailer: { id: "t2" }, assignments: [{ vehicleId: "v9", startTime: "2026-06-10T00:00:00Z" }] },
      ],
    });
    expect(links).toContainEqual({ trailerSamsaraId: "t1", vehicleSamsaraId: "v-new" });
    expect(links).toContainEqual({ trailerSamsaraId: "t2", vehicleSamsaraId: "v9" });
    expect(links).toHaveLength(2);
  });
});

describe("parseSamsaraDrivers", () => {
  it("maps identity + phone and skips id-less rows", () => {
    const d = parseSamsaraDrivers({
      data: [
        { id: "d1", name: "Marcus Reyes", phone: "555-0101", driverActivationStatus: "active" },
        { id: "d2", name: "Dana", phone: "", driverActivationStatus: "deactivated" },
        { name: "no id" },
      ],
    });
    expect(d).toHaveLength(2);
    expect(d[0]).toEqual({ samsaraId: "d1", name: "Marcus Reyes", phone: "555-0101", active: true });
    expect(d[1]!.phone).toBeNull();
    expect(d[1]!.active).toBe(false);
  });
});

describe("parseCurrentAssignments (latest driver per vehicle)", () => {
  it("keeps the most-recent assignment per vehicle — including ended HOS segments", () => {
    // Real Samsara shape: flat rows, completed HOS segments with a past endTime. All should count.
    const links = parseCurrentAssignments({
      data: [
        { vehicle: { id: "556" }, driver: { id: "d-mk" }, startTime: "2026-06-30T20:06:51Z", endTime: "2026-06-30T20:52:16Z" },
        { vehicle: { id: "556" }, driver: { id: "d-mk" }, startTime: "2026-07-01T11:05:31Z", endTime: "2026-07-01T11:30:03Z" },
        { vehicle: { id: "512" }, driverId: "d-x", startTime: "2026-06-29T10:00:00Z", endTime: "2026-06-29T18:00:00Z" },
      ],
    });
    expect(links).toContainEqual({ vehicleSamsaraId: "556", driverSamsaraId: "d-mk" });
    expect(links).toContainEqual({ vehicleSamsaraId: "512", driverSamsaraId: "d-x" });
    expect(links).toHaveLength(2);
  });
  it("picks the driver with the latest start when a truck changed hands", () => {
    const links = parseCurrentAssignments({
      data: [
        { vehicle: { id: "v1" }, driver: { id: "old" }, startTime: "2026-06-01T00:00:00Z", endTime: "2026-06-01T08:00:00Z" },
        { vehicle: { id: "v1" }, driver: { id: "new" }, startTime: "2026-06-20T00:00:00Z", endTime: "2026-06-20T08:00:00Z" },
      ],
    });
    expect(links).toEqual([{ vehicleSamsaraId: "v1", driverSamsaraId: "new" }]);
  });
  it("supports the grouped shape too", () => {
    const links = parseCurrentAssignments({
      data: [{ vehicle: { id: "v3" }, assignments: [{ driverId: "d3", startTime: "2026-06-02T00:00:00Z" }] }],
    });
    expect(links).toEqual([{ vehicleSamsaraId: "v3", driverSamsaraId: "d3" }]);
  });
});

describe("findFuelingEvent (tank-rise anchor)", () => {
  // GPS sample builder with real coords for observed lat/lng.
  const G = (time: string, speedMph: number, address: string | null, odometerMiles: number | null, lat = 32.78, lng = -96.8) =>
    ({ time, lat, lng, speedMph, address, odometerMiles });
  const F = (time: string, percent: number) => ({ time, percent });

  it("anchors on the tank rise even when the EFS report time is hours off", () => {
    // EFS posted 09:00 (an auth time); the truck actually fueled at 14:00 — the fuel level jumps 20→85.
    const samples = [
      G("2026-06-30T13:00:00Z", 60, "I-20, Abilene, TX, 79601", 100000),
      G("2026-06-30T14:00:00Z", 0, "100 Fuel Rd, Dallas, TX, 75201", 100210),
      G("2026-06-30T14:20:00Z", 0, "100 Fuel Rd, Dallas, TX, 75201", 100210),
      G("2026-06-30T16:00:00Z", 55, "US-75, Dallas, TX, 75201", 100230),
    ];
    const fuel = [F("2026-06-30T13:00:00Z", 22), F("2026-06-30T14:00:00Z", 20), F("2026-06-30T14:30:00Z", 85), F("2026-06-30T16:00:00Z", 82)];
    const ev = findFuelingEvent(samples, fuel, { state: "TX", city: "DALLAS", gallons: 90, tankCapacityGal: 120, reportedAtIso: "2026-06-30T09:00:00" });
    expect(ev).not.toBeNull();
    expect(ev!.at).toBe("2026-06-30T14:00:00Z"); // the parked stop at the rise, NOT the 09:00 report time
    expect(ev!.odometerMiles).toBe(100210);
    expect(ev!.observedState).toBe("TX");
    expect(ev!.observedCity).toBe("Dallas");
    expect(ev!.pctBefore).toBe(20);
    expect(ev!.pctAfter).toBe(85);
    expect(ev!.riseGalObserved).toBeCloseTo(78, 0); // 65% of 120 gal
    expect(ev!.expectedGal).toBe(90);
    expect(ev!.observedLat).toBeCloseTo(32.78, 2);
  });

  it("picks the fill whose magnitude matches the billed gallons when there are two that day", () => {
    const samples = [
      G("2026-06-30T10:00:00Z", 0, "Pilot, Waco, TX, 76701", 100000),
      G("2026-06-30T18:00:00Z", 0, "Loves, Dallas, TX, 75201", 100300),
    ];
    // Fill 1: 20→50 (small, +30). Fill 2: 40→95 (large, +55). Billed 90 gal on a 120 tank → expect ~75%.
    const fuel = [
      F("2026-06-30T10:00:00Z", 20), F("2026-06-30T10:30:00Z", 50),
      F("2026-06-30T14:00:00Z", 42), F("2026-06-30T18:00:00Z", 40),
      F("2026-06-30T18:30:00Z", 95), F("2026-06-30T20:00:00Z", 92),
    ];
    const ev = findFuelingEvent(samples, fuel, { state: "TX", gallons: 90, tankCapacityGal: 120, reportedAtIso: "2026-06-30T18:00:00" });
    expect(ev!.at).toBe("2026-06-30T18:00:00Z"); // the bigger fill matching ~75%
    expect(ev!.pctBefore).toBe(40);
    expect(ev!.pctAfter).toBe(95);
  });

  it("ignores sensor noise (small wiggles never form a fueling rise)", () => {
    const samples = [G("2026-06-30T12:00:00Z", 55, "I-35, Austin, TX, 78701", 5000)];
    const fuel = [F("2026-06-30T10:00:00Z", 60), F("2026-06-30T11:00:00Z", 58), F("2026-06-30T12:00:00Z", 61), F("2026-06-30T13:00:00Z", 59)];
    expect(findFuelingEvent(samples, fuel, { state: "TX", gallons: 80, tankCapacityGal: 120, reportedAtIso: "2026-06-30T11:00:00" })).toBeNull();
  });

  it("returns null when there is no fuel-level data", () => {
    const samples = [G("2026-06-30T14:00:00Z", 0, "Loves, Dallas, TX, 75201", 100210)];
    expect(findFuelingEvent(samples, [], { state: "TX", gallons: 90, tankCapacityGal: 120, reportedAtIso: "2026-06-30T14:00:00" })).toBeNull();
  });

  it("still finds the rise when tank capacity is unknown (uses the biggest clear rise)", () => {
    const samples = [G("2026-06-30T14:00:00Z", 0, "Loves, Dallas, TX, 75201", 100210)];
    const fuel = [F("2026-06-30T13:30:00Z", 25), F("2026-06-30T14:30:00Z", 90)];
    const ev = findFuelingEvent(samples, fuel, { state: "TX", gallons: 90, tankCapacityGal: null, reportedAtIso: "2026-06-30T14:00:00" });
    expect(ev).not.toBeNull();
    expect(ev!.riseGalObserved).toBeNull(); // can't convert % → gallons without the tank
    expect(ev!.pctBefore).toBe(25);
    expect(ev!.pctAfter).toBe(90);
  });

  it("does not falsely confirm a tiny rise when a large fill was billed", () => {
    // Billed 90 gal (≈75% on 120) but the tank only rose 8% — below expected*0.4 (30%) → no confirmation.
    const samples = [G("2026-06-30T14:00:00Z", 0, "Loves, Dallas, TX, 75201", 100210)];
    const fuel = [F("2026-06-30T13:30:00Z", 40), F("2026-06-30T14:30:00Z", 48)];
    expect(findFuelingEvent(samples, fuel, { state: "TX", gallons: 90, tankCapacityGal: 120, reportedAtIso: "2026-06-30T14:00:00" })).toBeNull();
  });
});

describe("matchFuelingStop (timezone-robust, physical-stop anchored)", () => {
  const S = (
    time: string,
    speedMph: number | null,
    address: string | null,
    odometerMiles: number | null,
  ) => ({ time, lat: 0, lng: 0, speedMph, address, odometerMiles });

  it("reads odometer from the stop in the EFS state even when POS time is local (tz off by hours)", () => {
    // EFS says 14:30 in Texas (Central). True fueling ≈ 20:30 UTC. At 14:30 UTC the truck is moving;
    // at 20:30 UTC it is stopped at a TX truck stop. We must pick the stop, not the naive-time sample.
    const samples = [
      S("2026-06-30T14:30:00Z", 62, "I-20, Abilene, TX, 79601", 100000), // moving, wrong instant
      S("2026-06-30T20:25:00Z", 0, "100 Fuel Rd, Dallas, TX, 75201", 100210), // the actual stop
      S("2026-06-30T20:40:00Z", 3, "100 Fuel Rd, Dallas, TX, 75201", 100210),
    ];
    const r = matchFuelingStop(samples, { state: "TX" }, "2026-06-30T14:30:00", { stoppedMph: 5 });
    expect(r.odometerMiles).toBe(100210);
    expect(r.locationMatched).toBe(true);
    expect(r.matchedAt).toBe("2026-06-30T20:25:00Z");
  });

  it("flags a real mismatch: truck was NEVER in the EFS state all day (stopped in another state)", () => {
    const samples = [
      S("2026-06-30T09:00:00Z", 60, "I-35, Oklahoma City, OK, 73101", 100000),
      S("2026-06-30T20:25:00Z", 0, "Depot, Oklahoma City, OK, 73101", 100210),
      S("2026-06-30T20:40:00Z", 1, "Depot, Oklahoma City, OK, 73101", 100210),
    ];
    const r = matchFuelingStop(samples, { state: "TX" }, "2026-06-30T14:30:00", { stoppedMph: 5 });
    expect(r.locationMatched).toBe(false);
    expect(r.basis).toBe("not_in_state");
    expect(r.odometerMiles).toBeNull();
  });

  it("does NOT flag a mismatch when coverage is too thin (a couple of stray resolvable pings)", () => {
    // Only two pings resolved a state, both in OK — too little evidence to accuse. Report unknown, not a
    // mismatch (this was a common source of false location flags on days with sparse Samsara reverse-geo).
    const samples = [
      S("2026-06-30T20:25:00Z", 0, "Depot, Oklahoma City, OK, 73101", 100210),
      S("2026-06-30T20:40:00Z", 1, "Depot, Oklahoma City, OK, 73101", 100210),
    ];
    const r = matchFuelingStop(samples, { state: "TX" }, "2026-06-30T14:30:00", { stoppedMph: 5 });
    expect(r.basis).toBe("no_coverage");
    expect(r.locationMatched).toBeNull();
  });

  it("NO false mismatch: presence in the EFS state that day counts even if another stop is elsewhere", () => {
    // The Sturbridge/Benton bug: truck fueled in MA but also passed through ME. Old code matched the ME
    // highway point → false mismatch. Now any MA sample that day confirms presence → matched.
    const samples = [
      S("2026-07-01T08:15:00Z", 61, "I-95, Benton, ME, 04975", 5000), // passing through Maine (moving)
      S("2026-07-01T13:10:00Z", 0, "Rte 20, Sturbridge, MA, 01566", 5240), // the actual fueling stop
    ];
    const r = matchFuelingStop(samples, { state: "MA", city: "STURBRIDGE" }, "2026-07-01T08:15:00", { stoppedMph: 5 });
    expect(r.locationMatched).toBe(true);
    expect(r.basis).toBe("in_city");
    expect(r.odometerMiles).toBe(5240);
  });

  it("a moving-only pass through the EFS state still confirms presence (no odometer)", () => {
    const samples = [S("2026-06-30T20:25:00Z", 55, "I-20, Abilene, TX, 79601", 100000)]; // moving, in TX
    const r = matchFuelingStop(samples, { state: "TX" }, "2026-06-30T14:30:00", { stoppedMph: 5 });
    expect(r.locationMatched).toBe(true);
    expect(r.odometerMiles).toBeNull(); // no stopped sample to read an odometer from
  });

  it("returns unknown (not a mismatch) when there is NO resolvable GPS coverage that day", () => {
    const samples = [S("2026-06-30T20:25:00Z", 55, "unmarked road", 100000)]; // no parseable state
    const r = matchFuelingStop(samples, { state: "TX" }, "2026-06-30T14:30:00", { stoppedMph: 5 });
    expect(r.locationMatched).toBeNull();
    expect(r.basis).toBe("no_coverage");
  });

  it("without an EFS state, still recovers a best-effort odometer from the nearest stop", () => {
    const samples = [
      S("2026-06-30T13:00:00Z", 0, "Somewhere, ST, 00000", 100100),
      S("2026-06-30T14:30:00Z", 0, "Somewhere, ST, 00000", 100150),
    ];
    const r = matchFuelingStop(samples, { state: null }, "2026-06-30T14:30:00", { stoppedMph: 5 });
    expect(r.odometerMiles).toBe(100150);
    expect(r.locationMatched).toBeNull();
  });

  it("minSampleDistanceMiles finds the closest GPS approach to a point", () => {
    const samples = [
      { time: "t1", lat: 42.11, lng: -72.08, speedMph: 60, address: null, odometerMiles: null }, // ~near Sturbridge MA
      { time: "t2", lat: 44.6, lng: -69.55, speedMph: 0, address: null, odometerMiles: null }, // Benton ME (far)
    ];
    // Sturbridge, MA ≈ (42.1057, -72.0784)
    const d = minSampleDistanceMiles(samples, 42.1057, -72.0784);
    expect(d).not.toBeNull();
    expect(d!).toBeLessThan(5); // the first sample is essentially at the station
  });

  it("resolveLocationConfidence: proximity confirms; else falls back to state presence", () => {
    // GPS came within the radius → confirmed regardless of state result
    expect(resolveLocationConfidence({ locationMatched: false }, 3, 20)).toEqual({ confidence: "gps_confirmed", matched: true });
    // No proximity, but truck was in-state → in_state
    expect(resolveLocationConfidence({ locationMatched: true }, null, 20)).toEqual({ confidence: "in_state", matched: true });
    // No proximity and never in-state → mismatch
    expect(resolveLocationConfidence({ locationMatched: false }, 120, 20)).toEqual({ confidence: "mismatch", matched: false });
    // Unknown coverage
    expect(resolveLocationConfidence({ locationMatched: null }, null, 20)).toEqual({ confidence: "unknown", matched: null });
  });

  it("resolveLocationConfidence: a near city-centroid distance VETOes a would-be mismatch", () => {
    const veto = { minMismatchMiles: 50 };
    // Stop says mismatch, but the truck came within 12 mi of the claimed station's town → don't accuse.
    expect(resolveLocationConfidence({ locationMatched: false }, null, 0.5, { nearMiles: 12, ...veto }))
      .toEqual({ confidence: "unknown", matched: null });
    // Truck was 300 mi away → the mismatch stands (real "card used where the truck wasn't").
    expect(resolveLocationConfidence({ locationMatched: false }, null, 0.5, { nearMiles: 300, ...veto }))
      .toEqual({ confidence: "mismatch", matched: false });
    // No station coords at all (nearMiles null) → veto can't apply, mismatch stands.
    expect(resolveLocationConfidence({ locationMatched: false }, null, 0.5, { nearMiles: null, ...veto }))
      .toEqual({ confidence: "mismatch", matched: false });
    // A confirmed site proximity still wins over everything.
    expect(resolveLocationConfidence({ locationMatched: false }, 0.3, 0.5, { nearMiles: 0.3, ...veto }))
      .toEqual({ confidence: "gps_confirmed", matched: true });
  });

  it("recovers the odometer by INTERPOLATION when the stop's own ping has no odometer", () => {
    // Samsara doesn't stamp an odometer on every GPS ping. The truck is parked at the TX stop from
    // 20:25–20:40 but those pings carry no odometer; the bracketing readings do. The odometer at the
    // stop equals the interpolated value (parked → flat), so we recover it instead of falling back.
    const samples = [
      S("2026-06-30T14:30:00Z", 62, "I-20, Abilene, TX, 79601", 100000), // moving, has odo
      S("2026-06-30T20:25:00Z", 0, "100 Fuel Rd, Dallas, TX, 75201", null), // the stop, no odo on ping
      S("2026-06-30T20:40:00Z", 0, "100 Fuel Rd, Dallas, TX, 75201", null),
      S("2026-06-30T22:00:00Z", 60, "US-75, Dallas, TX, 75201", 100120), // later, has odo
    ];
    const r = matchFuelingStop(samples, { state: "TX" }, "2026-06-30T14:30:00", { stoppedMph: 5 });
    expect(r.locationMatched).toBe(true);
    expect(r.matchedAt).toBe("2026-06-30T20:25:00Z");
    expect(r.odometerMiles).not.toBeNull();
    // 100000 at 14:30 → 100120 at 22:00 (7.5h, 120mi). At 20:25 (5h55m in) ≈ 100094.7.
    expect(r.odometerMiles!).toBeCloseTo(100094.7, 0);
  });

  it("odometerAtTime interpolates linearly and clamps to the endpoints", () => {
    const samples = [
      S("2026-06-30T12:00:00Z", 60, "a", 1000),
      S("2026-06-30T12:00:00Z", 0, "b", null), // ignored (no odo)
      S("2026-06-30T14:00:00Z", 60, "c", 1100),
    ];
    expect(odometerAtTime(samples, "2026-06-30T13:00:00Z")).toBe(1050); // midpoint
    expect(odometerAtTime(samples, "2026-06-30T11:00:00Z")).toBe(1000); // before first → clamp
    expect(odometerAtTime(samples, "2026-06-30T15:00:00Z")).toBe(1100); // after last → clamp
    expect(odometerAtTime([S("t", 0, "x", null)], "2026-06-30T13:00:00Z")).toBeNull(); // none
  });

  it("approxFuelingUtcMs shifts local time by the station-state offset", () => {
    const naive = "2026-06-30T14:30:00";
    // TX (Central, +6) → 20:30 UTC
    expect(approxFuelingUtcMs(naive, "TX")).toBe(new Date("2026-06-30T20:30:00Z").getTime());
    // unknown state → unchanged
    expect(approxFuelingUtcMs(naive, null)).toBe(new Date("2026-06-30T14:30:00Z").getTime());
  });
});
