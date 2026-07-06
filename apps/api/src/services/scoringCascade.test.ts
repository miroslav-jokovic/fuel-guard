import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { affectedVehicleIds } from "./scoring.js";

/** Fake admin for: from().select().eq().eq().not() → { data }. */
function makeAdmin(rows: { vehicle_id: string | null }[]) {
  const admin = {
    from() {
      return {
        select() {
          return { eq() { return { eq() { return { not: async () => ({ data: rows }) }; } }; } };
        },
      };
    },
  } as unknown as SupabaseClient;
  return admin;
}

describe("affectedVehicleIds (cascade scope)", () => {
  it("returns the distinct non-null vehicle ids from an import's rows", async () => {
    const admin = makeAdmin([
      { vehicle_id: "v1" },
      { vehicle_id: "v1" }, // dup
      { vehicle_id: "v2" },
      { vehicle_id: null }, // unattributed → excluded
    ]);
    const ids = await affectedVehicleIds(admin, "org1", "imp1");
    expect(ids.sort()).toEqual(["v1", "v2"]);
  });

  it("returns an empty list when the import attributed no vehicles", async () => {
    const admin = makeAdmin([{ vehicle_id: null }]);
    expect(await affectedVehicleIds(admin, "org1", "imp1")).toEqual([]);
  });
});
