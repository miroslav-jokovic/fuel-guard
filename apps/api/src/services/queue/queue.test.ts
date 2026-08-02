import { afterEach, describe, expect, it } from "vitest";
import { JobConflictError } from "../jobs.js";
import { clearHandlers, getHandler, registerHandler, registeredKinds } from "./registry.js";
import { enqueueJob } from "./enqueue.js";
import { dispatchJob } from "./dispatch.js";
import { backoffSeconds, executeJob } from "./worker.js";
import type { JobContext, QueueDriver, QueueJob } from "./types.js";

/** In-memory QueueDriver recording every call — exercises the queue mechanics without a database. */
function fakeDriver(overrides: Partial<QueueDriver> = {}) {
  const calls = {
    completed: [] as { id: string; stats: Record<string, unknown> }[],
    failed: [] as { id: string; error: string; retry: boolean; backoff: number }[],
    progress: [] as { id: string; done: number }[],
  };
  const driver: QueueDriver = {
    enqueue: async () => ({ jobId: "job-1" }),
    claim: async () => null,
    renew: async () => true,
    complete: async (id, stats) => void calls.completed.push({ id, stats }),
    fail: async (id, error, retry, backoff) => void calls.failed.push({ id, error, retry, backoff }),
    progress: async (id, done) => void calls.progress.push({ id, done }),
    ...overrides,
  };
  return { driver, calls };
}

const ctx = { admin: {}, env: {} } as unknown as JobContext;
const job = (over: Partial<QueueJob> = {}): QueueJob => ({
  id: "job-1", org_id: "org-1", kind: "efs_ingest", payload: {}, attempts: 1, max_attempts: 5, ...over,
});
const execOpts = { workerId: "w-test", leaseSeconds: 300, renewEveryMs: 1_000_000 };

afterEach(() => clearHandlers());

describe("queue — registry", () => {
  it("registers, looks up, lists, and clears handlers", () => {
    expect(getHandler("efs_ingest")).toBeUndefined();
    const h = async () => ({});
    registerHandler("efs_ingest", h);
    expect(getHandler("efs_ingest")).toBe(h);
    expect(registeredKinds()).toEqual(["efs_ingest"]);
    clearHandlers();
    expect(registeredKinds()).toEqual([]);
  });
});

describe("queue — enqueueJob", () => {
  it("returns the job id on success", async () => {
    const { driver } = fakeDriver({ enqueue: async () => ({ jobId: "abc" }) });
    expect(await enqueueJob({} as never, "efs_ingest", { orgId: "org-1" }, driver)).toBe("abc");
  });
  it("throws JobConflictError on a dedup collision", async () => {
    const { driver } = fakeDriver({ enqueue: async () => ({ conflict: true }) });
    await expect(enqueueJob({} as never, "efs_ingest", { orgId: "org-1" }, driver)).rejects.toBeInstanceOf(
      JobConflictError,
    );
  });
});

describe("queue — executeJob", () => {
  it("runs the handler and completes with its stats", async () => {
    registerHandler("efs_ingest", async () => ({ found: 3 }));
    const { driver, calls } = fakeDriver();
    const outcome = await executeJob(driver, ctx, job(), execOpts);
    expect(outcome).toBe("done");
    expect(calls.completed).toEqual([{ id: "job-1", stats: { found: 3 } }]);
    expect(calls.failed).toHaveLength(0);
  });

  it("completes with {} when the handler returns void", async () => {
    registerHandler("efs_ingest", async () => undefined);
    const { driver, calls } = fakeDriver();
    await executeJob(driver, ctx, job(), execOpts);
    expect(calls.completed).toEqual([{ id: "job-1", stats: {} }]);
  });

  it("fails with retry + backoff when the handler throws", async () => {
    registerHandler("efs_ingest", async () => {
      throw new Error("boom");
    });
    const { driver, calls } = fakeDriver();
    const outcome = await executeJob(driver, ctx, job({ attempts: 2 }), execOpts);
    expect(outcome).toBe("failed");
    expect(calls.failed[0]).toMatchObject({ id: "job-1", error: "boom", retry: true });
    expect(calls.failed[0]!.backoff).toBe(backoffSeconds(2));
    expect(calls.completed).toHaveLength(0);
  });

  it("parks a job whose kind has no handler (no blind retry)", async () => {
    const { driver, calls } = fakeDriver();
    const outcome = await executeJob(driver, ctx, job(), execOpts);
    expect(outcome).toBe("no_handler");
    expect(calls.failed[0]).toMatchObject({ retry: false });
  });

  it("threads progress from the handler through to the driver", async () => {
    registerHandler("efs_ingest", async (_ctx, _job, report) => {
      await report(5, 10);
      return {};
    });
    const { driver, calls } = fakeDriver();
    await executeJob(driver, ctx, job(), execOpts);
    expect(calls.progress).toEqual([{ id: "job-1", done: 5 }]);
  });
});

describe("queue — dispatchJob (mode routing)", () => {
  it("queue mode enqueues via the RPC and returns the job id", async () => {
    const admin = { rpc: async () => ({ data: "job-q", error: null }) } as unknown as import("@supabase/supabase-js").SupabaseClient;
    const env = { JOB_EXECUTION_MODE: "queue" } as never;
    const res = await dispatchJob(admin, env, "rebuild", { orgId: "o1", payload: { actorId: "u1" } });
    expect(res).toEqual({ jobId: "job-q" });
  });
  it("queue mode maps a dedup 23505 to { conflict: true }", async () => {
    const admin = { rpc: async () => ({ data: null, error: { code: "23505", message: "dup" } }) } as unknown as import("@supabase/supabase-js").SupabaseClient;
    const env = { JOB_EXECUTION_MODE: "queue" } as never;
    const res = await dispatchJob(admin, env, "rebuild", { orgId: "o1" });
    expect(res).toEqual({ conflict: true });
  });
});

describe("queue — backoff", () => {
  it("grows exponentially and caps at 300s", () => {
    expect(backoffSeconds(1)).toBe(5);
    expect(backoffSeconds(2)).toBe(10);
    expect(backoffSeconds(3)).toBe(20);
    expect(backoffSeconds(20)).toBe(300);
  });
});
