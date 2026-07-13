/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncIdleEvents } from "./idleSync.js";
import type { Env } from "../env.js";

/**
 * A tiny chainable Supabase fake: every builder method returns the same node (so any `.select().eq().not()...`
 * chain works), awaiting a node yields that table's fixture, and `.upsert()` captures the written rows.
 */
function makeAdmin(fixtures: Record<string, { data: unknown }>) {
  const captured: Record<string, Record<string, unknown>[]> = {};
  function node(table: string): any {
    const result = fixtures[table] ?? { data: [] };
    const proxy: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result);
        if (prop === "upsert")
          return (rows: unknown) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            (captured[table] ||= []).push(...(arr as Record<string, unknown>[]));
            return Promise.resolve({ error: null });
          };
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  }
  return { admin: { from: (t: string) => node(t) } as unknown as SupabaseClient, captured };
}

describe("syncIdleEvents (end-to-end pipeline)", () => {
  it("parses, classifies, prices, and attributes idle events into idle_events rows", async () => {
    const { admin, captured } = makeAdmin({
      fuel_transactions: { data: [{ price_per_gal: 4 }] },
      idle_settings: { data: null }, // use defaults (comfort 20-85, min 5 min, ...)
      vehicles: { data: [{ id: "veh1", samsara_vehicle_id: "v1", has_apu: false }] },
      drivers: {
        data: [
          { id: "d1", samsara_driver_id: "op1" },
          { id: "d2", samsara_driver_id: "op2" },
        ],
      },
      driver_vehicle_assignments: {
        data: [
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

    const env = { WEATHER_BACKFILL_ENABLED: false } as unknown as Env;
    const res = await syncIdleEvents(admin, env, "org1", { idlingFetcher: async () => raw });

    expect(res.fetched).toBe(2);
    const rows = captured.idle_events ?? [];
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
  });
});
