import { describe, it, expect } from "vitest";
import { computeReeferCoverage } from "./index.js";

const now = Date.parse("2026-07-06T00:00:00Z");
const r = (vehicle_id: string | null, tank: "tractor" | "reefer", gallons: number, fueled_at: string) =>
  ({ vehicle_id, tank_type: tank, gallons, fueled_at });

describe("computeReeferCoverage", () => {
  it("aggregates tractor/reefer gallons, reefer share, and days since last reefer", () => {
    const s = computeReeferCoverage(
      [
        r("v1", "tractor", 100, "2026-07-01T12:00:00Z"),
        r("v1", "reefer", 40, "2026-07-02T12:00:00Z"),
        r("v1", "reefer", 10, "2026-06-30T12:00:00Z"),
        r("v2", "tractor", 200, "2026-07-03T12:00:00Z"), // dry-van, no reefer
      ],
      now,
    );
    const v1 = s.perTruck.find((t) => t.vehicleId === "v1")!;
    expect(v1.tractorGal).toBe(100);
    expect(v1.reeferGal).toBe(50);
    expect(v1.reeferSharePct).toBe(round(50 / 150 * 100)); // ~33.3%
    expect(v1.reeferActive).toBe(true);
    expect(v1.lastReeferAt).toBe("2026-07-02T12:00:00.000Z"); // the most recent reefer fill
    expect(v1.daysSinceReefer).toBe(3); // Jul 2 12:00 → Jul 6 00:00 = 3.5d floored
    expect(v1.reeferFills).toBe(2);
    expect(v1.avgGalPerFill).toBe(25); // 50 gal / 2 fills
    expect(v1.avgCadenceDays).toBe(2); // Jun 30 → Jul 2 = 2d across 1 gap
    expect(v1.reeferSpend).toBe(0); // no cost supplied
    expect(v1.primaryDriverId).toBeNull();

    const v2 = s.perTruck.find((t) => t.vehicleId === "v2")!;
    expect(v2.reeferActive).toBe(false);
    expect(v2.reeferSharePct).toBe(0);
    expect(v2.daysSinceReefer).toBeNull();
  });

  it("fleet median share is over reefer-active trucks only (dry-van 0% doesn't drag it down)", () => {
    const s = computeReeferCoverage(
      [
        r("a", "tractor", 90, "2026-07-01T00:00:00Z"), r("a", "reefer", 10, "2026-07-01T00:00:00Z"), // 10%
        r("b", "tractor", 80, "2026-07-01T00:00:00Z"), r("b", "reefer", 20, "2026-07-01T00:00:00Z"), // 20%
        r("c", "tractor", 100, "2026-07-01T00:00:00Z"), // dry-van 0% — excluded from baseline
      ],
      now,
    );
    expect(s.reeferActiveCount).toBe(2);
    expect(s.totalTrucks).toBe(3);
    expect(s.fleetMedianSharePct).toBe(15); // median of [10, 20]
  });

  it("sums reefer spend and picks the driver with the most reefer fills", () => {
    const s = computeReeferCoverage(
      [
        { vehicle_id: "v1", tank_type: "reefer", gallons: 40, fueled_at: "2026-07-01T12:00:00Z", total_cost: 120, driver_id: "d1" },
        { vehicle_id: "v1", tank_type: "reefer", gallons: 30, fueled_at: "2026-07-03T12:00:00Z", total_cost: 90, driver_id: "d1" },
        { vehicle_id: "v1", tank_type: "reefer", gallons: 20, fueled_at: "2026-07-05T12:00:00Z", total_cost: 60, driver_id: "d2" },
        { vehicle_id: "v1", tank_type: "tractor", gallons: 100, fueled_at: "2026-07-02T12:00:00Z", total_cost: 400, driver_id: "d1" },
      ],
      now,
    );
    const v1 = s.perTruck.find((t) => t.vehicleId === "v1")!;
    expect(v1.reeferSpend).toBe(270); // tractor cost excluded
    expect(v1.reeferFills).toBe(3);
    expect(v1.primaryDriverId).toBe("d1"); // 2 reefer fills vs d2's 1
    expect(v1.avgCadenceDays).toBe(2); // Jul 1 → Jul 5 = 4d across 2 gaps
  });

  it("ignores unattributed rows and handles an empty fleet", () => {
    expect(computeReeferCoverage([r(null, "reefer", 40, "2026-07-01T00:00:00Z")], now).perTruck).toEqual([]);
    expect(computeReeferCoverage([], now).fleetMedianSharePct).toBeNull();
  });
});

function round(n: number) {
  return Math.round(n * 10) / 10;
}
