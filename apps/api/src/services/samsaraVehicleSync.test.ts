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
          return {
            eq() {
              return { not: async () => ({ data: rows }) };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_col: string, val: string) {
              lastId = val; // first .eq is ("id", id)
              return {
                eq: async () => {
                  updates.push({ id: lastId, patch });
                  return { error: null };
                },
              };
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
      {
        id: "v1",
        obdOdometerMeters: { value: 1609344 },
        fuelPercents: { value: 62.5, time: "2026-07-06T10:00:00Z" },
      }, // 1000 mi
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
    expect(byId.get("row1")).toEqual({
      current_odometer: 1000,
      samsara_fuel_percent: 62.5,
      samsara_fuel_at: "2026-07-06T10:00:00Z",
    });
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

// ── Replacement lifecycle (identity check 2026-08-12) ───────────────────────────────────────────
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { syncVehiclesFromSamsara } from "./samsaraVehicleSync.js";

describe("syncVehiclesFromSamsara — samsara_missing_since lifecycle", () => {
  const ORG = "org-1";
  const lister = async () => [{ id: "SV-LIVE", name: "701" }]; // only SV-LIVE still exists at Samsara
  const noStats = async () => ({ data: [] });

  it("stamps active trucks whose Samsara vehicle vanished, clears reappeared ones, never touches retired", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: {
          data: [
            // Mapped to a live id, previously stamped → must be CLEARED (gateway came back).
            {
              id: "r1",
              samsara_vehicle_id: "SV-LIVE",
              vin: null,
              unit_number: "701",
              status: "active",
              samsara_missing_since: "2026-08-01T00:00:00Z",
            },
            // Mapped to a gone id, not yet stamped → must be STAMPED and reported.
            {
              id: "r2",
              samsara_vehicle_id: "SV-GONE",
              vin: null,
              unit_number: "676 - OLD",
              status: "active",
              samsara_missing_since: null,
            },
            // Gone id, ALREADY stamped → reported but not re-stamped (first observation wins).
            {
              id: "r3",
              samsara_vehicle_id: "SV-GONE-2",
              vin: null,
              unit_number: "733 - OLD",
              status: "active",
              samsara_missing_since: "2026-08-05T00:00:00Z",
            },
            // Retired truck with a gone id → ignored entirely.
            {
              id: "r4",
              samsara_vehicle_id: "SV-GONE-3",
              vin: null,
              unit_number: "600",
              status: "retired",
              samsara_missing_since: null,
            },
          ],
        },
      },
    });

    const result = await syncVehiclesFromSamsara(
      rec.client,
      {} as never,
      ORG,
      lister as never,
      noStats as never,
      noStats as never,
    );

    // Active gone trucks are reported for the sync stats / UI, sorted.
    expect(result.samsaraMissing).toEqual(["676 - OLD", "733 - OLD"]);

    const vehicleWrites = rec
      .forTable("vehicles")
      .filter((q) => q.write?.method === "update")
      .map((q) => ({ patch: q.write!.payload as Record<string, unknown>, filters: q.filters() }));
    const stamp = vehicleWrites.find((w) => typeof w.patch.samsara_missing_since === "string");
    const clear = vehicleWrites.find((w) => w.patch.samsara_missing_since === null);
    // Exactly one stamp write covering ONLY the un-stamped gone truck (r2) — r3 keeps its first
    // observation, r4 is retired.
    expect(stamp).toBeDefined();
    expect(
      stamp!.filters.some(
        (f) => f.col === "id" && JSON.stringify(f.val) === JSON.stringify(["r2"]),
      ),
    ).toBe(true);
    // Exactly one clear write for the reappeared truck (r1).
    expect(clear).toBeDefined();
    expect(
      clear!.filters.some(
        (f) => f.col === "id" && JSON.stringify(f.val) === JSON.stringify(["r1"]),
      ),
    ).toBe(true);
    expectOrgScoped(rec, ORG);
  });
});
