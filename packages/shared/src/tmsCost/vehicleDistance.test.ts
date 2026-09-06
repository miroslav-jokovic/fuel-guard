import { describe, it, expect } from "vitest";
import {
  distanceByVehicle,
  fleetDistance,
  MAX_PERIOD_MILES_PER_DAY,
  type VehicleOdometerReading,
} from "./vehicleDistance.js";

/**
 * Distance from odometer readings (W3), by the method Samsara's own guide prescribes: read the
 * history, subtract the first reading from the last. There is no distance-over-range endpoint, and
 * the source ranking below — ECU, then GPS distance, then GPS-plus-offset — is the vendor's.
 *
 * What is pinned is every way a counter lies. A reset reads as a huge negative; a gateway moved to
 * another truck reads as a jump; a truck that reported once reads as zero miles. None of those is a
 * distance, and each has to come back as `null` with a reason rather than as a number a per-mile
 * figure would then divide by.
 */

const MILE = 1609.344;
const read = (
  vehicleId: string,
  readingAt: string,
  miles: number,
  source: VehicleOdometerReading["source"] = "obd",
): VehicleOdometerReading => ({ vehicleId, readingAt, meters: miles * MILE, source });

const WEEK = ["2026-07-06T00:00:00Z", "2026-07-13T00:00:00Z"] as const;
const inWeek = (readings: VehicleOdometerReading[]) => distanceByVehicle(readings, WEEK[0], WEEK[1]);

/**
 * The collector's real shape: one reading late on each day. The opening odometer for a week is
 * therefore the reading from the day BEFORE it starts, which is the whole point of bounding.
 */
const dailyReads = (vehicleId: string, startMiles: number, perDay: number[]) => {
  const days = ["2026-07-05", "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"];
  const out: VehicleOdometerReading[] = [read(vehicleId, `${days[0]}T23:50:00Z`, startMiles)];
  let miles = startMiles;
  for (let i = 0; i < perDay.length; i++) {
    miles += perDay[i]!;
    out.push(read(vehicleId, `${days[i + 1]}T23:50:00Z`, miles));
  }
  return out;
};

