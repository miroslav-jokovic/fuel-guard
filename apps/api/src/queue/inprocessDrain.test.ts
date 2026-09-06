import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { testEnv } from "../../src/testing/testEnv.js";
import { clearHandlers, registerHandler } from "./registry.js";
import { drainOnce } from "./inprocessDrain.js";

/**
 * The drain's contract, proven against the recorder: it claims through the SAME 0095 RPCs the
 * queue consumer uses (claim_next_job / complete_job / fail_job) — never a direct jobs write, the
 * table-modules gate enforces that — runs the registered handler, and settles the row. The defect
 * this file exists for: a job row inserted as DATA in inprocess mode had no executor at all
 * (2026-08-28 — the owner's repair dispatch sat queued forever).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = testEnv({ EFS_SOAP_ENABLED: true });

const claimedRow = {
  id: "11111111-2222-4333-8444-555555555555",
  org_id: ORG,
  kind: "efs_window_refetch",
  payload: { windows: [{ start: "2026-04-18", end: "2026-05-05" }] },
  attempts: 1,
  max_attempts: 5,
};

afterEach(() => clearHandlers());

describe("drainOnce", () => {
  it("claims via claim_next_job, runs the handler, completes with the handler's stats", async () => {
    let ran = 0;
    registerHandler("efs_window_refetch", async (_ctx, job) => {
      ran++;
      expect(job.org_id).toBe(ORG);
      return { windows: [{ status: "ingested" }] };
    });
    const rec = createSupabaseRecorder({
      rpc: { claim_next_job: [claimedRow], complete_job: null, fail_job: "requeued" },
    });
    await drainOnce(env, rec.client);
    expect(ran).toBe(1);
    const rpcs = rec.rpcs();
    expect(rpcs[0]!.fn).toBe("claim_next_job");
    expect((rpcs[0]!.args as Record<string, unknown>).p_kinds).toEqual(["financial_projection", "efs_window_refetch", "backfill"]);
    expect(rpcs[1]).toMatchObject({ fn: "complete_job", args: { p_id: claimedRow.id, p_stats: { windows: [{ status: "ingested" }] } } });
  });

  it("settles a thrown handler through fail_job (retry semantics live in the RPC)", async () => {
    registerHandler("efs_window_refetch", async () => {
      throw new Error("EFS fault");
    });
    const rec = createSupabaseRecorder({
      rpc: { claim_next_job: [claimedRow], complete_job: null, fail_job: "requeued" },
    });
    await drainOnce(env, rec.client);
    const fail = rec.rpcs().find((r) => r.fn === "fail_job");
    expect(fail?.args).toMatchObject({ p_id: claimedRow.id, p_error: "EFS fault", p_retry: true });
  });

  it("an instance without EFS access never CLAIMS the EFS kind — the first deploy's race", async () => {
    // Two scheduler processes exist in this topology; the one where EFS_SOAP_ENABLED is off
    // claimed the re-fetch first and failed it with "EFS_SOAP_ENABLED is off" while the capable
    // instance watched. The claim list, not the handler, is where capability must be enforced.
    const noEfs = testEnv({ EFS_SOAP_ENABLED: false });
    const rec = createSupabaseRecorder({ rpc: { claim_next_job: [] } });
    await drainOnce(noEfs, rec.client);
    expect((rec.rpcs()[0]!.args as Record<string, unknown>).p_kinds).toEqual(["financial_projection", "backfill"]);
  });

  /**
   * SAM-S6. The uncapped rebuild is reachable through no button and no schedule — the manual route
   * offers only `full` (a live re-fetch) and nightlyReconcile's rebuild is pinned to
   * RECENT_REBUILD_DAYS — so an operator queues it as a ROW, which is the exact shape that sat
   * stranded on 2026-08-28 and the reason this drain exists.
   */
  it("runs an operator-queued backfill row, which no button and no schedule can reach", async () => {
    let opts: unknown = null;
    registerHandler("backfill", async (_ctx, job) => {
      opts = job.payload;
      return { count: 15953, rebuild: true };
    });
    const rec = createSupabaseRecorder({
      rpc: {
        claim_next_job: [{ ...claimedRow, kind: "backfill", payload: { rebuild: true } }],
        complete_job: null,
        fail_job: "requeued",
      },
    });
    await drainOnce(env, rec.client);
    expect(opts).toEqual({ rebuild: true });
    expect(rec.rpcs()[1]).toMatchObject({ fn: "complete_job", args: { p_stats: { count: 15953, rebuild: true } } });
  });

  // The capability rule the EFS race taught: `backfill` needs no vendor egress of its own (a rebuild
  // re-scores stored rows), so unlike the EFS kind it is claimable on every instance.
  it("claims backfill even where EFS is off, because a rebuild fetches nothing", async () => {
    const noEfs = testEnv({ EFS_SOAP_ENABLED: false });
    const rec = createSupabaseRecorder({ rpc: { claim_next_job: [] } });
    await drainOnce(noEfs, rec.client);
    expect((rec.rpcs()[0]!.args as Record<string, unknown>).p_kinds).toContain("backfill");
  });

  /**
   * The two defects the hand-rolled executor had, and the reason drainOnce now calls executeJob.
   * Both only show on a LONG job: SAM-S6's rebuild needed ~3 hours against a 30-minute lease that was
   * never renewed, and `claim_next_job` reclaims any running row whose lease expired — so a second
   * copy would have started on top of the first, both writing the same 15,954 rows.
   */
  it("renews the lease while a long job runs, so a slow job is never re-claimed as a dead one", async () => {
    vi.useFakeTimers();
    try {
      let finish: (v: Record<string, unknown>) => void = () => {};
      registerHandler("efs_window_refetch", () => new Promise<Record<string, unknown>>((r) => { finish = r; }));
      const rec = createSupabaseRecorder({
        rpc: { claim_next_job: [claimedRow], renew_lease: true, complete_job: null, fail_job: "requeued" },
      });
      const inFlight = drainOnce(env, rec.client);
      await vi.advanceTimersByTimeAsync(21 * 60_000); // past two 10-minute renewals
      const renews = rec.rpcs().filter((r) => r.fn === "renew_lease");
      expect(renews.length).toBeGreaterThanOrEqual(2);
      expect(renews[0]!.args).toMatchObject({ p_id: claimedRow.id, p_worker: "inprocess-drain" });
      finish({ ok: true });
      await inFlight;
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports progress, so a multi-hour drained job is not invisible", async () => {
    registerHandler("efs_window_refetch", async (_ctx, _job, report) => {
      await report(120, 15954);
      return { ok: true };
    });
    const rec = createSupabaseRecorder({
      rpc: { claim_next_job: [claimedRow], complete_job: null, fail_job: "requeued" },
    });
    await drainOnce(env, rec.client);
    // The old drain passed `async () => undefined` here, so this write never happened at all.
    expect(rec.writtenRows("jobs")[0]).toMatchObject({ progress: 120, total: 15954 });
  });

  it("does nothing when the claim returns no row", async () => {
    const rec = createSupabaseRecorder({ rpc: { claim_next_job: [] } });
    await drainOnce(env, rec.client);
    expect(rec.rpcs()).toHaveLength(1);
    expect(rec.writes()).toEqual([]);
  });
});
