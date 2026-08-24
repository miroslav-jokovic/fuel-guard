import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { retireFromTms } from "./rosterRetire.js";

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