describe("distanceByVehicle", () => {
  it("is the closing odometer less the opening one, in miles", () => {
    const [d] = inWeek([
      read("v1", "2026-07-05T23:50:00Z", 412_000),
      read("v1", "2026-07-09T12:00:00Z", 413_100),
      read("v1", "2026-07-12T23:00:00Z", 414_500),
    ]);
    expect(d!.miles).toBe(2500);
    expect(d!.fromAt).toBe("2026-07-05T23:50:00Z");
    expect(d!.toAt).toBe("2026-07-12T23:00:00Z");
    expect(d!.source).toBe("obd");
    expect(d!.reason).toBeNull();
  });

  /**
   * The undercount this design exists to prevent. With one reading late each day, the readings
   * strictly INSIDE a Monday-to-Monday week span Monday evening to Sunday evening — six days of
   * driving reported as a week. Bounding on the previous day's reading recovers the seventh.
   */
  it("counts the first day of the week, not six sevenths of it", () => {
    const [d] = inWeek(dailyReads("v1", 400_000, [100, 100, 100, 100, 100, 100, 100]));
    expect(d!.miles).toBe(700);
    expect(d!.fromAt).toBe("2026-07-05T23:50:00Z");
  });

  it("ignores readings after the period, so a week is the week", () => {
    const [d] = inWeek([
      read("v1", "2026-07-05T23:50:00Z", 412_000),
      read("v1", "2026-07-12T23:00:00Z", 412_600),
      read("v1", "2026-07-14T00:00:00Z", 999_999), // the following week
    ]);
    expect(d!.miles).toBe(600);
  });

  /**
   * The failure this exists for. An ECU counter that goes backwards means it reset, or the gateway
   * moved to another truck. `Math.abs` would turn a hardware event into a mileage figure.
   */
  it("refuses a counter that went backwards rather than taking its size", () => {
    const [d] = inWeek([
      read("v1", "2026-07-05T23:50:00Z", 412_000),
      read("v1", "2026-07-12T23:00:00Z", 11_000),
    ]);
    expect(d!.miles).toBeNull();
    expect(d!.reason).toContain("went backwards");
    expect(d!.reason).toContain("gateway moved");
  });

  it("refuses a delta no truck could have driven", () => {
    const [d] = inWeek([
      read("v1", "2026-07-05T23:50:00Z", 0),
      read("v1", "2026-07-06T23:00:00Z", MAX_PERIOD_MILES_PER_DAY + 500),
    ]);
    expect(d!.miles).toBeNull();
    expect(d!.reason).toContain("no truck does");
  });

  it("allows a long run over many days, because the ceiling is per day", () => {
    const [d] = inWeek([
      read("v1", "2026-07-05T23:50:00Z", 0),
      read("v1", "2026-07-12T00:00:00Z", 9_000), // 1,500/day over six days
    ]);
    expect(d!.miles).toBe(9000);
  });

  /** A truck that reported once is not a truck that did not move (D-FIN10). */
  it("gives no distance to a vehicle with a single reading, and says why", () => {
    const [d] = inWeek([read("v1", "2026-07-05T23:50:00Z", 412_000)]);
    expect(d!.miles).toBeNull();
    expect(d!.reason).toContain("needs two ends");
  });

  /** Without an opening odometer there is no period, however many readings follow it. */
  it("refuses a vehicle whose first reading lands after the period started", () => {
    const [d] = inWeek([
      read("v1", "2026-07-08T01:00:00Z", 412_000),
      read("v1", "2026-07-12T01:00:00Z", 412_500),
    ]);
    expect(d!.miles).toBeNull();
    expect(d!.reason).toContain("opening odometer is unknown");
  });

  /**
   * The ECU counter and the GPS counter have different origins — one starts at the engine's life,
   * the other at the gateway's install — so subtracting across them is a number with no meaning.
   */
  it("never mixes two counters, and prefers the ECU as the vendor does", () => {
    const [d] = inWeek([
      read("v1", "2026-07-05T23:50:00Z", 412_000, "obd"),
      read("v1", "2026-07-12T23:00:00Z", 412_600, "obd"),
      read("v1", "2026-07-05T23:50:00Z", 40, "gps_distance"),
      read("v1", "2026-07-12T23:00:00Z", 90, "gps_distance"),
    ]);
    expect(d!.source).toBe("obd");
    expect(d!.miles).toBe(600);
  });

  it("falls back to GPS distance when the ECU cannot answer the period", () => {
    const [d] = inWeek([
      read("v1", "2026-07-08T01:00:00Z", 412_000, "obd"), // no ECU reading opens the period
      read("v1", "2026-07-05T23:50:00Z", 40, "gps_distance"),
      read("v1", "2026-07-12T23:00:00Z", 590, "gps_distance"),
    ]);
    expect(d!.source).toBe("gps_distance");
    expect(d!.miles).toBe(550);
  });

  it("falls back past a BROKEN ECU counter rather than refusing the vehicle", () => {
    const [d] = inWeek([
      read("v1", "2026-07-05T23:50:00Z", 412_000, "obd"),
      read("v1", "2026-07-12T23:00:00Z", 11_000, "obd"), // reset
      read("v1", "2026-07-05T23:50:00Z", 40, "gps_distance"),
      read("v1", "2026-07-12T23:00:00Z", 340, "gps_distance"),
    ]);
    expect(d!.source).toBe("gps_distance");
    expect(d!.miles).toBe(300);
  });

  it("reports each vehicle separately, ordered so a diff is stable", () => {
    const d = inWeek([
      read("v2", "2026-07-05T23:50:00Z", 100),
      read("v2", "2026-07-12T01:00:00Z", 400),
      read("v1", "2026-07-05T23:50:00Z", 100),
      read("v1", "2026-07-12T01:00:00Z", 200),
    ]);
    expect(d.map((x) => x.vehicleId)).toEqual(["v1", "v2"]);
    expect(d.map((x) => x.miles)).toEqual([100, 300]);
  });

  it("has nothing to say about a period with no readings", () => {
    expect(inWeek([])).toEqual([]);
  });
});

describe("fleetDistance", () => {
  /**
   * The count of unmeasured trucks is the point of this function, not a footnote: a denominator
   * missing part of the fleet reads low on miles and high on cost, and looks entirely plausible.
   */
  it("sums what could be measured and counts what could not", () => {
    const total = fleetDistance([
      { vehicleId: "v1", miles: 1200.5, fromAt: "a", toAt: "b", source: "obd", reason: null },
      { vehicleId: "v2", miles: 800, fromAt: "a", toAt: "b", source: "obd", reason: null },
      { vehicleId: "v3", miles: null, fromAt: null, toAt: null, source: null, reason: "reset" },
    ]);
    expect(total).toEqual({ miles: 2000.5, measuredVehicles: 2, unmeasuredVehicles: 1 });
  });

  it("reports zero miles over no vehicles rather than throwing", () => {
    expect(fleetDistance([])).toEqual({ miles: 0, measuredVehicles: 0, unmeasuredVehicles: 0 });
  });
});
