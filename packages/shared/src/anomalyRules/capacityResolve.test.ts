import { describe, it, expect } from "vitest";
import {
  learnSensorCapacity,
  resolveCapacity,
  capacityAlertTolerancePct,
  CAPACITY_DIVERGENCE_PCT,
} from "./capacityResolve.js";
import type { VehicleView } from "./types.js";

const vehicle: VehicleView = {
  id: "v1",
  fuelType: "diesel",
  tankCapacityGal: 120,
  baselineMpg: 6.5,
};

/** n fills that each imply ~`cap` gallons (billed = cap × riseFrac). */
const fills = (n: number, cap: number, riseFrac = 0.5) =>
  Array.from({ length: n }, () => ({
    gallons: cap * riseFrac,
    pctBefore: 40,
    pctAfter: 40 + riseFrac * 100,
  }));

describe("learnSensorCapacity (billed ÷ raw level-rise physics)", () => {
  it("returns null until enough valid observations", () => {
    expect(learnSensorCapacity(fills(4, 200))).toBeNull();
    expect(learnSensorCapacity(fills(5, 200))).not.toBeNull();
  });

  it("measures the true capacity from consistent fills", () => {
    expect(learnSensorCapacity(fills(8, 200))!.gallons).toBeCloseTo(200, 0);
    // Dual saddle tanks filled together: 100 gal raises the (equalized) level 50 points → 200 combined.
    expect(learnSensorCapacity(fills(10, 208, 0.48))!.gallons).toBeCloseTo(208, 0);
  });

  it("ignores small rises (sensor noise amplifies) and small fills", () => {
    const smallRise = Array.from({ length: 10 }, () => ({
      gallons: 30,
      pctBefore: 80,
      pctAfter: 92,
    })); // 12-pt rise
    expect(learnSensorCapacity(smallRise)).toBeNull();
    const smallFill = Array.from({ length: 10 }, () => ({
      gallons: 15,
      pctBefore: 40,
      pctAfter: 70,
    }));
    expect(learnSensorCapacity(smallFill)).toBeNull();
  });

  it("discards physically impossible implied capacities (theft fills can't train it)", () => {
    // 8 honest fills implying 200 + 6 theft fills billing 165 with only a 22-pt rise (implied 750 → discarded).
    const theft = Array.from({ length: 6 }, () => ({ gallons: 165, pctBefore: 40, pctAfter: 62 }));
    const learned = learnSensorCapacity([...fills(8, 200), ...theft]);
    expect(learned!.gallons).toBeCloseTo(200, 0);
  });

  it("returns no verdict on a bimodal spread (dual INDEPENDENT tanks, sensor sees one)", () => {
    // One-tank fills imply ~120; both-tank fills imply ~240 — no tight cluster → null.
    const mixed = [...fills(5, 120), ...fills(5, 240)];
    expect(learnSensorCapacity(mixed)).toBeNull();
  });

  it("missing percentages are skipped, not fatal", () => {
    const withGaps = [...fills(6, 200), { gallons: 100, pctBefore: null, pctAfter: 90 }];
    expect(learnSensorCapacity(withGaps)!.gallons).toBeCloseTo(200, 0);
  });
});

describe("resolveCapacity (sensor > entered > billed-history, with confidence)", () => {
  it("nothing usable → none (capacity rules stay off)", () => {
    const rc = resolveCapacity({ ...vehicle, tankCapacityGal: 0 });
    expect(rc.gallons).toBe(0);
    expect(rc.confidence).toBe("none");
  });

  it("entered only → low confidence, legacy value preserved", () => {
    const rc = resolveCapacity(vehicle);
    expect(rc.gallons).toBe(120);
    expect(rc.confidence).toBe("low");
    expect(rc.source).toBe("entered");
  });

  it("entered + corroborated billed history keeps the legacy raise (dual-tank)", () => {
    const rc = resolveCapacity({ ...vehicle, observedMaxFillGal: 210 });
    expect(rc.gallons).toBe(210);
    expect(rc.confidence).toBe("low");
    expect(rc.source).toBe("observed_fills");
  });

  it("sensor agrees with entered → high confidence, larger of the two", () => {
    const rc = resolveCapacity({ ...vehicle, sensorCapacityGal: 128 });
    expect(rc.gallons).toBe(128);
    expect(rc.confidence).toBe("high");
    expect(rc.divergent).toBe(false);
  });

  it("sensor contradicts entered → physics wins, divergent flagged (both directions)", () => {
    const up = resolveCapacity({ ...vehicle, sensorCapacityGal: 208 }); // under-entered dual-tank
    expect(up.gallons).toBe(208);
    expect(up.confidence).toBe("medium");
    expect(up.divergent).toBe(true);
    const down = resolveCapacity({ ...vehicle, tankCapacityGal: 300, sensorCapacityGal: 200 }); // over-entered
    expect(down.gallons).toBe(200); // downward correction — impossible pre-WP-CAP
    expect(down.divergent).toBe(true);
  });

  it("sensor with no entered capacity REVIVES detection (was silently dead at cap 0)", () => {
    const rc = resolveCapacity({ ...vehicle, tankCapacityGal: 0, sensorCapacityGal: 200 });
    expect(rc.gallons).toBe(200);
    expect(rc.confidence).toBe("medium");
    expect(rc.source).toBe("sensor");
  });

  it("divergence threshold is the exported constant", () => {
    const justInside = resolveCapacity({
      ...vehicle,
      sensorCapacityGal: 120 * (1 + CAPACITY_DIVERGENCE_PCT / 100),
    });
    expect(justInside.divergent).toBe(false);
    const justOutside = resolveCapacity({
      ...vehicle,
      sensorCapacityGal: 120 * (1 + (CAPACITY_DIVERGENCE_PCT + 1) / 100),
    });
    expect(justOutside.divergent).toBe(true);
  });
});

describe("capacityAlertTolerancePct (confidence-tiered overage)", () => {
  it("verified capacity keeps the tight org tolerance; unverified widens", () => {
    expect(capacityAlertTolerancePct("high", 5)).toBe(5);
    expect(capacityAlertTolerancePct("medium", 5)).toBe(10);
    expect(capacityAlertTolerancePct("low", 5)).toBe(15);
  });
  it("never goes below the org-configured tolerance", () => {
    expect(capacityAlertTolerancePct("high", 20)).toBe(20);
    expect(capacityAlertTolerancePct("medium", 20)).toBe(20);
    expect(capacityAlertTolerancePct("low", 20)).toBe(20);
  });
});
