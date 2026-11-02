import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { searchLoads } from "./search.js";

/**
 * The palette's load lookup (D-SB8). It reads with the service role, so what it must hold on its
 * own: the org filter, a term that cannot carry PostgREST syntax into the pattern, a capped answer,
 * and no query at all for a term too short to mean one load.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const L1 = "11111111-2222-4333-8444-000000000001";

const recorder = () =>
  createSupabaseRecorder({
    tables: {
      loads: [{ id: L1, ref: "L104233", status: "in_transit", customer_name: "ACME FOODS", drivers: [{ full_name: "Ana Petrovic" }] }],
    },
  });

const op = (rec: ReturnType<typeof recorder>, method: string) => rec.queries[0]!.ops.find((o) => o.method === method)?.args;

describe("searchLoads", () => {
  it("finds loads by number inside the caller's org, newest first, five at most", async () => {
    const rec = recorder();
    const hits = await searchLoads(rec.client, ORG, " 1042 ");
    expect(hits).toEqual([{ id: L1, ref: "L104233", customer_name: "ACME FOODS", driver_name: "Ana Petrovic" }]);
    expectOrgScoped(rec, ORG);
    expect(op(rec, "ilike")).toEqual(["ref", "%1042%"]);
    expect(op(rec, "order")).toEqual(["created_at", { ascending: false }]);
    expect(op(rec, "limit")).toEqual([5]);
  });

  it("keeps PostgREST and LIKE syntax out of the pattern", async () => {
    const rec = recorder();
    await searchLoads(rec.client, ORG, "10%_4,2)");
    expect(op(rec, "ilike")).toEqual(["ref", "%10 4 2%"]);
  });

  it("asks nothing for a term too short to name one load", async () => {
    const rec = recorder();
    expect(await searchLoads(rec.client, ORG, " 7 ")).toEqual([]);
    expect(await searchLoads(rec.client, ORG, "%%")).toEqual([]);
    expect(rec.queries).toHaveLength(0);
  });
});
