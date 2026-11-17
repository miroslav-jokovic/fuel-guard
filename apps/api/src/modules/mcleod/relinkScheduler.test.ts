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

  it("links each McLeod login the data proves to its person, as the system's audited act (0626)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const STEVE = "90000000-0000-4000-8000-0000000000aa";
    const rec = createSupabaseRecorder({
      tables: {
        org_integrations: [{ org_id: A, provider: "mcleod" }],
        mcleod_dispatch_movements: { pages: [[]] },
        tms_dispatchers: (q) => (q.write ? [{ external_id: "steve" }] : [{ org_id: A, provider: "mcleod", external_id: "steve", display_name: "steve", is_system: false, is_active: true, user_id: null }]),
        tms_fleets: [],
        tms_dispatcher_link_holds: [],
        audit_logs: [],
      },
      rpc: (fn: string) => (fn === "org_member_directory" ? [{ user_id: STEVE, full_name: "Steve Dispatch", email: "steve@silvicominc.com", role: "dispatcher", suspended_at: null }] : null),
    });
    await runRelinkPass(rec.client, NOW);
    expect(rec.writtenRows("tms_dispatchers")).toEqual([expect.objectContaining({ user_id: STEVE })]);
    expect(rec.writtenRows("audit_logs")).toEqual([
      expect.objectContaining({ org_id: A, actor_id: null, action: "integration.mcleod.dispatcher_auto_linked", meta: expect.objectContaining({ dispatcherId: "steve", userId: STEVE }) }),
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("linked 1 McLeod login(s)"));
    log.mockRestore();
  });
});
