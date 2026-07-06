import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncVehicleStatsFromSamsara } from "./samsaraVehicleSync.js";
import type { Env } from "../env.js";

const env = {} as Env; // override fetcher is supplied, so no token/HTTP needed

/** Fake admin covering: from().select().eq().not() (read) and from().update().eq().eq() (write). */
function makeAdmin(rows: { id: string; samsara_vehicle_id: string }[]) {
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  let lastId = "";
  const admin = {
    from() {
      return {
        select() {
          return { eq() { return { not: async () => ({ data: rows }) }; } };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_col: string, val: string) {
              lastId = val; // first .eq is ("id", id)
              return { eq: async () => { updates.push({ id: lastId, patch }); return { error: null }; } };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, updates };
}

describe("syncVehicleStatsFromSamsara (live-stats tier)", () => {
  const stats = {
    data: [
      { id: "v1", obdOdometerMeters: { value: 1609344 }, fuelPercents: { value: 62.5, time: "2026-07-06T10:00:00Z" } }, // 1000 mi
      { id: "v2", gpsOdometerMeters: { value: 3218688 } }, // 2000 mi, no fuel
    ],
  };

  it("updates only mapped vehicles Samsara reported, with odometer + fuel where present", async () => {
    const { admin, updates } = makeAdmin([
      { id: "row1", samsara_vehicle_id: "v1" },
      { id: "row2", samsara_vehicle_id: "v2" },
      { id: "row3", samsara_vehicle_id: "v3" }, // no stats → skipped
    ]);
    const res = await syncVehicleStatsFromSamsara(admin, env, "org1", async () => stats);
    expect(res.updated).toBe(2);
    const byId = new Map(updates.map((u) => [u.id, u.patch]));
    expect(byId.get("row1")).toEqual({ current_odometer: 1000, samsara_fuel_percent: 62.5, samsara_fuel_at: "2026-07-06T10:00:00Z" });
    expect(byId.get("row2")).toEqual({ current_odometer: 2000 }); // no fuel reported → fuel fields untouched
    expect(byId.has("row3")).toBe(false);
  });

  it("no-ops cleanly when Samsara returns no stats", async () => {
    const { admin, updates } = makeAdmin([{ id: "row1", samsara_vehicle_id: "v1" }]);
    const res = await syncVehicleStatsFromSamsara(admin, env, "org1", async () => ({ data: [] }));
    expect(res.updated).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
