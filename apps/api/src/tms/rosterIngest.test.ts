import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { ingestDrivers, ingestVehicles, ingestTrailers } from "./rosterIngest.js";
import { makeDriverMatcher, makeAssetMatcher, vehicleUnitKey, trailerUnitMatchKey } from "./rosterMatch.js";

/**
 * Roster ingest, link-only (M3).
 *
 * The assertions that matter here are mostly NEGATIVE ones. A sync that writes too much is not caught
 * by a test that checks it wrote the right link — it is caught by a test that checks it wrote nothing
 * else. Twelve services write to these tables and several own columns that are learned rather than
 * recorded (tank capacity from fill history, trailer pairing from telemetry, the idle envelope), so
 * `CODEBASE-IMPACT-ANALYSIS.md §5` states the rule as "a fixed allowlist of columns, never a row" and
 * the first test below is that rule.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const driver = (over: Record<string, unknown> = {}) => ({
  id: "d-1", org_id: ORG, status: "active", identity_source: "samsara",
  cdl_number: "S123456789", full_name: "Angel Cora", mcleod_driver_id: null,
  archived_at: null, ...over,
});
const vehicle = (over: Record<string, unknown> = {}) => ({
  id: "v-1", org_id: ORG, status: "active", identity_source: "samsara",
  vin: "3AKJHHDR4LSLL4083", unit_number: "789", mcleod_tractor_id: null, ...over,
});
const trailer = (over: Record<string, unknown> = {}) => ({
  id: "t-1", org_id: ORG, status: "active", identity_source: "samsara",
  vin: null, unit_number: "R532159", mcleod_trailer_id: null, ...over,
});

const seed = (tables: Record<string, unknown[]>): SupabaseRecorder => createSupabaseRecorder({ tables });

describe("the write surface", () => {
  it("writes the link and the company it came from — and NOTHING else", async () => {
    const rec = seed({ drivers: [driver()] });
    await ingestDrivers(rec.client, ORG, [
      { external_id: "D0001", company_id: "TMS", cdl_number: "S123456789", first_name: "Angel", last_name: "Cora" },
    ]);
    const rows = rec.writtenRows("drivers");
    expect(rows).toHaveLength(1);
    // The allowlist, asserted exactly. A column added to `drivers` later cannot leak into this set
    // without failing here first.
    expect(Object.keys(rows[0]!).sort()).toEqual(["mcleod_company_id", "mcleod_driver_id"]);
  });

  it("does not write identity even when the payload carries it — that is M4, not M3", async () => {
    const rec = seed({ drivers: [driver()] });
    await ingestDrivers(rec.client, ORG, [
      {
        external_id: "D0001", company_id: "TMS", cdl_number: "S123456789",
        first_name: "Angela", last_name: "Corazon",           // a NAME CHANGE McLeod is asserting
        status: "terminated", termination_date: "2026-08-01", // and a TERMINATION
        cdl_expires_at: "2030-01-01", date_of_birth: "1980-05-05",
      },
    ]);
    const payload = rec.writtenRows("drivers")[0]!;
    expect(Object.keys(payload).sort()).toEqual(["mcleod_company_id", "mcleod_driver_id"]);
    for (const forbidden of ["full_name", "first_name", "status", "termination_date", "cdl_expires_at", "date_of_birth"]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it("org-scopes every read and every write — the service role bypasses RLS", async () => {
    const rec = seed({ drivers: [driver()] });
    await ingestDrivers(rec.client, ORG, [
      { external_id: "D0001", cdl_number: "S123456789", first_name: "Angel", last_name: "Cora" },
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("writes nothing at all when nothing matches", async () => {
    const rec = seed({ drivers: [driver({ cdl_number: "OTHER99", full_name: "Someone Else" })] });
    const r = await ingestDrivers(rec.client, ORG, [
      { external_id: "D0001", cdl_number: "S123456789", first_name: "Angel", last_name: "Cora" },
    ]);
    expect(rec.writes()).toEqual([]);
    expect(r.unmatched).toEqual(["D0001"]);
  });

  it("re-running is a no-op once the link is in place", async () => {
    const rec = seed({ drivers: [driver({ mcleod_driver_id: "D0001" })] });
    const r = await ingestDrivers(rec.client, ORG, [
      { external_id: "D0001", cdl_number: "S123456789", first_name: "Angel", last_name: "Cora" },
    ]);
    expect(r.alreadyLinked).toBe(1);
    expect(rec.writes()).toEqual([]);
  });
});

describe("matching", () => {
  it("matches a driver on licence number, which is the only key both systems hold", () => {
    // McLeod carries no phone for ANY of its 1,463 drivers, so the Samsara sync's precedence
    // (samsara id → phone → name) cannot be reused here.
    const m = makeDriverMatcher([{ id: "d-1", status: "active", identity_source: "samsara", link: null, cdl_number: "s-123 456 789", full_name: "Someone Entirely Different" }]);
    expect(m.match({ external_id: "D1", cdl_number: "S123456789", name: "Nobody" })).toEqual({ kind: "matched", id: "d-1", by: "cdl" });
  });

  it("prefers an existing link over every other key", () => {
    const m = makeDriverMatcher([
      { id: "d-linked", status: "active", identity_source: "samsara", link: "D1", cdl_number: null, full_name: null },
      { id: "d-cdl", status: "active", identity_source: "samsara", link: null, cdl_number: "S1", full_name: null },
    ]);
    expect(m.match({ external_id: "D1", cdl_number: "S1", name: "" })).toEqual({ kind: "linked", id: "d-linked", by: "link" });
  });

  it("refuses to guess when two rows share a key", () => {
    const m = makeDriverMatcher([
      { id: "a", status: "active", identity_source: "samsara", link: null, cdl_number: "S1", full_name: "A A" },
      { id: "b", status: "active", identity_source: "samsara", link: null, cdl_number: "S1", full_name: "B B" },
    ]);
    expect(m.match({ external_id: "D1", cdl_number: "S1", name: "A A" })).toEqual({ kind: "ambiguous", by: "cdl" });
  });

  it("holds applicants out of the pool and reports them instead", async () => {
    // 0213's lifecycle trigger exempts the service role, so nothing below this would stop a later
    // milestone writing an employment status over an in-flight hire.
    const rec = seed({ drivers: [driver({ id: "app-1", status: "applicant", identity_source: "manual" })] });
    const r = await ingestDrivers(rec.client, ORG, [
      { external_id: "D0001", cdl_number: "S123456789", first_name: "Angel", last_name: "Cora" },
    ]);
    expect(r.applicants).toEqual(["D0001"]);
    expect(r.linked).toBe(0);
    expect(rec.writes()).toEqual([]);
  });

  it("matches a trailer across FuelGuard's R prefix without rewriting the unit number", async () => {
    const rec = seed({ trailers: [trailer()] }); // stored as R532159
    const r = await ingestTrailers(rec.client, ORG, [{ external_id: "532159", company_id: "TMS", unit_number: "532159" }]);
    expect(r.linked).toBe(1);
    const payload = rec.writtenRows("trailers")[0]!;
    expect(payload).not.toHaveProperty("unit_number"); // renaming ~46 trailers is a human decision
    expect(payload.mcleod_trailer_id).toBe("532159");
  });

  it("normalises only a leading R before digits — a unit legitimately starting with R survives", () => {
    expect(trailerUnitMatchKey("R532159")).toBe("532159");
    expect(trailerUnitMatchKey("532159")).toBe("532159");
    expect(trailerUnitMatchKey("RAMP01")).toBe("RAMP01");
    expect(vehicleUnitKey(" 789 ")).toBe("789");
  });

  it("matches a vehicle on VIN ahead of unit number", async () => {
    const rec = seed({ vehicles: [vehicle({ unit_number: "OLD-789" })] });
    const r = await ingestVehicles(rec.client, ORG, [
      { external_id: "789", company_id: "TMS", vin: "3akjhhdr4lsll4083", unit_number: "789" },
    ]);
    expect(r.linked).toBe(1);
  });

  it("carries the org filter on the candidate read and on the link write", async () => {
    // The recorder RECORDS filters rather than applying them — a foreign row seeded here would still
    // come back from its fake select — so this asserts the filter is PRESENT, which is the thing a
    // service can get wrong. That the filter then isolates is the database's job and the RLS matrix's
    // assertion, not this file's.
    const rec = seed({ vehicles: [vehicle()] });
    await ingestVehicles(rec.client, ORG, [
      { external_id: "789", company_id: "TMS", vin: "3AKJHHDR4LSLL4083", unit_number: "789" },
    ]);
    expectOrgScoped(rec, ORG);
    expect(rec.writtenRows("vehicles")).toHaveLength(1);
  });

  it("asset matching prefers the link, then the configured key order", () => {
    const m = makeAssetMatcher(
      [{ id: "x", status: "active", identity_source: "samsara", link: null, vin: "V1", unit_number: "U1" }],
      vehicleUnitKey,
      ["unit", "vin"],
    );
    expect(m.match({ external_id: "E1", vin: "V1", unit_number: "U1" })).toEqual({ kind: "matched", id: "x", by: "unit" });
  });
});
