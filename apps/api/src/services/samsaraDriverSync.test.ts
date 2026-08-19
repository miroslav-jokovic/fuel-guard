/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncDriversFromSamsara } from "./samsaraDriverSync.js";
import { testEnv } from "../testing/testEnv.js";

/** Fake admin: select → existing fixture; update/insert captured. Distinguishes the deactivation update
 *  (status:inactive + .in(ids)) from the per-driver identity updates. */
function makeAdmin(existing: unknown[]) {
  const captured = {
    deactivateIds: [] as string[],
    inserts: 0,
    identityUpdates: 0,
    /** Every per-driver update payload, in order — what "enrich, never clobber" is asserted against. */
    identityPatches: [] as Record<string, unknown>[],
    /** Every insert payload — what the D6 licence mapping is asserted against on the create path. */
    insertPayloads: [] as Record<string, unknown>[],
  };
  function builder(): any {
    let mode: string | null = null, payload: any = null, inIds: string[] | null = null;
    const b: any = {
      select() { mode = "select"; return b; },
      insert(p: any) { mode = "insert"; captured.inserts++; captured.insertPayloads.push(p); return b; },
      update(p: any) { mode = "update"; payload = p; return b; },
      eq() { return b; },
      not() { return b; },
      in(_c: string, ids: string[]) { inIds = ids; return b; },
      then(resolve: (v: unknown) => unknown) {
        if (mode === "select") return resolve({ data: existing, error: null });
        if (mode === "update") {
          if (payload?.status === "inactive" && inIds) captured.deactivateIds.push(...inIds);
          else { captured.identityUpdates++; captured.identityPatches.push(payload); }
          return resolve({ error: null });
        }
        return resolve({ error: null }); // insert
      },
    };
    return b;
  }
  return { admin: { from: () => builder() } as unknown as SupabaseClient, captured };
}

const env = testEnv();
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

/**
 * "Enrich, never clobber" (0098 §4) on the UPDATE-on-match path.
 *
 * The deactivation pass above always honoured `identity_source`; this path did not, and nothing
 * asserted it either way. The consequence was invisible and expensive: an admin corrects a misspelled
 * name through the roster PATCH, the next sync matches the row by its Samsara id, and the correction
 * is gone by morning with nothing logged. These two cases are the reason the roster edit surface can
 * be trusted at all.
 */
describe("syncDriversFromSamsara — manual rows are not overwritten by the sync", () => {
  const roster = async () => [
    { id: "S1", name: "Samsara Spelling", driverActivationStatus: "active" },
  ];

  it("writes only the provenance link to a MANUAL row, never its name or phone", async () => {
    const existing = [
      { id: "d1", samsara_driver_id: "S1", full_name: "Corrected By Office", phone: "555-0100", samsara_username: null, identity_source: "manual", status: "active" },
    ];
    const { admin, captured } = makeAdmin(existing);
    await syncDriversFromSamsara(admin, env, "org1", roster);
    expect(captured.identityPatches).toEqual([{ samsara_driver_id: "S1" }]);
  });

  it("still refreshes identity on a SAMSARA-owned row", async () => {
    const existing = [
      { id: "d1", samsara_driver_id: "S1", full_name: "Old Name", phone: null, samsara_username: null, identity_source: "samsara", status: "active" },
    ];
    const { admin, captured } = makeAdmin(existing);
    await syncDriversFromSamsara(admin, env, "org1", roster);
    expect(captured.identityPatches[0]).toMatchObject({
      full_name: "Samsara Spelling",
      samsara_driver_id: "S1",
    });
  });
});

/**
 * D6 — the licence field map (DQF-EXECUTION-PLAN A2b). Samsara sends licenseNumber/licenseState on
 * every driver; the sync used to discard them, which is why every qualification file started empty.
 * The licence is ENRICH-ONLY: editing cdl_number does not claim a row for the office (it is not in
 * DRIVER_IDENTITY_FIELDS), so the only thing protecting a hand-corrected licence on a telematics row
 * is that the sync writes the field when empty and never after.
 */
describe("syncDriversFromSamsara — D6 licence enrichment", () => {
  const roster = async () => [
    { id: "S1", name: "Licenced Driver", driverActivationStatus: "active", licenseNumber: "D123-4567-8901", licenseState: "IL" },
  ];

  it("fills an EMPTY cdl_number on a telematics row", async () => {
    const existing = [
      { id: "d1", samsara_driver_id: "S1", full_name: "Licenced Driver", phone: null, samsara_username: null, identity_source: "samsara", status: "active", cdl_number: null },
    ];
    const { admin, captured } = makeAdmin(existing);
    await syncDriversFromSamsara(admin, env, "org1", roster);
    expect(captured.identityPatches[0]).toMatchObject({ cdl_number: "D123-4567-8901", cdl_state: "IL" });
  });

  it("never overwrites a hand-entered cdl_number, even when Samsara carries a different one", async () => {
    const existing = [
      { id: "d1", samsara_driver_id: "S1", full_name: "Licenced Driver", phone: null, samsara_username: null, identity_source: "samsara", status: "active", cdl_number: "CORRECTED-BY-OFFICE" },
    ];
    const { admin, captured } = makeAdmin(existing);
    await syncDriversFromSamsara(admin, env, "org1", roster);
    expect(captured.identityPatches[0]).not.toHaveProperty("cdl_number");
    expect(captured.identityPatches[0]).not.toHaveProperty("cdl_state");
  });

  it("writes nothing but the provenance link to a MANUAL row, licence included", async () => {
    const existing = [
      { id: "d1", samsara_driver_id: "S1", full_name: "Manual Person", phone: null, samsara_username: null, identity_source: "manual", status: "active", cdl_number: null },
    ];
    const { admin, captured } = makeAdmin(existing);
    await syncDriversFromSamsara(admin, env, "org1", roster);
    expect(captured.identityPatches).toEqual([{ samsara_driver_id: "S1" }]);
  });

  it("carries the licence onto a NEWLY created driver row", async () => {
    const { admin, captured } = makeAdmin([]);
    await syncDriversFromSamsara(admin, env, "org1", roster);
    expect(captured.insertPayloads[0]).toMatchObject({
      cdl_number: "D123-4567-8901",
      cdl_state: "IL",
      status: "active",
    });
  });

  it("omits the licence keys entirely when Samsara sends none (never writes null over a value)", async () => {
    const bare = async () => [{ id: "S1", name: "No Licence", driverActivationStatus: "active" }];
    const existing = [
      { id: "d1", samsara_driver_id: "S1", full_name: "No Licence", phone: null, samsara_username: null, identity_source: "samsara", status: "active", cdl_number: null },
    ];
    const { admin, captured } = makeAdmin(existing);
    await syncDriversFromSamsara(admin, env, "org1", bare);
    expect(captured.identityPatches[0]).not.toHaveProperty("cdl_number");
  });
});
