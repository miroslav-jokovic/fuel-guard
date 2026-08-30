import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { listLoads } from "./hazmatLoads.js";

/**
 * `listLoads` — the read behind the hazmat review queue.
 *
 * Two things are worth a test here and neither is the SQL. The API reads with the SERVICE ROLE, which
 * bypasses RLS, so every query has to carry its own org filter; H-U3 added a SECOND table to this
 * read (`loads`, for the dispatch reference), which is exactly the kind of addition that quietly
 * ships a cross-tenant read. And the reference has to survive onto the row, because a review queue
 * whose rows say "2 products" and nothing else cannot tell a reviewer which truckload they are being
 * asked to clear.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const HZ = "11111111-2222-4333-8444-555555555555";
const LOAD = "22222222-3333-4444-8555-666666666666";

const seed = (over: Record<string, unknown> = {}) =>
  createSupabaseRecorder({
    tables: {
      hazmat_loads: [{ id: HZ, load_id: LOAD, status: "needs_review", created_at: "2026-08-30T00:00:00Z", ...over }],
      loads: [{ id: LOAD, ref: "41182" }],
    },
  });

describe("listLoads", () => {
  it("attaches the dispatch load's reference, so a queue row names the freight", async () => {
    const rec = seed();
    const { rows } = await listLoads(rec.client, ORG, { limit: 25 } as never);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { load_ref: string | null }).load_ref).toBe("41182");
  });

  it("leaves load_ref null for a record never linked to a dispatch load", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        hazmat_loads: [{ id: HZ, load_id: null, status: "needs_review", created_at: "2026-08-30T00:00:00Z" }],
        loads: [],
      },
    });
    const { rows } = await listLoads(rec.client, ORG, { limit: 25 } as never);
    expect((rows[0] as { load_ref: string | null }).load_ref).toBeNull();
  });

  it("scopes every read to one organization, including the reference lookup", async () => {
    const rec = seed();
    await listLoads(rec.client, ORG, { limit: 25 } as never);
    expectOrgScoped(rec, ORG);
  });
});
