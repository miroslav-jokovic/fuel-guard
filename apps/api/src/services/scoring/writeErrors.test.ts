import { describe, it, expect } from "vitest";
import type { TxnView } from "@silvicom/shared";
import { healMissingAttribution } from "./context.js";
import { learnVehicleValues } from "./learnVehicle.js";
import { createSupabaseRecorder, type RecordedQuery } from "../../testing/supabaseRecorder.js";

/**
 * Regression test for audit 2026-08-09 finding E — SWALLOWED write errors.
 *
 * Three writes in the scoring path called `admin.from(...).update(...)` and dropped the returned
 * `{ error }`, then mutated in-memory state (or returned a verdict) as though the write had landed.
 * Every other write in this subsystem checks — persist.ts throws on all five of its writes, and
 * reconcile.ts throws on a failed lookup — so this was an inconsistency, not a policy.
 *
 * It matters most on the attribution self-heal. A rejected `driver_id` update still set `txn.driverId`,
 * so the rest of scoring loaded driver-scoped context for that driver and persisted anomaly evidence
 * naming them — an accusation attached to someone the database never linked to the fill, and no error
 * anywhere to explain it. The `vehicle_id` branch reported "vehicle_filled", which makes the caller
 * re-score the fill under a truck the row does not belong to.
 */
const ORG = "org1";
const TXN = "t1";
const FILL_AT = "2026-06-10T12:00:00Z";
const REJECTED = { message: "new row violates row-level security policy" };

const txnMissingDriver = (): TxnView =>
  ({
    id: TXN,
    vehicleId: "v1",
    driverId: null,
    fueledAt: FILL_AT,
    eventAt: FILL_AT,
    fueledAtPrecision: "instant",
    timeConfirmed: true,
    tankType: "tractor",
    gallons: 120,
  }) as TxnView;

const txnMissingVehicle = (): TxnView =>
  ({ ...txnMissingDriver(), vehicleId: null, driverId: "d1" }) as TxnView;

/** One unambiguous logbook segment — the self-heal only acts when there is exactly one candidate. */
const segment = { driver_id: "d1", vehicle_id: "v1", status: "driving", started_at: "2026-06-10T06:00:00Z", ended_at: null };

describe("healMissingAttribution — a rejected write is not an attribution", () => {
  it("throws instead of attributing a driver the row was never updated with", async () => {
    const rec = createSupabaseRecorder({
      tables: { hos_duty_segments: [segment], fuel_transactions: { data: [], writeError: REJECTED } },
    });
    const txn = txnMissingDriver();

    await expect(healMissingAttribution(rec.client, ORG, TXN, txn)).rejects.toThrow(
      /could not attribute driver for t1/,
    );
    // The critical part: in-memory state did NOT move on. Before the fix this read "d1", and every
    // downstream stage — driver context, evidence, the anomaly's named subject — followed it.
    expect(txn.driverId).toBeNull();
  });

  it("throws instead of reporting vehicle_filled on a rejected write", async () => {
    const rec = createSupabaseRecorder({
      tables: { hos_duty_segments: [segment], fuel_transactions: { data: [], writeError: REJECTED } },
    });
    await expect(healMissingAttribution(rec.client, ORG, TXN, txnMissingVehicle())).rejects.toThrow(
      /could not attribute vehicle for t1/,
    );
  });

  it("still heals normally when the write succeeds", async () => {
    const rec = createSupabaseRecorder({ tables: { hos_duty_segments: [segment] } });
    const txn = txnMissingDriver();
    await expect(healMissingAttribution(rec.client, ORG, TXN, txn)).resolves.toBeNull();
    expect(txn.driverId).toBe("d1");
    expect(rec.writtenRows("fuel_transactions")).toEqual([{ driver_id: "d1" }]);
  });
});

describe("learnVehicleValues — a rejected write is not learned state", () => {
  /** Ten clean OBD pairs, each 10 miles apart → learnOdometerOffset returns an offset to persist. */
  const odometerPairs = Array.from({ length: 10 }, (_, i) => ({
    odometer: 100_000 + i * 500 + 10,
    samsara_odometer: 100_000 + i * 500,
  }));
  const fuelTransactions = (q: RecordedQuery) => {
    const select = q.ops.find((o) => o.method === "select")?.args[0];
    return typeof select === "string" && select.startsWith("odometer, samsara_odometer") ? odometerPairs : [];
  };

  it("throws when the learned per-truck state cannot be persisted", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        fuel_transactions: fuelTransactions,
        vehicles: { data: [{ org_id: ORG, tank_capacity_gal: 240, tank_capacity_source: "entered", observed_max_fill_gal: null }], writeError: REJECTED },
      },
    });
    await expect(
      learnVehicleValues(rec.client, "v1", { odometerOffset: 0, odometerOffsetSource: "auto" }),
    ).rejects.toThrow(/could not update learned state for vehicle v1/);
  });

  it("persists the learned offset when the write succeeds", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        fuel_transactions: fuelTransactions,
        vehicles: [{ org_id: ORG, tank_capacity_gal: 240, tank_capacity_source: "entered", observed_max_fill_gal: null }],
      },
    });
    await learnVehicleValues(rec.client, "v1", { odometerOffset: 0, odometerOffsetSource: "auto" });
    expect(rec.writtenRows("vehicles")).toEqual([{ odometer_offset: 10, odometer_offset_source: "auto" }]);
  });
});
