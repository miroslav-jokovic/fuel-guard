import { describe, it, expect } from "vitest";
import { computeDetectionCoverage, type CoverageInput } from "./detectionCoverage.js";

const row = (over: Partial<CoverageInput>): CoverageInput => ({
  vehicle_id: "v1",
  driver_id: "d1",
  fueled_at: "2026-07-01T12:00:00Z",
  samsara_recon_at: null,
  samsara_odometer: null,
  samsara_location_confidence: null,
  fueling_time_basis: null,
  ...over,
});

describe("computeDetectionCoverage", () => {
  it("computes fleet attribution / reconciliation / verifiability shares", () => {
    const s = computeDetectionCoverage([
      row({ samsara_recon_at: "2026-07-01T12:00:00Z", samsara_odometer: 100, samsara_location_confidence: "gps_confirmed", fueling_time_basis: "tank_confirmed" }),
      row({ samsara_recon_at: "2026-07-02T12:00:00Z", samsara_odometer: null, samsara_location_confidence: "in_state", fueling_time_basis: "stop_estimated" }),
      row({ driver_id: null }), // unattributed + blind (no recon)
      row({ samsara_location_confidence: "unknown" }), // blind, location NOT judgeable
    ]);
    expect(s.totalFills).toBe(4);
    expect(s.unattributed).toBe(1);
    expect(s.attributedPct).toBe(75); // 3 of 4 have vehicle+driver
    expect(s.reconciledPct).toBe(50); // 2 of 4 reconciled
    expect(s.odometerPct).toBe(25); // only 1 has a fueling-time odometer
    expect(s.locationPct).toBe(50); // JUDGEABLE: gps_confirmed + in_state; unknown/null don't count
    expect(s.locationConfirmedPct).toBe(25); // CONFIRMED at station: only the 1 gps_confirmed fill
    expect(s.blindFills).toBe(2);
    expect(s.blindPct).toBe(50);
    expect(s.lastReconciledAt).toBe("2026-07-02T12:00:00.000Z"); // most recent recon
  });

  it("tallies the fueling-time-basis mix including 'none'", () => {
    const s = computeDetectionCoverage([
      row({ fueling_time_basis: "tank_confirmed" }),
      row({ fueling_time_basis: "reported" }),
      row({ fueling_time_basis: null }), // → none
      row({ fueling_time_basis: "date_only" }),
    ]);
    expect(s.timeBasis).toEqual({ tank_confirmed: 1, stop_estimated: 0, reported: 1, date_only: 1, none: 1 });
  });

  it("builds per-truck rows sorted by blind spots (worst first) and excludes unattributed from per-truck", () => {
    const s = computeDetectionCoverage([
      // truck A: 2 fills, both reconciled → not blind
      row({ vehicle_id: "A", samsara_recon_at: "2026-07-01T00:00:00Z" }),
      row({ vehicle_id: "A", samsara_recon_at: "2026-07-02T00:00:00Z" }),
      // truck B: 3 fills, none reconciled → very blind
      row({ vehicle_id: "B" }),
      row({ vehicle_id: "B" }),
      row({ vehicle_id: "B" }),
      // unattributed (no vehicle) → not a per-truck row
      row({ vehicle_id: null, driver_id: null }),
    ]);
    expect(s.totalTrucks).toBe(2);
    expect(s.perTruck[0]!.vehicleId).toBe("B"); // most blind fills first
    expect(s.perTruck[0]!.blindFills).toBe(3);
    expect(s.perTruck[0]!.blindPct).toBe(100);
    expect(s.perTruck[1]!.vehicleId).toBe("A");
    expect(s.perTruck[1]!.reconciledPct).toBe(100);
  });

  it("handles an empty fleet without dividing by zero", () => {
    const s = computeDetectionCoverage([]);
    expect(s.totalFills).toBe(0);
    expect(s.attributedPct).toBe(0);
    expect(s.blindPct).toBe(0);
    expect(s.perTruck).toEqual([]);
    expect(s.lastReconciledAt).toBeNull();
  });
});
