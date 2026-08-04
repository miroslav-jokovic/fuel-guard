/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileAnomalyFlags } from "./anomalyFlagReconcile.js";

/** Chainable fake: select resolves the table fixture; update captures {patch, ids}. */
function makeAdmin(fixtures: Record<string, { data: unknown }>) {
  const updates: { table: string; patch: Record<string, unknown>; ids: string[] }[] = [];
  function node(table: string): any {
    const fx = fixtures[table] ?? { data: [] };
    let patch: Record<string, unknown> | null = null;
    const proxy: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then")
          return (resolve: (v: unknown) => unknown) => resolve({ ...fx, error: null });
        if (prop === "update")
          return (p: Record<string, unknown>) => {
            patch = p;
            return proxy;
          };
        if (prop === "in")
          return (col: string, vals: string[]) => {
            if (patch && col === "id") {
              updates.push({ table, patch, ids: vals });
              const done = Promise.resolve({ error: null });
              // subsequent chaining still works; awaiting resolves ok
              return Object.assign(done, { eq: () => done, in: () => done });
            }
            return proxy;
          };
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  }
  return { admin: { from: (t: string) => node(t) } as unknown as SupabaseClient, updates };
}

describe("reconcileAnomalyFlags", () => {
  it("clears flags whose anomalies are all superseded/absent, restores missing flags with max severity", async () => {
    const { admin, updates } = makeAdmin({
      anomalies: {
        data: [
          { transaction_id: "t2", severity: "medium" },
          { transaction_id: "t2", severity: "critical" },
          { transaction_id: "t3", severity: "low" },
        ],
      },
      // t1 is flagged but has NO live anomaly (dead link) → cleared.
      // t2 is flagged AND live → untouched. t3 has live anomalies but no flag → restored.
      fuel_transactions: { data: [{ id: "t1" }, { id: "t2" }] },
    });
    const res = await reconcileAnomalyFlags(admin, "org1");
    expect(res).toEqual({ cleared: 1, restored: 1 });

    const clear = updates.find((u) => u.patch.has_anomaly === false)!;
    expect(clear.ids).toEqual(["t1"]);
    expect(clear.patch.max_severity).toBeNull();

    const restore = updates.find((u) => u.patch.has_anomaly === true)!;
    expect(restore.ids).toEqual(["t3"]);
    expect(restore.patch.max_severity).toBe("low");
  });

  it("does nothing when flags already match the live anomalies", async () => {
    const { admin, updates } = makeAdmin({
      anomalies: { data: [{ transaction_id: "t1", severity: "high" }] },
      fuel_transactions: { data: [{ id: "t1" }] },
    });
    const res = await reconcileAnomalyFlags(admin, "org1");
    expect(res).toEqual({ cleared: 0, restored: 0 });
    expect(updates).toHaveLength(0);
  });
});
