import { describe, it, expect } from "vitest";
import {
  recentMpgSeries,
  effectiveBaseline,
  MIN_TRAINABLE_MPG,
  MAX_TRAINABLE_MPG,
} from "./helpers.js";
import type { TxnView, VehicleView } from "./types.js";

// Minimal fills spaced by odometer + gallons so computedMpg = (Δodometer)/gallons.
function fill(odometer: number, gallons: number, i: number): TxnView {
  return {
    id: `t${i}`,
    vehicleId: "v1",
    driverId: null,
    cardNum: null,
    gallons,
    odometer,
    fueledAt: `2026-06-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
  } as unknown as TxnView;
}

const veh = (baselineMpg: number | null): VehicleView =>
  ({ baselineMpg }) as unknown as VehicleView;

describe("MPG baseline training guard", () => {
  it("excludes impossibly-high per-fill MPG (partial fill carrying full miles) from the series", () => {
    // Real ~7 MPG fills, plus one artifact: 640 miles on a 10-gal splash → 64 MPG.
    const txns = [
      fill(0, 100, 0),
      fill(700, 100, 1), // 700 mi / 100 gal = 7
      fill(1400, 100, 2), // 7
      fill(2040, 10, 3), // 640 / 10 = 64  ← artifact, must be dropped
      fill(2800, 100, 4), // 760 / 100 = 7.6
    ];
    const series = recentMpgSeries(txns);
    expect(series.every((m) => m >= MIN_TRAINABLE_MPG && m <= MAX_TRAINABLE_MPG)).toBe(true);
    expect(series).not.toContain(64);
    // Baseline is the realistic ~7, NOT dragged up by the 64.
    expect(effectiveBaseline(veh(null), txns)).toBeLessThan(MAX_TRAINABLE_MPG);
    expect(effectiveBaseline(veh(null), txns)).toBeGreaterThan(5);
  });

  it("excludes near-zero MPG (missed/short odometer) too", () => {
    const txns = [fill(0, 100, 0), fill(50, 100, 1), fill(750, 100, 2), fill(1450, 100, 3)]; // one 0.5 MPG artifact
    expect(recentMpgSeries(txns)).not.toContain(0.5);
  });

  it("falls back to a stored baseline only when it is itself plausible", () => {
    const one = [fill(0, 100, 0), fill(700, 100, 1)]; // <3 plausible → use stored
    expect(effectiveBaseline(veh(6.5), one)).toBe(6.5); // plausible stored → used
    expect(effectiveBaseline(veh(64.22), one)).toBeNull(); // corrupted stored → ignored (rule skips)
    expect(effectiveBaseline(veh(null), one)).toBeNull();
  });
});
