import { afterEach, describe, expect, it } from "vitest";
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
const env = testEnv({});

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
    expect((rpcs[0]!.args as Record<string, unknown>).p_kinds).toEqual(["efs_window_refetch", "financial_projection"]);
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

  it("does nothing when the claim returns no row", async () => {
    const rec = createSupabaseRecorder({ rpc: { claim_next_job: [] } });
    await drainOnce(env, rec.client);
    expect(rec.rpcs()).toHaveLength(1);
    expect(rec.writes()).toEqual([]);
  });
});
