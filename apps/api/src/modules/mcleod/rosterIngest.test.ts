import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
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

  it("matches a trailer across Silvicom 360's R prefix without rewriting the unit number", async () => {
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

describe("identity mode (M4)", () => {
  const mcleodDriver = {
    external_id: "D0001", company_id: "TMS", cdl_number: "S123456789", cdl_state: "IL",
    first_name: "Angel", last_name: "Cora", cdl_expires_at: "2031-04-02",
    medical_card_expires_at: "2027-06-01", hire_date: "2020-03-01",
  } as const;

  it("refreshes the fields McLeod owns and claims the row", async () => {
    const rec = seed({ drivers: [driver({ mcleod_driver_id: "D0001" })] });
    const r = await ingestDrivers(rec.client, ORG, [mcleodDriver], "identity");
    expect(r.updated).toBe(1);
    const p = rec.writtenRows("drivers")[0]!;
    expect(p.cdl_expires_at).toBe("2031-04-02");
    expect(p.medical_card_expires_at).toBe("2027-06-01");
    expect(p.full_name).toBe("Angel Cora"); // composed from parts; McLeod's `name` is the surname
    expect(p.identity_source).toBe("mcleod"); // taking over identity IS the ownership transfer
  });

  it("writes the email the agent extracted, and stays ignorant of where it lived", async () => {
    // This carrier keeps driver email in McLeod's `name_of_spouse` column. The agent absorbs that and
    // validates it — the column is char(28) and 8 of 164 addresses are truncated past saving — so by
    // the time it arrives here it is either usable or absent, and Silvicom 360 never learns the quirk.
    const rec = seed({ drivers: [driver({ mcleod_driver_id: "D0001" })] });
    await ingestDrivers(rec.client, ORG, [{ ...mcleodDriver, email: "angel.cora@silvicom.com" }], "identity");
    expect(rec.writtenRows("drivers")[0]!.email).toBe("angel.cora@silvicom.com");
  });

  it("leaves a stored email alone when the agent rejected the source value as truncated", async () => {
    const rec = seed({ drivers: [driver({ mcleod_driver_id: "D0001" })] });
    await ingestDrivers(rec.client, ORG, [mcleodDriver], "identity"); // no email on the payload
    expect(rec.writtenRows("drivers")[0]!).not.toHaveProperty("email");
  });

  it("never writes phone — McLeod has none, and Samsara's is the only one there is", async () => {
    const rec = seed({ drivers: [driver({ mcleod_driver_id: "D0001" })] });
    await ingestDrivers(rec.client, ORG, [mcleodDriver], "identity");
    expect(rec.writtenRows("drivers")[0]!).not.toHaveProperty("phone");
  });

  it("omits a field McLeod did not supply rather than nulling a good value", async () => {
    // Coverage is uneven — 175 of 190 tractors carry a plate — so a blind full-row write would erase
    // real data on every sweep for the rows the carrier simply has not filled in.
    const rec = seed({ drivers: [driver({ mcleod_driver_id: "D0001" })] });
    await ingestDrivers(rec.client, ORG, [
      { external_id: "D0001", cdl_number: "S123456789", first_name: "Angel", last_name: "Cora" },
    ], "identity");
    const p = rec.writtenRows("drivers")[0]!;
    for (const k of ["cdl_expires_at", "medical_card_expires_at", "hire_date", "city", "date_of_birth"]) {
      expect(p).not.toHaveProperty(k);
    }
  });

  it("stands off a row the office owns, and says so", async () => {
    // The DQ1 rule: an admin who fixed a name must not watch it revert on the next sweep.
    const rec = seed({ drivers: [driver({ mcleod_driver_id: "D0001", identity_source: "manual" })] });
    const r = await ingestDrivers(rec.client, ORG, [mcleodDriver], "identity");
    expect(r.skippedOwned).toBe(1);
    expect(r.updated).toBe(0);
    expect(rec.writes()).toEqual([]);
  });

  it("stands off an EFS stub — that merge belongs in a review queue, not a sync", async () => {
    // EFS stubs carry no licence, so they can only be reached by the NAME fallback. Measured
    // 2026-08-24: all 163 real matches landed on 'samsara' rows and not one stub was touched, so this
    // costs nothing today and stops the structural risk arriving later.
    const rec = seed({ drivers: [driver({ mcleod_driver_id: "D0001", identity_source: "efs", cdl_number: null })] });
    const r = await ingestDrivers(rec.client, ORG, [mcleodDriver], "identity");
    expect(r.skippedOwned).toBe(1);
    expect(rec.writes()).toEqual([]);
  });

  it("derives an inspection EXPIRY from the date McLeod records it was performed", async () => {
    // McLeod's inspection_date runs backwards from every other date on the row: 175 of 175 in the
    // past. Silvicom 360's column is an expiry, so the §396.17 annual interval is applied here.
    const rec = seed({ vehicles: [vehicle({ mcleod_tractor_id: "789" })] });
    await ingestVehicles(rec.client, ORG, [
      { external_id: "789", vin: "3AKJHHDR4LSLL4083", unit_number: "789", annual_inspection_performed_at: "2026-08-14" },
    ], "identity");
    expect(rec.writtenRows("vehicles")[0]!.dot_annual_inspection_expires_at).toBe("2027-08-14");
  });

  /**
   * The other half of that derivation, and the one A6 depends on.
   *
   * Once Silvicom performs its own §396.17 inspection, `roster.recordEquipmentInspectionExpiry`
   * writes the expiry AND claims the row to 'manual' (D-AVI9, ANNUAL-INSPECTION-PLAN). That claim is
   * worth nothing unless this sweep honours it — so the standing-off is asserted for VEHICLES here
   * and not only for drivers above, because a truck is the thing the inspection is about.
   *
   * Note what would happen without it: the office certifies unit 789 on 2026-06-16, and the next
   * nightly sweep quietly replaces the expiry with one derived from McLeod's own inspection_date.
   * Nothing errors, nothing is logged, and the compliance surface silently disagrees with the filed
   * report — the dual-source failure ARCHITECTURE.md §3 calls the audit's sharpest finding.
   */
  it("stands off a VEHICLE the office claimed by inspecting it — the expiry is not reverted", async () => {
    const rec = seed({
      vehicles: [vehicle({ mcleod_tractor_id: "789", identity_source: "manual" })],
    });
    const r = await ingestVehicles(rec.client, ORG, [
      { external_id: "789", vin: "3AKJHHDR4LSLL4083", unit_number: "789", annual_inspection_performed_at: "2026-08-14" },
    ], "identity");
    expect(r.skippedOwned).toBe(1);
    expect(r.updated).toBe(0);
    expect(rec.writes()).toEqual([]);
  });

  it("never writes tank capacity, which is learned from fill history", async () => {
    const rec = seed({ vehicles: [vehicle({ mcleod_tractor_id: "789" })] });
    await ingestVehicles(rec.client, ORG, [
      { external_id: "789", vin: "3AKJHHDR4LSLL4083", unit_number: "789", make: "Freightliner", year: 2020 },
    ], "identity");
    const p = rec.writtenRows("vehicles")[0]!;
    for (const k of ["tank_capacity_gal", "tank_capacity_source", "observed_max_fill_gal", "odometer_offset"]) {
      expect(p).not.toHaveProperty(k);
    }
    expect(p.make).toBe("Freightliner");
  });

  it("writes is_reefer in both directions but never touches pairing", async () => {
    const rec = seed({ trailers: [trailer({ mcleod_trailer_id: "532159" })] });
    await ingestTrailers(rec.client, ORG, [
      { external_id: "532159", unit_number: "532159", is_reefer: false },
    ], "identity");
    const p = rec.writtenRows("trailers")[0]!;
    expect(p.is_reefer).toBe(false); // a false must land, or a mis-flagged trailer stays mis-flagged
    for (const k of ["assigned_vehicle_id", "pairing_source", "pairing_confidence", "unit_number"]) {
      expect(p).not.toHaveProperty(k);
    }
  });

  it("never writes status or termination — retiring a row is M6 and carries retention rules", async () => {
    const rec = seed({ drivers: [driver({ mcleod_driver_id: "D0001" })] });
    await ingestDrivers(rec.client, ORG, [
      { ...mcleodDriver, status: "terminated", termination_date: "2026-08-01" },
    ], "identity");
    const p = rec.writtenRows("drivers")[0]!;
    expect(p).not.toHaveProperty("status");
    expect(p).not.toHaveProperty("termination_date");
  });

  it("link mode is unchanged by any of this", async () => {
    const rec = seed({ drivers: [driver()] });
    await ingestDrivers(rec.client, ORG, [mcleodDriver]);
    expect(Object.keys(rec.writtenRows("drivers")[0]!).sort()).toEqual(["mcleod_company_id", "mcleod_driver_id"]);
  });
});

/**
 * R1 — the sweep also files the licence and the medical card as EVIDENCE (D-ARC3; DRIVER-ROSTER-PLAN
 * Q2, answered option (a) 2026-08-30).
 *
 * The invariant `recordSyncedCredentials` holds — write only on change — is unit-tested at its own
 * seam in `evidence/syncedCredentials.test.ts`. What is asserted HERE is the wiring, and every case
 * below is about the sweep NOT filing: the evidence write inherits the sweep's ownership decision
 * rather than re-making it, so a row the office owns and a report-mode pass must both leave the
 * append-only record untouched.
 */
describe("credentials become evidence (R1)", () => {
  const mcleodDriver = {
    external_id: "D0001", company_id: "TMS", cdl_number: "S123456789", cdl_state: "IL",
    first_name: "Angel", last_name: "Cora", cdl_expires_at: "2031-04-02",
    medical_card_expires_at: "2027-06-01",
  } as const;
  const withCerts = (drivers: unknown[], certifications: unknown[] = []) =>
    createSupabaseRecorder({
      tables: { drivers, certifications },
      rpc: { insert_certification: [{ id: "cert-1", superseded_id: null }] },
    });

  it("files both credentials through evidence when it refreshed the row", async () => {
    const rec = withCerts([driver({ mcleod_driver_id: "D0001" })]);
    const r = await ingestDrivers(rec.client, ORG, [mcleodDriver], "identity");
    expect(r.credentialsFiled).toBe(2);
    const kinds = rec.rpcs().map((c) => (c.args as Record<string, unknown>).p_kind);
    expect(kinds.sort()).toEqual(["cdl", "medical_card"]);
    expect(r.credentialFailures).toEqual([]);
  });

  it("files nothing for a row the office owns — the stand-off covers the evidence record too", async () => {
    // identity_source 'manual' is the office's escape hatch. The sweep already refuses to touch the
    // columns; filing a certification anyway would be the same overreach through a different door.
    const rec = withCerts([driver({ mcleod_driver_id: "D0001", identity_source: "manual" })]);
    const r = await ingestDrivers(rec.client, ORG, [mcleodDriver], "identity");
    expect(r.skippedOwned).toBe(1);
    expect(r.credentialsFiled).toBe(0);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("files nothing in report mode, which is supposed to write nothing at all", async () => {
    const rec = withCerts([driver({ mcleod_driver_id: "D0001" })]);
    const r = await ingestDrivers(rec.client, ORG, [mcleodDriver], "report");
    expect(r.credentialsFiled).toBe(0);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("files nothing in link mode, where no identity fields are written either", async () => {
    const rec = withCerts([driver()]);
    const r = await ingestDrivers(rec.client, ORG, [mcleodDriver], "link");
    expect(r.credentialsFiled).toBe(0);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("does not strand the sweep when a credential cannot be filed", async () => {
    const rec = createSupabaseRecorder({
      tables: { drivers: [driver({ mcleod_driver_id: "D0001" })], certifications: [] },
      rpc: { insert_certification: { data: null, error: { message: "boom" } } },
    });
    const r = await ingestDrivers(rec.client, ORG, [mcleodDriver], "identity");
    expect(r.updated).toBe(1); // the roster write still happened
    expect(r.credentialsFiled).toBe(0);
    expect(r.credentialFailures).toEqual(["D0001:cdl", "D0001:medical_card"]);
  });
});

describe("create mode (M5)", () => {
  const newDriver = {
    external_id: "D9999", company_id: "TMS", cdl_number: "NEW123456",
    first_name: "Nadia", last_name: "Okonkwo", cdl_expires_at: "2032-01-01",
  } as const;

  it("inserts an unmatched McLeod driver, stamped as McLeod-owned and active", async () => {
    const rec = seed({ drivers: [] });
    const r = await ingestDrivers(rec.client, ORG, [newDriver], "create");
    expect(r.created).toBe(1);
    expect(r.unmatched).toEqual([]);
    const row = rec.writtenRows("drivers")[0]!;
    expect(row.full_name).toBe("Nadia Okonkwo");
    expect(row.identity_source).toBe("mcleod");
    expect(row.mcleod_driver_id).toBe("D9999");
    // The agent's query selects only is_active='Y', so anything reaching here is currently employed.
    expect(row.status).toBe("active");
  });

  it("never creates a duplicate of a driver it can already match", async () => {
    const rec = seed({ drivers: [driver({ cdl_number: "NEW123456" })] });
    const r = await ingestDrivers(rec.client, ORG, [newDriver], "create");
    expect(r.created).toBe(0);
    expect(r.updated).toBe(1);
  });

  it("creates a new truck with zero tank capacity and flags it for completion", async () => {
    // tank_capacity_gal is NOT NULL and is LEARNED from observed fills; a guessed capacity silently
    // degrades every fuel anomaly on that truck. Same posture as samsaraVehicleSync.
    const rec = seed({ vehicles: [] });
    const r = await ingestVehicles(rec.client, ORG, [
      { external_id: "789", company_id: "TMS", vin: "1FUJGLD56GLGY5844", unit_number: "789", make: "Freightliner" },
    ], "create");
    expect(r.created).toBe(1);
    expect(r.needsCompletion).toEqual(["789"]);
    const row = rec.writtenRows("vehicles")[0]!;
    expect(row.tank_capacity_gal).toBe(0);
    expect(row.unit_number).toBe("789");
  });

  it("does not flag a MATCHED truck for completion — it already has a capacity", async () => {
    const rec = seed({ vehicles: [vehicle()] });
    const r = await ingestVehicles(rec.client, ORG, [
      { external_id: "789", vin: "3AKJHHDR4LSLL4083", unit_number: "789" },
    ], "create");
    expect(r.created).toBe(0);
    expect(r.needsCompletion).toEqual([]);
  });

  it("gives a new trailer McLeod's bare unit number, not Silvicom 360's R convention", async () => {
    const rec = seed({ trailers: [] });
    await ingestTrailers(rec.client, ORG, [
      { external_id: "533999", company_id: "TMS", unit_number: "533999", is_reefer: true },
    ], "create");
    // Inventing the prefix for a new row would be this sync deciding a naming policy.
    expect(rec.writtenRows("trailers")[0]!.unit_number).toBe("533999");
  });

  it("creates a driver who has only a first name rather than dropping them", async () => {
    // I first wrote this the other way — refuse unless a surname is present — and it is the wrong
    // rule. A refused record is INVISIBLE: it leaves the roster silently and nobody reviews a driver
    // who was never created. A partially-named one appears in the roster, carries its licence for
    // matching, and an admin can finish it. Being visible and imperfect beats being absent and tidy.
    //
    // The edge case is theoretical against this carrier — all 164 active drivers have a surname —
    // which is exactly why the rule should favour visibility over strictness.
    const rec = seed({ drivers: [] });
    const r = await ingestDrivers(rec.client, ORG, [
      { external_id: "D8888", cdl_number: "ZZZ1", first_name: "Onlyfirst" },
    ], "create");
    expect(r.created).toBe(1);
    expect(rec.writtenRows("drivers")[0]!.full_name).toBe("Onlyfirst");
  });

  it("refuses only when there is no name at all — full_name is NOT NULL", async () => {
    const rec = seed({ drivers: [] });
    const r = await ingestDrivers(rec.client, ORG, [{ external_id: "D7777", cdl_number: "ZZZ2" }], "create");
    expect(r.created).toBe(0);
    expect(r.unmatched).toEqual(["D7777"]);
    expect(rec.writes()).toEqual([]);
  });

  it("still reports rather than creates in identity mode", async () => {
    const rec = seed({ drivers: [] });
    const r = await ingestDrivers(rec.client, ORG, [newDriver], "identity");
    expect(r.created).toBe(0);
    expect(r.unmatched).toEqual(["D9999"]);
    expect(rec.writes()).toEqual([]);
  });
});

/**
 * Report mode — the answer to "what would this do?" against a fleet people are using today.
 *
 * There is no second Silvicom 360 org to rehearse against: the only other one holds seven drivers and no
 * vehicles at all. So the first time this pipeline meets real data, that data IS Silvicom's 264
 * drivers, 195 vehicles and 211 trailers. Report mode makes that first contact read-only, and it is
 * how §7's hand-computed match report (162 / 175 / 201) finally gets reproduced BY THE PIPELINE,
 * which is what M3's Done-when asks for and what nothing has ever demonstrated — production carries
 * zero McLeod links on all three tables.
 */
describe("report mode", () => {
  const mcleodDriver = {
    external_id: "D0001", company_id: "TMS", cdl_number: "S123456789",
    first_name: "Angel", last_name: "Cora",
  };

  it("writes NOTHING — not the link, not a field, not a row", async () => {
    const rec = seed({ drivers: [driver()] });
    await ingestDrivers(rec.client, ORG, [mcleodDriver], "report");
    expect(rec.writes()).toEqual([]);
  });

  it("counts exactly what link mode would have linked", async () => {
    const seeded = { drivers: [driver()] };
    const report = await ingestDrivers(seed(seeded).client, ORG, [mcleodDriver], "report");
    const link = await ingestDrivers(seed(seeded).client, ORG, [mcleodDriver], "link");
    expect(report.linked).toBe(link.linked);
    expect(report.upserted).toBe(link.upserted);
    expect(report.received).toBe(1);
  });

  it("still reports what it could not place — that IS the deliverable", async () => {
    const rec = seed({ drivers: [] });
    const r = await ingestDrivers(rec.client, ORG, [mcleodDriver], "report");
    expect(r.unmatched).toEqual(["D0001"]);
    expect(r.created).toBe(0);
    expect(rec.writes()).toEqual([]);
  });

  it("applies the same ambiguity refusal, so the numbers are the ones a real sweep would produce", async () => {
    // Two Silvicom 360 drivers holding the same licence: a real sweep refuses, and so must the rehearsal.
    const rec = seed({ drivers: [driver(), driver({ id: "d-2" })] });
    const r = await ingestDrivers(rec.client, ORG, [mcleodDriver], "report");
    expect(r.ambiguous).toEqual(["D0001"]);
    expect(rec.writes()).toEqual([]);
  });

  it("counts vehicles and trailers without writing either", async () => {
    const rec = seed({ vehicles: [vehicle()], trailers: [trailer()] });
    const v = await ingestVehicles(rec.client, ORG, [{ external_id: "789", vin: "3AKJHHDR4LSLL4083" }], "report");
    const t = await ingestTrailers(rec.client, ORG, [{ external_id: "532159", unit_number: "532159" }], "report");
    expect(v.linked).toBe(1);
    expect(t.linked).toBe(1); // the R-prefix normalisation still applies
    expect(rec.writes()).toEqual([]);
  });

  it("scopes every read to one org — the service role bypasses RLS", async () => {
    const rec = seed({ drivers: [driver()] });
    await ingestDrivers(rec.client, ORG, [mcleodDriver], "report");
    expectOrgScoped(rec, ORG);
  });
});

/**
 * The four fields the 2026-08-24 reconnaissance actually found (MCLEOD-FIELD-GAP-PLAN §7c).
 *
 * The recon asked 23 questions and most answers were empty columns — which is a SOURCE-ROUTING
 * answer, not a gap: five systems feed this database and "McLeod holds nothing here" means the
 * column belongs to Samsara, FleetPal, EFS or PSP. `tank_capacity_gal` is the clearest case, set
 * locally today and FleetPal's next, so `tractor.fuel_capacity` being empty on 190 of 190 costs
 * nothing.
 */
describe("the fields the recon found", () => {
  it("writes a tractor's purchase date", async () => {
    const rec = seed({ vehicles: [vehicle()] });
    await ingestVehicles(rec.client, ORG, [
      { external_id: "789", vin: "3AKJHHDR4LSLL4083", purchased_at: "2019-06-01" },
    ], "identity");
    expect(rec.writtenRows("vehicles")[0]).toMatchObject({ purchased_at: "2019-06-01" });
  });

  it("derives a trailer's annual-inspection EXPIRY from the date it was performed", async () => {
    // 228 of 235 trailers carry this and 228 of 228 are in the past, so it records when the annual
    // happened — while Silvicom 360's column is an expiry. Same shape as the tractor's.
    const rec = seed({ trailers: [trailer()] });
    await ingestTrailers(rec.client, ORG, [
      { external_id: "532159", unit_number: "532159", annual_inspection_performed_at: "2026-02-11" },
    ], "identity");
    expect(rec.writtenRows("trailers")[0]).toMatchObject({
      dot_annual_inspection_expires_at: "2027-02-11",
    });
  });

  it("writes a trailer's purchase date and axle count", async () => {
    const rec = seed({ trailers: [trailer()] });
    await ingestTrailers(rec.client, ORG, [
      { external_id: "532159", unit_number: "532159", purchased_at: "2018-04-20", axle_count: 2 },
    ], "identity");
    expect(rec.writtenRows("trailers")[0]).toMatchObject({ purchased_at: "2018-04-20", axle_count: 2 });
  });

  it("never writes a trailer registration expiry — McLeod has none for ANY trailer", async () => {
    // `tag_expire_date` is populated on 0 of 235. The tractor path writes the equivalent because
    // there the column has 175 values; asserting the asymmetry is deliberate keeps it from looking
    // like an oversight to whoever reads this next.
    const rec = seed({ trailers: [trailer()] });
    await ingestTrailers(rec.client, ORG, [
      { external_id: "532159", unit_number: "532159", purchased_at: "2018-04-20" },
    ], "identity");
    expect(rec.writtenRows("trailers")[0]).not.toHaveProperty("registration_expires_at");
  });

  it("still writes nothing at all in report mode", async () => {
    const rec = seed({ trailers: [trailer()] });
    await ingestTrailers(rec.client, ORG, [
      { external_id: "532159", unit_number: "532159", purchased_at: "2018-04-20", axle_count: 2 },
    ], "report");
    expect(rec.writes()).toEqual([]);
  });
});
