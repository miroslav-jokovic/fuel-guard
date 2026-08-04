/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runDataRetention,
  RETENTION_RULES,
  RETENTION_FORBIDDEN,
  type RetentionRule,
} from "./dataRetention.js";

/**
 * Chainable Supabase fake for retention: select resolves the table's fixture pages in order (then
 * empty), delete captures the filter chain and resolves { count } from the fixture.
 */
function makeAdmin(fixtures: Record<string, { pages?: unknown[][]; deleteCount?: number }>) {
  const deletes: Record<string, number> = {};
  const deletedIds: Record<string, string[]> = {};
  const pageCursor: Record<string, number> = {};
  function node(table: string): any {
    const fx = fixtures[table] ?? {};
    let mode: "select" | "delete" = "select";
    let capturedIds: string[] | null = null;
    const proxy: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then")
          return (resolve: (v: unknown) => unknown) => {
            if (mode === "delete") {
              deletes[table] = (deletes[table] ?? 0) + 1;
              if (capturedIds) (deletedIds[table] ||= []).push(...capturedIds);
              return resolve({ error: null, count: fx.deleteCount ?? capturedIds?.length ?? 0 });
            }
            const i = pageCursor[table] ?? 0;
            pageCursor[table] = i + 1;
            return resolve({ data: fx.pages?.[i] ?? [], error: null });
          };
        if (prop === "delete")
          return () => {
            mode = "delete";
            return proxy;
          };
        if (prop === "in")
          return (col: string, vals: string[]) => {
            if (mode === "delete" && col === "id") capturedIds = vals;
            return proxy;
          };
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  }
  return {
    admin: { from: (t: string) => node(t) } as unknown as SupabaseClient,
    deletes,
    deletedIds,
  };
}

const oldIso = new Date(Date.now() - 500 * 86_400_000).toISOString();

describe("retention policy (the config itself)", () => {
  it("never lists a forbidden table (audit ledger, business records, identity)", () => {
    const listed = new Set(RETENTION_RULES.map((r) => r.table));
    for (const t of RETENTION_FORBIDDEN) expect(listed.has(t)).toBe(false);
  });

  it("keeps raw telematics at least 13 months and only prunes finished jobs", () => {
    for (const r of RETENTION_RULES) {
      if (["idle_events", "hos_duty_segments", "idle_park_sessions", "vehicle_engine_days"].includes(r.table)) {
        expect(r.keepDays).toBeGreaterThanOrEqual(395);
      }
    }
    const jobs = RETENTION_RULES.find((r) => r.table === "jobs")!;
    expect(jobs.onlyWhenIn).toEqual({ column: "status", values: ["done", "failed"] });
  });
});

describe("runDataRetention", () => {
  const idRule: RetentionRule = {
    table: "idle_events", timeColumn: "started_at", keepDays: 400,
    strategy: "id", orgScoped: true, why: "test",
  };
  const sliceRule: RetentionRule = {
    table: "weather_cache", timeColumn: "hour_utc", keepDays: 400,
    strategy: "timeSlice", orgScoped: false, why: "test",
  };

  it("id strategy: deletes selected ids in batches until the select drains", async () => {
    const { admin, deletedIds } = makeAdmin({
      idle_events: { pages: [[{ id: "a" }, { id: "b" }], []] },
    });
    const res = await runDataRetention(admin, "org1", [idRule]);
    expect(res.totalDeleted).toBe(2);
    expect(deletedIds.idle_events).toEqual(["a", "b"]);
    expect(res.tables[0]).toMatchObject({ table: "idle_events", deleted: 2, capped: false });
  });

  it("id strategy: nothing past the cutoff → zero deletes issued", async () => {
    const { admin, deletes } = makeAdmin({ idle_events: { pages: [[]] } });
    const res = await runDataRetention(admin, "org1", [idRule]);
    expect(res.totalDeleted).toBe(0);
    expect(deletes.idle_events).toBeUndefined();
  });

  it("timeSlice strategy: deletes oldest-first slices and stops at the cutoff", async () => {
    const { admin, deletes } = makeAdmin({
      weather_cache: {
        // 1st oldest probe: ancient row → slice delete; 2nd probe: only a recent row → stop.
        pages: [[{ hour_utc: oldIso }], [{ hour_utc: new Date().toISOString() }]],
        deleteCount: 1234,
      },
    });
    const res = await runDataRetention(admin, "org1", [sliceRule]);
    expect(deletes.weather_cache).toBe(1);
    expect(res.totalDeleted).toBe(1234);
  });

  it("a failing table doesn't stop the others, and the error still fails the run", async () => {
    const failing: RetentionRule = { ...idRule, table: "boom" };
    const { admin, deletedIds } = makeAdmin({
      boom: { pages: undefined }, // select resolves {data:[]} — make it throw instead via a poisoned fixture
      idle_events: { pages: [[{ id: "x" }], []] },
    });
    // Poison: make the "boom" node reject by giving it a page that is not an array of ids —
    // simpler: use a table whose select errors. Rebuild a fake admin that errors for "boom".
    const erroringAdmin = {
      from: (t: string) =>
        t === "boom"
          ? new Proxy(function () {}, {
              get(_t, prop) {
                if (prop === "then")
                  return (resolve: (v: unknown) => unknown) =>
                    resolve({ data: null, error: { message: "nope" } });
                return () => erroringAdmin.from("boom");
              },
              apply: () => erroringAdmin.from("boom"),
            })
          : (admin as any).from(t),
    } as unknown as SupabaseClient;
    await expect(runDataRetention(erroringAdmin, "org1", [failing, idRule])).rejects.toThrow("nope");
    expect(deletedIds.idle_events).toEqual(["x"]); // the healthy table was still pruned
  });
});
