import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveCapacity, type TxnView, type VehicleView } from "@silvicom/shared";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import type { FtxnRow, ScoreOpts } from "./loaders.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * Regression test for audit 2026-08-09 finding A — the capacity SOURCE mismatch.
 *
 * Every capacity rule judges a fill against `resolveCapacity(vehicle).gallons` (sensor-measured physics
 * > entered nameplate > billed history), but this loader used to hand the Samsara tank reconciliation
 * `vehicle.tankCapacityGal` — the raw number a human typed into the vehicle record. On a truck whose
 * nameplate was mis-entered as 120 for a true 240-gal tank, every reconciled fill's observed rise was
 * then measured against half the real tank, the observed/billed ratios clustered at ~0.5,
 * learnTankSensorReliability read that as "this sensor only sees one of two tanks" and never marked the
 * sensor reliable — and `ruleEligible` permanently switched off SIX detectors (tank_space_exceeded,
 * tank_fill_short, mpg_deviation, implausible_topoff, mpg_sustained_decline, tank_chronic_short) on
 * exactly the trucks the capacity resolver exists to rescue.
 *
 * The reconciler cannot catch this itself: a capacity arriving as a bare number carries no evidence of
 * which source produced it. So the assertion is on what this loader HANDS OVER — the vehicle, from
 * which there is exactly one capacity to resolve.
 */
const mocks = vi.hoisted(() => ({ reconcileWithSamsara: vi.fn() }));
vi.mock("../samsaraRecon.js", () => ({
  reconcileWithSamsara: mocks.reconcileWithSamsara,
  SamsaraUnavailableError: class SamsaraUnavailableError extends Error {},
}));

const { resolveReconciliation } = await import("./reconcile.js");

const ORG = "org1";
const env = testEnv();

/** A real 240-gal truck whose nameplate was typed as 120 — the case the resolver exists to rescue. */
const misEntered: VehicleView = {
  id: "v1",
  fuelType: "diesel",
  tankCapacityGal: 120,
  sensorCapacityGal: 240,
  sensorCapacitySamples: 9,
  baselineMpg: 6.2,
};

const txn = (): TxnView =>
  ({
    id: "t1",
    vehicleId: "v1",
    fueledAt: "2026-06-10T12:00:00Z",
    fueledAtPrecision: "instant",
    gallons: 180,
    tankType: "tractor",
  }) as TxnView;

const row = (): FtxnRow =>
  ({
    id: "t1",
    vehicle_id: "v1",
    fueled_at: "2026-06-10T12:00:00Z",
    created_at: "2026-06-10T12:00:00Z",
    source: "efs",
    city: "Dallas",
    state: "TX",
    location_text: "PILOT DALLAS 305",
    gallons: 180,
  }) as unknown as FtxnRow;

describe("resolveReconciliation — capacity source", () => {
  beforeEach(() => {
    mocks.reconcileWithSamsara.mockReset();
    mocks.reconcileWithSamsara.mockResolvedValue(null);
  });

  it("reconciles the tank against the RESOLVED capacity, never the raw entered nameplate", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: [] } });
    await resolveReconciliation(rec.client, env, ORG, row(), txn(), misEntered, "sv1", {} as ScoreOpts);

    expect(mocks.reconcileWithSamsara).toHaveBeenCalledTimes(1);
    const input = mocks.reconcileWithSamsara.mock.calls[0]![3] as {
      vehicle?: VehicleView | null;
      tankCapacityGal?: unknown;
    };
    // The whole truck is handed over, so the reconciler resolves the one capacity the rules use…
    expect(input.vehicle).toBe(misEntered);
    expect(resolveCapacity(input.vehicle!).gallons).toBe(240);
    // …and the raw nameplate is not offered as a second opinion it could pick up instead.
    expect(input.tankCapacityGal).toBeUndefined();
    expect(misEntered.tankCapacityGal).toBe(120); // the wrong number is still ON the record, unread
  });

  it("passes no truck at all when the fill has no vehicle (capacity honestly unknown)", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: [] } });
    const noVehicle = { ...txn(), vehicleId: null } as TxnView;
    await resolveReconciliation(rec.client, env, ORG, row(), noVehicle, misEntered, null, {} as ScoreOpts);
    // A vehicle-less fill skips reconciliation entirely — it never invents a capacity for one.
    expect(mocks.reconcileWithSamsara).not.toHaveBeenCalled();
  });
});
