/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileDrivers, mergeDriverPair } from "./driverReconcile.js";

/** Fake admin: `from("drivers").select().eq()` resolves to the fixture; `.rpc()` captures merge calls. */
function makeAdmin(driverRows: unknown[]) {
  const rpcCalls: Record<string, unknown>[] = [];
  const selectResult = { data: driverRows, error: null };
  const admin = {
    from: () => {
      const node: any = new Proxy(function () {}, {
        get(_t, prop) {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(selectResult);
          return () => node;
        },
        apply: () => node,
      });
      return node;
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, ...args });
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { admin, rpcCalls };
}

const drivers = [
  { id: "c1", full_name: "Angel Cora", samsara_driver_id: "S1", efs_driver_id: null, phone: null },
  { id: "s1", full_name: "ANGEL CORA COMP", samsara_driver_id: null, efs_driver_id: "0511", phone: null },
  { id: "s2", full_name: "ESTEBAN OW", samsara_driver_id: null, efs_driver_id: null, phone: null }, // single-token: not merged
];

describe("reconcileDrivers", () => {
  it("dry run: reports pairs and unmatched count, calls NO rpc", async () => {
    const { admin, rpcCalls } = makeAdmin(drivers);
    const r = await reconcileDrivers(admin, "org1", { apply: false });
    expect(r.dryRun).toBe(true);
    expect(r.unmatched).toBe(2); // s1 + s2
    expect(r.planned).toBe(1); // only s1 → c1
    expect(r.pairs).toEqual([
      { sourceId: "s1", sourceName: "ANGEL CORA COMP", canonicalId: "c1", canonicalName: "Angel Cora", matchedBy: "name", key: "angel cora" },
    ]);
    expect(rpcCalls).toHaveLength(0);
    expect(r.merged).toBe(0);
  });

  it("apply: calls merge_driver once per pair with the right args", async () => {
    const { admin, rpcCalls } = makeAdmin(drivers);
    const r = await reconcileDrivers(admin, "org1", { apply: true });
    expect(r.merged).toBe(1);
    expect(rpcCalls).toEqual([{ fn: "merge_driver", p_org: "org1", p_source: "s1", p_canonical: "c1" }]);
  });
});

describe("mergeDriverPair", () => {
  it("rejects merging a driver into itself", async () => {
    const { admin } = makeAdmin([{ id: "a" }, { id: "a" }]);
    await expect(mergeDriverPair(admin, "org1", "a", "a")).rejects.toThrow(/same driver/);
  });

  it("rejects when the two ids aren't both in the org", async () => {
    const { admin } = makeAdmin([{ id: "a" }]); // only one found
    await expect(mergeDriverPair(admin, "org1", "a", "b")).rejects.toThrow(/not found/);
  });

  it("calls merge_driver when both drivers resolve", async () => {
    const { admin, rpcCalls } = makeAdmin([{ id: "a" }, { id: "b" }]);
    await mergeDriverPair(admin, "org1", "a", "b");
    expect(rpcCalls).toEqual([{ fn: "merge_driver", p_org: "org1", p_source: "a", p_canonical: "b" }]);
  });
});
