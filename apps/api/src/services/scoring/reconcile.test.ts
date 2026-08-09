import { describe, expect, it } from "vitest";
import { applyReconciledContext, mergeReconciliation, reconBasisRank, type ReconResult } from "./reconcile.js";
import { compareTxnRows, rowEventTime, rowTimeReliable } from "./loaders.js";
import type { FtxnRow } from "./loaders.js";

const result = (over: Partial<ReconResult> = {}): ReconResult => ({
  crossSourceOdometer: null,
  crossSourceOdometerAt: null,
  crossSourceOdometerSource: null,
  samsaraLocationMatched: null,
  locationConfidence: null,
  stationLat: null,
  stationLng: null,
  nearestStationMiles: null,
  locationEvidence: null,
  reconAt: null,
  tankFillShortGal: null,
  tankObservedRiseGal: null,
  tankPctBefore: null,
  tankPctAfter: null,
  observedState: null,
  observedCity: null,
  observedAddress: null,
  observedLat: null,
  observedLng: null,
  fuelingTimeBasis: null,
  reconCheckedAt: null,
  reconStatus: null,
  reconError: null,
  reconEvidenceVersion: 1,
  ...over,
});

describe("reconciliation evidence precedence", () => {
  it("uses a corroborated event time and marks it reliable", () => {
    const row = {
      id: "t1",
      fueled_at: "2026-08-08T18:00:00Z",
      fueled_at_precision: "instant",
      source: "efs",
      fueling_time_basis: "tank_confirmed",
      samsara_recon_at: "2026-08-08T12:00:00Z",
      samsara_location_matched: false,
    } as FtxnRow;
    expect(rowEventTime(row)).toBe("2026-08-08T12:00:00Z");
    expect(rowTimeReliable(row)).toBe(true);
  });

  it("orders a fill by event time before its stored business time", () => {
    const olderEvent = { id: "a", fueled_at: "2026-08-08T18:00:00Z", created_at: "2026-08-08T19:00:00Z", fueled_at_precision: "instant", source: "efs", fueling_time_basis: "tank_confirmed", samsara_recon_at: "2026-08-08T12:00:00Z", samsara_location_matched: true } as FtxnRow;
    const newerEvent = { id: "b", fueled_at: "2026-08-08T13:00:00Z", created_at: "2026-08-08T14:00:00Z", fueled_at_precision: "instant", source: "efs", fueling_time_basis: "tank_confirmed", samsara_recon_at: "2026-08-08T13:00:00Z", samsara_location_matched: true } as FtxnRow;
    expect(compareTxnRows(olderEvent, newerEvent)).toBeLessThan(0);
  });

  it("ranks fueling evidence from date-only through tank-confirmed", () => {
    expect(reconBasisRank(null)).toBe(0);
    expect(reconBasisRank("date_only")).toBe(1);
    expect(reconBasisRank("reported")).toBe(2);
    expect(reconBasisRank("stop_estimated")).toBe(3);
    expect(reconBasisRank("tank_confirmed")).toBe(4);
  });

  it("does not replace stronger stored evidence with a weaker live result", () => {
    const merged = mergeReconciliation(
      result({
        fuelingTimeBasis: "tank_confirmed",
        reconAt: "2026-08-08T12:00:00Z",
        tankObservedRiseGal: 90,
        stationLat: null,
        reconEvidenceVersion: 4,
      }),
      result({
        fuelingTimeBasis: "stop_estimated",
        reconAt: "2026-08-08T11:00:00Z",
        tankObservedRiseGal: 50,
        stationLat: 32.78,
        stationLng: -96.8,
      }),
    );

    expect(merged.reconAt).toBe("2026-08-08T12:00:00Z");
    expect(merged.tankObservedRiseGal).toBe(90);
    expect(merged.stationLat).toBe(32.78); // fills a missing legacy pin only
    expect(merged.reconEvidenceVersion).toBe(5);
  });

  it("applies live station coordinates to the current rule transaction immediately", () => {
    const txn = { stationLat: null, stationLng: null, eventAt: null, timeConfirmed: false, fueledAtPrecision: "instant" } as unknown as import("@fuelguard/shared").TxnView;
    const recon = result({ stationLat: 32.78, stationLng: -96.8, fuelingTimeBasis: "tank_confirmed", reconAt: "2026-08-08T12:00:00Z" });
    applyReconciledContext(recon, txn, { source: "efs" } as FtxnRow);
    expect(txn.stationLat).toBe(32.78);
    expect(txn.stationLng).toBe(-96.8);
    expect(txn.eventAt).toBe("2026-08-08T12:00:00Z");
    expect(txn.timeConfirmed).toBe(true);
  });

  it("accepts equal-or-stronger live evidence and retains non-null stored fields", () => {
    const merged = mergeReconciliation(
      result({
        fuelingTimeBasis: "stop_estimated",
        reconAt: "2026-08-08T12:00:00Z",
        crossSourceOdometer: 100000,
        stationLat: 32.7,
        reconEvidenceVersion: 2,
      }),
      result({
        fuelingTimeBasis: "tank_confirmed",
        reconAt: "2026-08-08T12:05:00Z",
        crossSourceOdometer: 100050,
        stationLng: -96.8,
      }),
    );

    expect(merged.reconAt).toBe("2026-08-08T12:05:00Z");
    expect(merged.crossSourceOdometer).toBe(100050);
    expect(merged.stationLat).toBe(32.7);
    expect(merged.stationLng).toBe(-96.8);
    expect(merged.reconEvidenceVersion).toBe(3);
  });
});
