import { describe, it, expect } from "vitest";
import type { TxnView } from "@silvicom/shared";
import { healMissingAttribution } from "./context.js";
import { reattributeIfNeeded } from "./scoreTransaction.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";

/**
 * Every attribution write in scoring names the org as well as the row (handoff 2026-10-05, follow-up 4b).
 *
 * The API writes with the SERVICE ROLE, so RLS does not stand behind these updates. Before this,
 * the three `fuel_transactions` updates here (logbook self-heal × 2, GPS reattribution) filtered on
 * `id` alone: a txnId from the wrong tenant — a stale job payload, a mixed-up batch — would have
 * rewritten another org's fill and its vehicle/driver attribution. `.eq("org_id", orgId)` makes such
 * an update a no-op instead.
 */
const ORG = "org1";
const TXN = "t1";
const FILL_AT = "2026-06-10T12:00:00Z";

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

const segment = { driver_id: "d1", vehicle_id: "v1", status: "driving", started_at: "2026-06-10T06:00:00Z", ended_at: null };

function fuelTxnWrites(rec: ReturnType<typeof createSupabaseRecorder>) {
  return rec.writes().filter((q) => q.table === "fuel_transactions");
}

describe("scoring attribution writes are org-scoped", () => {
  it("logbook self-heal of a missing driver", async () => {
    const rec = createSupabaseRecorder({ tables: { hos_duty_segments: [segment] } });
    await healMissingAttribution(rec.client, ORG, TXN, txnMissingDriver());
    expect(fuelTxnWrites(rec)).toHaveLength(1);
    expectOrgScoped(rec, ORG);
  });

  it("logbook self-heal of a missing vehicle", async () => {
    const rec = createSupabaseRecorder({ tables: { hos_duty_segments: [segment] } });
    const txn = { ...txnMissingDriver(), vehicleId: null, driverId: "d1" } as TxnView;
    await expect(healMissingAttribution(rec.client, ORG, TXN, txn)).resolves.toBe("vehicle_filled");
    expect(fuelTxnWrites(rec)).toHaveLength(1);
    expectOrgScoped(rec, ORG);
  });

  it("GPS-contradicted reattribution to the logbook truck", async () => {
    const rec = createSupabaseRecorder({ tables: {} });
    const done = await reattributeIfNeeded(
      rec.client,
      ORG,
      TXN,
      { fueled_at: FILL_AT } as never,
      { vehicleId: "v1" } as never,
      { verdict: "suspect", logbookVehicleId: "v2" } as never,
      { samsaraLocationMatched: false, nearestStationMiles: null } as never,
      false,
    );
    expect(done).toBe(true);
    expect(fuelTxnWrites(rec)).toHaveLength(1);
    expectOrgScoped(rec, ORG);
  });
});
