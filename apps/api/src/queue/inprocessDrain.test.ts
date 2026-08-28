import { afterEach, describe, expect, it } from "vitest";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { testEnv } from "../../src/testing/testEnv.js";
import { clearHandlers, registerHandler } from "./registry.js";
import { drainOnce } from "./inprocessDrain.js";

/**
 * The drain's contract, proven against the recorder: it claims a due queued row with a
 * compare-and-set (never a blind update), runs the registered handler, and settles the row —
 * done with stats on success, requeued-with-backoff or failed by the attempts budget on error.
 * The real defect this file exists for: a job row inserted as DATA in inprocess mode was
 * invisible to every executor (2026-08-28 — the owner's repair dispatch sat queued forever).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = testEnv({});

const queuedRow = (over: Record<string, unknown> = {}) => ({
  id: "11111111-2222-4333-8444-555555555555",
  org_id: ORG,
  kind: "efs_window_refetch",
  payload: { windows: [{ start: "2026-04-18", end: "2026-05-05" }] },
  attempts: 0,
  max_attempts: 5,
  status: "queued",
  run_after: new Date(Date.now() - 60_000).toISOString(),
  ...over,
});

afterEach(() => clearHandlers());

describe("drainOnce", () => {
  it("claims the row, runs the handler, and marks it done with the handler's stats", async () => {
    let ran = 0;
    registerHandler("efs_window_refetch", async (_ctx, job) => {
      ran++;
      expect(job.org_id).toBe(ORG);
      expect(job.attempts).toBe(1);
      return { windows: [{ status: "ingested" }] };
    });
    const rec = createSupabaseRecorder({ tables: { jobs: [queuedRow()] } });
    await drainOnce(env, rec.client);
    expect(ran).toBe(1);
    const writes = rec.writtenRows("jobs");
    expect(writes[0]).toMatchObject({ status: "running", locked_by: "inprocess-drain", attempts: 1 });
    expect(writes[1]).toMatchObject({ status: "done", stats: { windows: [{ status: "ingested" }] } });
    // The claim is guarded on status='queued' — the compare half of compare-and-set.
    const claim = rec.writes().find((q) => (q.write?.payload as Record<string, unknown> | undefined)?.status === "running");
    expect(claim?.filters()).toEqual(
      expect.arrayContaining([{ col: "status", val: "queued" }, { col: "id", val: queuedRow().id }]),
    );
  });

  it("requeues with backoff while attempts remain, then fails terminally", async () => {
    registerHandler("efs_window_refetch", async () => {
      throw new Error("EFS fault");
    });
    const rec = createSupabaseRecorder({ tables: { jobs: [queuedRow({ attempts: 0, max_attempts: 5 })] } });
    await drainOnce(env, rec.client);
    expect(rec.writtenRows("jobs")[1]).toMatchObject({ status: "queued", error: "EFS fault", locked_by: null });

    const rec2 = createSupabaseRecorder({ tables: { jobs: [queuedRow({ attempts: 4, max_attempts: 5 })] } });
    await drainOnce(env, rec2.client);
    expect(rec2.writtenRows("jobs")[1]).toMatchObject({ status: "failed", error: "EFS fault" });
  });

  it("does nothing when no due row exists", async () => {
    const rec = createSupabaseRecorder({ tables: { jobs: [] } });
    await drainOnce(env, rec.client);
    expect(rec.writes()).toEqual([]);
  });
});
