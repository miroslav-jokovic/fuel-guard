import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { startJob, runJob, reclaimInterruptedJobs, JobConflictError } from "./jobs.js";

/** Minimal fake covering exactly the call chains jobs.ts uses:
 *  from().insert().select().single()  and  from().update().eq().
 * `activeRow` (if set) is what the stale-reclaim lookup returns after a 23505. */
function makeFake(opts: { conflictOnInsert?: boolean; activeRow?: { id: string; started_at: string } } = {}) {
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  let idCounter = 0;
  let insertCalls = 0;
  const admin = {
    from() {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push(row);
          insertCalls++;
          return {
            select() {
              return {
                async single() {
                  // First insert can conflict; a retry after reclaim succeeds.
                  if (opts.conflictOnInsert && insertCalls === 1) {
                    return { data: null, error: { code: "23505", message: "duplicate" } };
                  }
                  return { data: { id: `job-${++idCounter}` }, error: null };
                },
              };
            },
          };
        },
        // The stale-reclaim lookup: select(...).eq().eq().in().order().limit().maybeSingle()
        select() {
          const chain = {
            eq: () => chain,
            in: () => chain,
            order: () => chain,
            limit: () => chain,
            async maybeSingle() {
              return { data: opts.activeRow ?? null, error: null };
            },
          };
          return chain;
        },
        update(patch: Record<string, unknown>) {
          const chain = {
            eq(_col: string, id: string) {
              updates.push({ id, patch });
              return chain;
            },
            in() {
              return { select: async () => ({ data: [{ id: "swept-1" }], error: null }) };
            },
          };
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, inserts, updates };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("startJob", () => {
  it("returns a new job id on success", async () => {
    const { admin, inserts } = makeFake();
    const id = await startJob(admin, "org1", "rebuild", { total: 100, requestedBy: "u1" });
    expect(id).toBe("job-1");
    expect(inserts[0]).toMatchObject({ org_id: "org1", kind: "rebuild", status: "running", total: 100, requested_by: "u1" });
  });

  it("throws JobConflictError when a FRESH run holds the slot (23505, active row recent)", async () => {
    const { admin } = makeFake({ conflictOnInsert: true, activeRow: { id: "cur", started_at: new Date().toISOString() } });
    await expect(startJob(admin, "org1", "rebuild")).rejects.toBeInstanceOf(JobConflictError);
  });

  it("throws JobConflictError when the slot is taken and no active row can be read", async () => {
    const { admin } = makeFake({ conflictOnInsert: true });
    await expect(startJob(admin, "org1", "rebuild")).rejects.toBeInstanceOf(JobConflictError);
  });

  it("reclaims a STALE slot (crashed/wedged run) and takes it over", async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const { admin, updates } = makeFake({ conflictOnInsert: true, activeRow: { id: "dead", started_at: threeHoursAgo } });
    const id = await startJob(admin, "org1", "rebuild");
    expect(id).toBe("job-1"); // the retried insert succeeded
    const failed = updates.find((u) => u.id === "dead");
    expect(failed?.patch).toMatchObject({ status: "failed" }); // the stale row was reclaimed
  });
});

describe("reclaimInterruptedJobs", () => {
  it("fails any still-running jobs (boot sweep) and reports the count", async () => {
    const { admin } = makeFake();
    expect(await reclaimInterruptedJobs(admin)).toBe(1);
  });
});

describe("runJob", () => {
  it("does not run the work and returns conflict when one is already active", async () => {
    const { admin } = makeFake({ conflictOnInsert: true });
    let ran = false;
    const res = await runJob(admin, "org1", "rebuild", async () => { ran = true; });
    expect(res).toEqual({ conflict: true });
    await flush();
    expect(ran).toBe(false);
  });

  it("finishes the job as done with the returned stats", async () => {
    const { admin, updates } = makeFake();
    const res = await runJob(admin, "org1", "backfill", async (report) => {
      await report(5, 10);
      return { count: 10 };
    });
    expect(res).toEqual({ jobId: "job-1" });
    await flush();
    const progress = updates.find((u) => u.patch.progress === 5);
    expect(progress).toBeTruthy();
    const done = updates.find((u) => u.patch.status === "done");
    expect(done?.patch).toMatchObject({ status: "done", stats: { count: 10 } });
    expect(done?.patch.finished_at).toBeTruthy();
  });

  it("finishes the job as failed (with the error) when the work throws", async () => {
    const { admin, updates } = makeFake();
    await runJob(admin, "org1", "rebuild", async () => {
      throw new Error("boom");
    });
    await flush();
    const failed = updates.find((u) => u.patch.status === "failed");
    expect(failed?.patch).toMatchObject({ status: "failed", error: "boom" });
  });
});
