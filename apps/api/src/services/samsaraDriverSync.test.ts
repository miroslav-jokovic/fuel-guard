/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncDriversFromSamsara } from "./samsaraDriverSync.js";
import type { Env } from "../env.js";

/** Fake admin: select → existing fixture; update/insert captured. Distinguishes the deactivation update
 *  (status:inactive + .in(ids)) from the per-driver identity updates. */
function makeAdmin(existing: unknown[]) {
  const captured = { deactivateIds: [] as string[], inserts: 0, identityUpdates: 0 };
  function builder(): any {
    let mode: string | null = null, payload: any = null, inIds: string[] | null = null;
    const b: any = {
      select() { mode = "select"; return b; },
      insert() { mode = "insert"; captured.inserts++; return b; },
      update(p: any) { mode = "update"; payload = p; return b; },
      eq() { return b; },
      not() { return b; },
      in(_c: string, ids: string[]) { inIds = ids; return b; },
      then(resolve: (v: unknown) => unknown) {
        if (mode === "select") return resolve({ data: existing, error: null });
        if (mode === "update") {
          if (payload?.status === "inactive" && inIds) captured.deactivateIds.push(...inIds);
          else captured.identityUpdates++;
          return resolve({ error: null });
        }
        return resolve({ error: null }); // insert
      },
    };
    return b;
  }
  return { admin: { from: () => builder() } as unknown as SupabaseClient, captured };
}

const env = {} as Env;
// Samsara active roster returned by the "fetch": only S2 is active.
const lister = async () => [{ id: "S2", name: "Active Two", driverActivationStatus: "active" }];

describe("syncDriversFromSamsara — deactivation reconcile", () => {
  it("marks a Samsara-sourced active driver INACTIVE when it left the active roster; spares S2 and manual rows", async () => {
    const existing = [
      { id: "d1", samsara_driver_id: "S1", full_name: "Gone Driver", phone: null, samsara_username: null, identity_source: "samsara", status: "active" }, // stale → deactivate
      { id: "d2", samsara_driver_id: "S2", full_name: "Active Two", phone: null, samsara_username: null, identity_source: "samsara", status: "active" }, // still active
      { id: "d3", samsara_driver_id: "S9", full_name: "Manual Person", phone: null, samsara_username: null, identity_source: "manual", status: "active" }, // manual → never touched
      { id: "d4", samsara_driver_id: "S8", full_name: "Already Off", phone: null, samsara_username: null, identity_source: "samsara", status: "inactive" }, // already inactive → skip
    ];
    const { admin, captured } = makeAdmin(existing);
    const r = await syncDriversFromSamsara(admin, env, "org1", lister);
    expect(r.deactivated).toBe(1);
    expect(captured.deactivateIds).toEqual(["d1"]);
  });

  it("does NOT deactivate anything when the fetch returns an empty roster (guard)", async () => {
    const existing = [
      { id: "d1", samsara_driver_id: "S1", full_name: "X", phone: null, samsara_username: null, identity_source: "samsara", status: "active" },
    ];
    const { admin, captured } = makeAdmin(existing);
    const r = await syncDriversFromSamsara(admin, env, "org1", async () => []);
    expect(r.deactivated).toBe(0);
    expect(captured.deactivateIds).toEqual([]);
  });

  it("skips deactivation when it would remove MORE than the active roster size (bad-fetch guard)", async () => {
    // Roster returns 1 active (S2), but 3 existing active Samsara drivers are absent → 3 > 1 → treat as bad fetch.
    const existing = [
      { id: "d1", samsara_driver_id: "A", full_name: "A", phone: null, samsara_username: null, identity_source: "samsara", status: "active" },
      { id: "d2", samsara_driver_id: "B", full_name: "B", phone: null, samsara_username: null, identity_source: "samsara", status: "active" },
      { id: "d3", samsara_driver_id: "C", full_name: "C", phone: null, samsara_username: null, identity_source: "samsara", status: "active" },
    ];
    const { admin, captured } = makeAdmin(existing);
    const r = await syncDriversFromSamsara(admin, env, "org1", lister); // roster = [S2] (size 1)
    expect(r.deactivated).toBe(0);
    expect(captured.deactivateIds).toEqual([]);
  });
});
