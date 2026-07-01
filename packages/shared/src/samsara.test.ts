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
  parseSamsaraDrivers,
  parseCurrentAssignments,
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

describe("parseCurrentAssignments", () => {
  const now = "2026-06-30T00:00:00Z";
  it("keeps the active assignment per vehicle and tolerates both shapes", () => {
    const links = parseCurrentAssignments(
      {
        data: [
          { vehicle: { id: "v1" }, assignments: [{ driver: { id: "d1" }, startTime: "2026-06-01T00:00:00Z" }] },
          { vehicle: { id: "v2" }, assignments: [{ driver: { id: "d9" }, startTime: "2020-01-01T00:00:00Z", endTime: "2020-02-01T00:00:00Z" }] },
          { id: "v3", driverAssignments: [{ driverId: "d3", startTime: "2026-06-02T00:00:00Z" }] },
        ],
      },
      now,
    );
    expect(links).toEqual([
      { vehicleSamsaraId: "v1", driverSamsaraId: "d1" },
      { vehicleSamsaraId: "v3", driverSamsaraId: "d3" },
    ]);
  });
  it("picks the latest active assignment when several overlap", () => {
    const links = parseCurrentAssignments(
      {
        data: [
          {
            vehicle: { id: "v1" },
            assignments: [
              { driver: { id: "old" }, startTime: "2026-06-01T00:00:00Z" },
              { driver: { id: "new" }, startTime: "2026-06-20T00:00:00Z" },
            ],
          },
        ],
      },
      now,
    );
    expect(links).toEqual([{ vehicleSamsaraId: "v1", driverSamsaraId: "new" }]);
  });
});
