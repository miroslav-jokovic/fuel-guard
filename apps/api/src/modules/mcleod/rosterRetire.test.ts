import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { reconcileAbsentFromTms, retireFromTms } from "./rosterRetire.js";

/**
 * Retirement is the one operation here that takes capability away from a person, so nearly every test
 * below is about what it REFUSES to do.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const d = (over: Record<string, unknown> = {}) => ({
  id: "d-1", org_id: ORG, mcleod_driver_id: "D0001", status: "active",
  identity_source: "mcleod", termination_date: null, ...over,
});
const seed = (rows: Record<string, unknown>[]) => createSupabaseRecorder({ tables: { drivers: rows } });

describe("retiring a driver McLeod says has left", () => {
  it("sets the status and stamps the termination date", async () => {
    const rec = seed([d()]);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expect(r.retired).toBe(1);
    const p = rec.writtenRows("drivers")[0]!;
    expect(p.status).toBe("terminated");
    expect(p.termination_date).toBe("2026-08-18");
  });

  it("NEVER clears a termination date — a re-hire is reported, not applied", async () => {
    // D-MR7: that date starts a §391.51 retention clock and the evidence tables are append-only.
    const rec = seed([d({ status: "terminated", termination_date: "2025-01-01" })]);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "inactive", termination_date: null },
    ]);
    expect(r.rehires).toEqual(["D0001"]);
    expect(rec.writes()).toEqual([]);
  });

  it("does not move a termination date that is already set", async () => {
    const rec = seed([d({ status: "active", termination_date: "2025-01-01" })]);
    await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expect(rec.writtenRows("drivers")[0]!).not.toHaveProperty("termination_date");
  });

  it("stands off a row the office owns", async () => {
    const rec = seed([d({ identity_source: "manual" })]);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expect(r.skippedOwned).toEqual(["D0001"]);
    expect(rec.writes()).toEqual([]);
  });

  it("stands off a row the recruiting pipeline owns", async () => {
    // 0213's lifecycle guard exempts the service role, so nothing below this would object.
    const rec = seed([d({ status: "applicant", identity_source: "manual" })]);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expect(r.skippedOwned).toEqual(["D0001"]);
    expect(rec.writes()).toEqual([]);
  });

  it("ignores a retirement for a record it never linked — there is nothing to retire", async () => {
    const rec = seed([]);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D9999", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expect(r.unknown).toEqual(["D9999"]);
    expect(rec.writes()).toEqual([]);
  });

  it("is a no-op when the row is already in that state", async () => {
    const rec = seed([d({ status: "terminated", termination_date: "2026-08-18" })]);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expect(r.unchanged).toBe(1);
    expect(rec.writes()).toEqual([]);
  });
});

describe("the bad-fetch guard", () => {
  it("refuses the WHOLE call when it would retire more rows than are active", async () => {
    // McLeod holds 1,299 non-active driver records against 164 active ones, so a mis-scoped sweep has
    // an eight-to-one lever on the roster. Refusing wholesale rather than trimming is the point: a
    // payload this size is a broken query, not a layoff, and applying the first N would be worse.
    const rows = [d({ id: "d-1", mcleod_driver_id: "D1" }), d({ id: "d-2", mcleod_driver_id: "D2" })];
    const rec = seed(rows);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D1", status: "terminated", termination_date: "2026-01-01" },
      { external_id: "D2", status: "terminated", termination_date: "2026-01-01" },
      { external_id: "D3", status: "terminated", termination_date: "2026-01-01" },
    ]);
    expect(r.refused).toMatch(/bad fetch/);
    expect(r.retired).toBe(0);
    expect(rec.writes()).toEqual([]);
  });

  it("allows a retirement that stays within the active count", async () => {
    const rows = [
      d({ id: "d-1", mcleod_driver_id: "D1" }),
      d({ id: "d-2", mcleod_driver_id: "D2" }),
      d({ id: "d-3", mcleod_driver_id: "D3" }),
    ];
    const rec = seed(rows);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D1", status: "terminated", termination_date: "2026-01-01" },
    ]);
    expect(r.refused).toBeUndefined();
    expect(r.retired).toBe(1);
  });

  it("org-scopes its read and its writes", async () => {
    const rec = seed([d()]);
    await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expectOrgScoped(rec, ORG);
  });
});

/**
 * `reconcileAbsentFromTms` had NO coverage, and the one-way trap it carried could only have been
 * found by reading it: the vehicle branch asked `row.status === "active"`, so the first row ever
 * written with `maintenance` — a value that has sat in the `vehicle_status` enum since migration
 * 0001 with nothing ever writing it — would have become permanently un-retirable. McLeod reports 12
 * trucks in a shop; the sweep would have declined to touch them, silently, every day, for as long
 * as McLeod kept reporting them gone (D-FC11, plan §4a G2).
 */
const ORG2 = ORG;
const v = (over: Record<string, unknown> = {}) => ({
  id: "v-1", org_id: ORG2, mcleod_tractor_id: "T900", status: "active", ...over,
});
/** The reconcile refuses a roster under 50 rows outright, so the payload has to clear that floor. */
const fiftyOthers = Array.from({ length: 50 }, (_, i) => `T${i + 1}`);

describe("reconciling vehicles McLeod no longer carries", () => {
  it("retires a truck that is in the SHOP, not only one that is on the road", async () => {
    const rec = createSupabaseRecorder({ tables: { vehicles: [v({ status: "maintenance" })] } });
    const r = await reconcileAbsentFromTms(rec.client, ORG2, "vehicles", fiftyOthers);
    expect(r.refused).toBeUndefined();
    expect(r.retired).toBe(1);
    expect(rec.writtenRows("vehicles")[0]!.status).toBe("retired");
  });

  it("still retires an ordinary active truck", async () => {
    const rec = createSupabaseRecorder({ tables: { vehicles: [v()] } });
    const r = await reconcileAbsentFromTms(rec.client, ORG2, "vehicles", fiftyOthers);
    expect(r.retired).toBe(1);
  });

  it("leaves a truck alone once it is already retired", async () => {
    const rec = createSupabaseRecorder({ tables: { vehicles: [v({ status: "retired" })] } });
    const r = await reconcileAbsentFromTms(rec.client, ORG2, "vehicles", fiftyOthers);
    expect(r.retired).toBe(0);
    expect(rec.writtenRows("vehicles")).toHaveLength(0);
  });

  it("org-scopes its read and its writes", async () => {
    const rec = createSupabaseRecorder({ tables: { vehicles: [v({ status: "maintenance" })] } });
    await reconcileAbsentFromTms(rec.client, ORG2, "vehicles", fiftyOthers);
    expectOrgScoped(rec, ORG2);
  });
});
