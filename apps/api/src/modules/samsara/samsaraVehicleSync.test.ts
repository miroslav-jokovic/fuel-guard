// The live-stats tier's own tests moved to `samsaraStatsFeed.test.ts` when SAM-S2 replaced the
// `/fleet/vehicles/stats` snapshot poll with the cursor delta feed. This file keeps the IDENTITY
// sync, which still reads the snapshot endpoint for its odometer/fuel decoration.

// ── Replacement lifecycle (identity check 2026-08-12) ───────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
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
