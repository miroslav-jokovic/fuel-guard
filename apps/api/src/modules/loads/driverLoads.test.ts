import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { getDriverLoads } from "./driverLoads.js";

/**
 * The driver's load list reads with the service role, so it must restate every rule RLS would have
 * applied (0087, 0368). The database half — that an unsent McLeod load is invisible to its driver — is
 * proven in `loads-mirror-status-guard.test.mjs` as a real driver session. The recorder does not
 * evaluate PostgREST's `or` grammar, so this pins the exact predicate the query sends; the matrix
 * pins what the predicate means.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "11111111-2222-4333-8444-555555555555";

describe("getDriverLoads", () => {
  it("asks only for this driver's loads in this org, in a visible status, and — for a McLeod load — only once sent", async () => {
    const rec = createSupabaseRecorder({ tables: { loads: [] } });
    await getDriverLoads(rec.client, ORG, DRIVER);
    expectOrgScoped(rec, ORG);
    const q = rec.forTable("loads")[0]!;
    expect(q.filters()).toContainEqual({ col: "driver_id", val: DRIVER });
    expect(q.ops).toContainEqual({ method: "or", args: ["source.neq.tms,released_at.not.is.null"] });
  });
});
