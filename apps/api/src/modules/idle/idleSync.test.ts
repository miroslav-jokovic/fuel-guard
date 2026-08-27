import { describe, it, expect } from "vitest";
import { syncIdleEvents } from "./idleSync.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * Migrated off the local `makeAdmin` Proxy (audit 2026-08-09, Stage 2.5). Attribution is the whole
 * point of this pipeline: an idle event is pinned to a vehicle and a driver by looking them up by
 * SAMSARA id, which is only unique within the fleet that owns the integration. Without
 * `.eq("org_id", …)` on those lookups — the filter the old fake discarded — an event could be
 * attributed to another tenant's driver and priced off their fuel history. Same fixtures and the same
 * derived numbers as before, now with the scope asserted.
 */
const ORG = "org1";

describe("syncIdleEvents (end-to-end pipeline)", () => {
  it("parses, classifies, prices, and attributes idle events into idle_events rows", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        fuel_transactions: [{ price_per_gal: 4 }],
        idle_settings: { data: null }, // use defaults (comfort 20-85, min 5 min, ...)
        vehicles: [{ id: "veh1", samsara_vehicle_id: "v1", has_apu: false }],
        drivers: [
          { id: "d1", samsara_driver_id: "op1" },
          { id: "d2", samsara_driver_id: "op2" },
        ],
        driver_vehicle_assignments: [
          {
            vehicle_samsara_id: "v1",
            driver_samsara_id: "op2",
            start_at: "2026-07-09T00:00:00Z",
            end_at: null,
          },
        ],
      },
    });

    const raw = {
      data: [
        // A: comfortable 68F, has an operator, measured fuel → discretionary, directly attributed, measured gallons.
        {
          eventUuid: "A",
          startTime: "2026-07-10T12:00:00Z",
          durationMilliseconds: 3_600_000,
          asset: { id: "v1" },
          operator: { id: "op1" },
          airTemperatureMillicelsius: 20_000,
          fuelConsumedMilliliters: 1000,
        },
        // B: freezing 14F, NO operator, no APU → justified (weather), attributed via assignment (inferred).
        {
          eventUuid: "B",
          startTime: "2026-07-10T00:00:00Z",
          durationMilliseconds: 7_200_000,
          asset: { id: "v1" },
          airTemperatureMillicelsius: -10_000,
        },
      ],
    };

    const env = testEnv({ WEATHER_BACKFILL_ENABLED: false });
    const res = await syncIdleEvents(rec.client, env, ORG, { idlingFetcher: async () => raw });

    expect(res.fetched).toBe(2);
    const rows = rec.writtenRows("idle_events");
    expect(rows).toHaveLength(2);
    const A = rows.find((r) => r.samsara_event_id === "A") as Record<string, unknown>;
    const B = rows.find((r) => r.samsara_event_id === "B") as Record<string, unknown>;

    // A — discretionary, direct attribution, measured gallons passed through.
    expect(A.classification).toBe("discretionary");
    expect(A.driver_id).toBe("d1");
    expect(A.driver_source).toBe("direct");
    expect(A.vehicle_id).toBe("veh1");
    expect(A.fuel_gal).toBeCloseTo(0.264, 3);
    expect(A.idle_gal).toBeCloseTo(0.264, 3);
    expect(Number(A.cost_usd)).toBeCloseTo(0.264 * 4, 2);

    // B — weather-justified, inferred attribution from the assignment covering that time.
    expect(B.classification).toBe("justified");
    expect(B.driver_id).toBe("d2");
    expect(B.driver_source).toBe("inferred");
    expect(B.fuel_gal).toBeNull();
    expect(Number(B.idle_gal)).toBeGreaterThan(0); // estimated (learned/fleet rate, temperature-adjusted)

    // Every read that fed those two rows — price history, thresholds, vehicle/driver resolution,
    // assignments — and every row written names this org.
    expectOrgScoped(rec, ORG);
  });
});
