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
    expect(r.skipped).toEqual([]);
    expect(rec.rpcs()).toEqual([
      { fn: "merge_driver", args: { p_org: ORG, p_source: "s1", p_canonical: "c1" } },
    ]);
    expectOrgScoped(rec, ORG);
  });

  /**
   * MD010 (migration 0234) — the source carries a certified application, an e-sign consent or an SMS
   * consent, none of which may be moved or deleted, so `merge_driver` refuses the pair.
   *
   * ── WHY THIS IS A SKIP AND NOT A THROW ────────────────────────────────────────────────────────
   * A refusal is a fact about ONE duplicate, and this is a fleet-wide sweep. Throwing on it would
   * abandon every remaining pair and discard the count of the ones that already succeeded, so an
   * operator deduping a 200-row roster would be told the sweep failed when most of it worked. The
   * refused pairs come back named, and the answer for them is to archive the duplicate.
   */
  it("apply: reports an MD010 refusal as a skip and keeps going", async () => {
    const rec = createSupabaseRecorder({
      tables: { drivers: [...drivers, { id: "s3", full_name: "MARIA LUZ", samsara_driver_id: null, efs_driver_id: null, phone: "555-0100" }, { id: "c2", full_name: "Maria Luz", samsara_driver_id: "S2", efs_driver_id: null, phone: "555-0100" }] },
      rpc: (_fn, args) =>
        (args as { p_source?: string }).p_source === "s1"
          ? { error: { code: "MD010", message: "merge_driver: driver s1 has signed evidence that cannot be moved" } }
          : null,
    });
    const r = await reconcileDrivers(rec.client, ORG, { apply: true });
    expect(r.planned).toBe(2);
    expect(r.merged).toBe(1); // s3 → c2 still went through
    expect(r.skipped).toEqual([
      { sourceId: "s1", canonicalId: "c1", reason: "merge_driver: driver s1 has signed evidence that cannot be moved" },
    ]);
    // Both pairs were attempted: the refusal did not short-circuit the sweep.
    expect(rec.rpcs()).toHaveLength(2);
  });

  /**
   * The other half of the same rule, and the one that makes the skip safe to have written: anything
   * that is NOT MD010 still throws. A recorder scripting a plain database error must not be quietly
   * collected as "skipped", or a broken merge looks like a policy decision.
   */
  it("apply: any error that is not MD010 still throws", async () => {
    const rec = createSupabaseRecorder({
      tables: { drivers },
      rpc: () => ({ error: { code: "42P01", message: "relation does not exist" } }),
    });
    await expect(reconcileDrivers(rec.client, ORG, { apply: true })).rejects.toThrow(/relation does not exist/);
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
