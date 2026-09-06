import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { dueRunIds, STRANDED_AFTER_MS } from "./efsProcessingScheduler.js";

/**
 * A run stranded in `running` is invisible to every retry path (migration 0317). These tests pin the
 * SCHEDULER half of the repair: which rows it offers to `claim_efs_processing_run`.
 *
 * The fixture is a FUNCTION of the query, not a flat array. A flat array answers both of
 * `dueRunIds`'s queries with the same rows, which would let the stranded branch "pass" while doing
 * nothing at all — the fake, not the code, would be supplying the row.
 */

const DUE = { id: "run-due", org_id: "org-1" };
const STRANDED = { id: "run-stranded", org_id: "org-1" };

/** Which of the two queries is this? The retry query filters on status IN, the lease query on `lt`. */
function isLeaseQuery(q: RecordedQuery): boolean {
  return q.ops.some((op) => op.method === "lt" && op.args[0] === "updated_at");
}

function recorderWith(opts: { due: unknown[]; stranded: unknown[] }) {
  return createSupabaseRecorder({
    tables: {
      efs_processing_runs: (q) => (isLeaseQuery(q) ? opts.stranded : opts.due),
    },
  });
}

describe("dueRunIds — the stranded-run lease", () => {
  it("offers a run stranded mid-scoring alongside the ordinary due ones", async () => {
    const rec = recorderWith({ due: [DUE], stranded: [STRANDED] });
    const rows = await dueRunIds(rec.client);
    expect(rows.map((r) => r.id)).toEqual(["run-due", "run-stranded"]);
  });

  it("offers nothing extra when no run is stranded — the ordinary path is unchanged", async () => {
    const rec = recorderWith({ due: [DUE], stranded: [] });
    expect((await dueRunIds(rec.client)).map((r) => r.id)).toEqual(["run-due"]);
  });

  it("asks for stranded runs by a cutoff one lease in the past, on updated_at", async () => {
    const rec = recorderWith({ due: [], stranded: [STRANDED] });
    const before = Date.now();
    await dueRunIds(rec.client);
    const lease = rec.queries.find(isLeaseQuery);
    expect(lease).toBeDefined();
    // The status half matters as much as the cutoff: a lease query that forgot `.eq("status",
    // "running")` would sweep up every pending run and re-dispatch the whole ladder early.
    expect(lease!.filters()).toContainEqual({ col: "status", val: "running" });
    const cutoff = Date.parse(lease!.ops.find((o) => o.method === "lt")!.args[1] as string);
    expect(cutoff).toBeGreaterThanOrEqual(before - STRANDED_AFTER_MS - 5_000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - STRANDED_AFTER_MS + 5_000);
  });

  it("never offers the same run twice when both queries return it", async () => {
    const rec = recorderWith({ due: [DUE, STRANDED], stranded: [STRANDED] });
    expect((await dueRunIds(rec.client)).map((r) => r.id)).toEqual(["run-due", "run-stranded"]);
  });

  it("throws when the lease query errors, so a broken reaper is never silently a no-op", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_processing_runs: (q) =>
          isLeaseQuery(q) ? { data: null, error: { message: "boom" } } : { data: [DUE], error: null },
      },
    });
    await expect(dueRunIds(rec.client)).rejects.toThrow("boom");
  });
});
