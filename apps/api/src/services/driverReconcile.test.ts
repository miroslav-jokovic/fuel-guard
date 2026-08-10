import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { reconcileDrivers, mergeDriverPair } from "./driverReconcile.js";

/**
 * Migrated off the local `makeAdmin` Proxy (audit 2026-08-09, Stage 2.5). Merging folds ALL of a
 * driver's history into another row, so the roster read that decides WHICH drivers are merge
 * candidates has to be tenant-filtered; the old fake swallowed `.eq("org_id", …)` whole, and merge_driver
 * would happily have been called with a pair from another fleet. The recorder asserts both halves.
 */
const ORG = "org1";
const withDrivers = (rows: unknown[]) => createSupabaseRecorder({ tables: { drivers: rows } });

const drivers = [
  { id: "c1", full_name: "Angel Cora", samsara_driver_id: "S1", efs_driver_id: null, phone: null },
  { id: "s1", full_name: "ANGEL CORA COMP", samsara_driver_id: null, efs_driver_id: "0511", phone: null },
  { id: "s2", full_name: "ESTEBAN OW", samsara_driver_id: null, efs_driver_id: null, phone: null }, // single-token: not merged
];

describe("reconcileDrivers", () => {
  it("dry run: reports pairs and unmatched count, calls NO rpc", async () => {
    const rec = withDrivers(drivers);
    const r = await reconcileDrivers(rec.client, ORG, { apply: false });
    expect(r.dryRun).toBe(true);
    expect(r.unmatched).toBe(2); // s1 + s2
    expect(r.planned).toBe(1); // only s1 → c1
    expect(r.pairs).toEqual([
      { sourceId: "s1", sourceName: "ANGEL CORA COMP", canonicalId: "c1", canonicalName: "Angel Cora", matchedBy: "name", key: "angel cora" },
    ]);
    expect(rec.rpcs()).toHaveLength(0);
    expect(r.merged).toBe(0);
    expectOrgScoped(rec, ORG);
  });

  it("apply: calls merge_driver once per pair with the right args", async () => {
    const rec = withDrivers(drivers);
    const r = await reconcileDrivers(rec.client, ORG, { apply: true });
    expect(r.merged).toBe(1);
    expect(rec.rpcs()).toEqual([
      { fn: "merge_driver", args: { p_org: ORG, p_source: "s1", p_canonical: "c1" } },
    ]);
    expectOrgScoped(rec, ORG);
  });
});

describe("mergeDriverPair", () => {
  it("rejects merging a driver into itself", async () => {
    const rec = withDrivers([{ id: "a" }, { id: "a" }]);
    await expect(mergeDriverPair(rec.client, ORG, "a", "a")).rejects.toThrow(/same driver/);
  });

  it("rejects when the two ids aren't both in the org", async () => {
    const rec = withDrivers([{ id: "a" }]); // only one found
    await expect(mergeDriverPair(rec.client, ORG, "a", "b")).rejects.toThrow(/not found/);
    // The "in this org" in that error is only true if the lookup was actually org-filtered.
    expectOrgScoped(rec, ORG);
  });

  it("calls merge_driver when both drivers resolve", async () => {
    const rec = withDrivers([{ id: "a" }, { id: "b" }]);
    await mergeDriverPair(rec.client, ORG, "a", "b");
    expect(rec.rpcs()).toEqual([
      { fn: "merge_driver", args: { p_org: ORG, p_source: "a", p_canonical: "b" } },
    ]);
    expectOrgScoped(rec, ORG);
  });
});
