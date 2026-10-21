import { describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { RELINK_WINDOW_DAYS, runRelinkPass } from "./relinkScheduler.js";

/**
 * The relink pass on a clock (D-LA3 via PLATFORM-RELIABILITY-PLAN D-RLY12). What the clock adds to
 * `relinkDispatchMovements` (tested in `dispatchProjection.test.ts`): which orgs it visits, the window it
 * hands over, and that one org's failure is not every org's.
 */
const A = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const B = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const NOW = Date.parse("2026-10-21T15:00:00.000Z");
const org = (q: RecordedQuery) => q.filters().find((f) => f.col === "org_id")?.val;

describe("the scheduled relink pass", () => {
  it("visits only orgs whose agent can post — an enabled integration with an ingest token", async () => {
    const rec = createSupabaseRecorder({ tables: { org_integrations: [], mcleod_dispatch_movements: { pages: [[]] } } });
    await runRelinkPass(rec.client, NOW);
    const read = rec.forTable("org_integrations")[0]!;
    expect(read.filters()).toEqual(expect.arrayContaining([expect.objectContaining({ col: "enabled", val: true })]));
    expect(read.ops.find((o) => o.method === "not")?.args).toEqual(["ingest_token_hash", "is", null]);
  });

  it("asks each org for the last 60 days, and carries on past an org whose pass fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rec = createSupabaseRecorder({
      tables: {
        org_integrations: [{ org_id: A, provider: "mcleod" }, { org_id: B, provider: "mcleod" }],
        mcleod_dispatch_movements: (q) => (org(q) === A ? { error: { message: "statement timeout" } } : { pages: [[]] }),
      },
    });
    expect(await runRelinkPass(rec.client, NOW)).toEqual({ relinked: 0, failed: 1 });
    const reads = rec.forTable("mcleod_dispatch_movements");
    expect(reads.map(org)).toEqual([A, B]);
    const since = new Date(NOW - RELINK_WINDOW_DAYS * 86_400_000).toISOString();
    expect(reads[1]!.ops.find((o) => o.method === "or")?.args[0]).toBe(`closed_at.is.null,closed_at.gte.${since}`);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(`[mcleod-relink] org ${A}: pass failed`));
    error.mockRestore();
  });
});
