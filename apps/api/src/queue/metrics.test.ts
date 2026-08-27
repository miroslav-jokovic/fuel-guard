import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { queueMetrics } from "./metrics.js";

/**
 * A fake supabase-js client for the two queries queueMetrics runs: the active-tail select (returns rows)
 * and the failed-count head select (returns a count). The select's `count` option disambiguates them; all
 * chain methods return the same thenable builder.
 */
function fakeAdmin(activeRows: Array<{ kind: string; status: string; created_at: string }>, failedCount: number): SupabaseClient {
  const makeChain = (result: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["in", "order", "limit", "eq", "gte"]) chain[m] = () => chain;
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result);
    return chain;
  };
  return {
    from: () => ({
      select: (_cols: string, opts?: { count?: string; head?: boolean }) =>
        opts?.count ? makeChain({ count: failedCount }) : makeChain({ data: activeRows }),
    }),
  } as unknown as SupabaseClient;
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe("queueMetrics", () => {
  it("reports zero backlog on an empty queue", async () => {
    const m = await queueMetrics(fakeAdmin([], 0));
    expect(m).toMatchObject({ queued: 0, running: 0, failedRecent: 0, oldestQueuedAgeSec: null, oldestQueuedKind: null, byKind: [], truncated: false });
  });

  it("aggregates depth, oldest-queued age, and per-kind counts", async () => {
    const rows = [
      { kind: "sync_vehicles", status: "queued", created_at: iso(120_000) }, // oldest queued
      { kind: "sync_vehicles", status: "queued", created_at: iso(30_000) },
      { kind: "sync_idle", status: "queued", created_at: iso(10_000) },
      { kind: "sync_idle", status: "running", created_at: iso(5_000) },
    ];
    const m = await queueMetrics(fakeAdmin(rows, 3), "org-1");

    expect(m.queued).toBe(3);
    expect(m.running).toBe(1);
    expect(m.failedRecent).toBe(3);
    expect(m.oldestQueuedKind).toBe("sync_vehicles");
    expect(m.oldestQueuedAgeSec).toBeGreaterThanOrEqual(118);
    expect(m.oldestQueuedAgeSec).toBeLessThanOrEqual(123);

    // byKind sorted by queued desc; sync_vehicles (2 queued) before sync_idle (1 queued + 1 running).
    expect(m.byKind[0]).toMatchObject({ kind: "sync_vehicles", queued: 2, running: 0 });
    expect(m.byKind[1]).toMatchObject({ kind: "sync_idle", queued: 1, running: 1 });
  });
});
