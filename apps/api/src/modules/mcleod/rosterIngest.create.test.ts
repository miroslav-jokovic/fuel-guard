import { describe, it, expect } from "vitest";
import { driversToProvision } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { ingestDrivers } from "./rosterIngest.js";

/**
 * Create mode for drivers (ROSTER-LIFECYCLE-PLAN RL1): a McLeod hire becomes a row on the sweep that
 * first sees it, instead of waiting for a fuel card and an ELD login to make one. Each fixture is a
 * production shape measured 2026-10-30: two hires with no row at all, a hire whose EFS card row arrived
 * first without a licence, and a hire still sitting in Hiring as an applicant.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const driver = (over: Record<string, unknown> = {}) => ({
  id: "d-1", org_id: ORG, status: "active", identity_source: "efs", cdl_number: null, full_name: "STREETIE VIRGIN",
  mcleod_driver_id: null, archived_at: null, termination_date: null, ...over,
});
const seed = (rows: Record<string, unknown>[]) =>
  createSupabaseRecorder({
    tables: {
      drivers: (q: RecordedQuery) =>
        q.ops.some((o) => o.method === "is" && o.args[0] === "archived_at" && o.args[1] === null)
          ? rows.filter((r) => r.archived_at == null)
          : q.ops.some((o) => o.method === "insert") ? [{ id: "d-new" }] : rows,
    },
  });

const buren = { external_id: "JBUREN", company_id: "TMS", cdl_number: "B1234567", first_name: "JOHN", last_name: "BUREN", hire_date: "2026-10-30", status: "active" as const };
const virgin = { external_id: "SVIRGIN", company_id: "TMS", cdl_number: "V7654321", first_name: "STREETIE", last_name: "VIRGIN", hire_date: "2026-10-29", status: "active" as const };
const hairston = { external_id: "CHAIRSTO", company_id: "TMS", cdl_number: "H5550001", first_name: "CURTIS", last_name: "HAIRSTON", hire_date: "2026-10-28", status: "active" as const };

describe("create mode — a McLeod hire becomes a driver row (RL1)", () => {
  it("inserts a hire nothing answers to, McLeod-owned and active, carrying the hire record", async () => {
    const rec = seed([]);
    const r = await ingestDrivers(rec.client, ORG, [buren], "create");
    const row = rec.writtenRows("drivers").find((x) => x.mcleod_driver_id === "JBUREN");
    expect(row).toMatchObject({
      full_name: "JOHN BUREN", status: "active", identity_source: "mcleod",
      cdl_number: "B1234567", hire_date: "2026-10-30", mcleod_company_id: "TMS",
    });
    expect(r.created).toBe(1);
    expect(r.retry).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("only reports the same hire in identity mode — the mode the VM ran until RL1", async () => {
    const rec = seed([]);
    const r = await ingestDrivers(rec.client, ORG, [buren], "identity");
    expect(rec.writtenRows("drivers")).toEqual([]);
    expect(r.unmatched).toEqual(["JBUREN"]);
  });

  it("never creates a second row beside an EFS card row that answers only by name, and asks again", async () => {
    const rec = seed([driver()]);
    const r = await ingestDrivers(rec.client, ORG, [virgin], "create");
    expect(rec.writtenRows("drivers")).toEqual([]);
    expect(r.created).toBe(0);
    expect(r.retry).toEqual(["SVIRGIN"]);
  });

  it("holds an applicant reached by licence", async () => {
    const rec = seed([driver({ id: "d-app", status: "applicant", identity_source: "manual", full_name: "CURTIS HAIRSTON", cdl_number: "H5550001" })]);
    const r = await ingestDrivers(rec.client, ORG, [hairston], "create");
    expect(rec.writtenRows("drivers")).toEqual([]);
    expect(r.applicants).toEqual(["CHAIRSTO"]);
  });

  it("holds an applicant reached only by name — a blank or mistyped licence on the form must not make a second driver", async () => {
    for (const cdl_number of [null, "H555OOO1"]) {
      const rec = seed([driver({ id: "d-app", status: "applicant", identity_source: "manual", full_name: "Curtis Hairston", cdl_number })]);
      const r = await ingestDrivers(rec.client, ORG, [hairston], "create");
      expect(rec.writtenRows("drivers")).toEqual([]);
      expect(r.created).toBe(0);
      expect(r.applicants).toEqual(["CHAIRSTO"]);
      expect(r.retry).toEqual(["CHAIRSTO"]);
    }
  });

  it("never creates a second row beside an archived former driver whose rehire McLeod's dates do not prove", async () => {
    // Archived 09-14, rehired in McLeod with a hire date BEFORE the termination: not proven (D-MR7a), so
    // the former row is left for a person — and the matcher's pool, which leaves archived rows out, would
    // otherwise read this driver as `unmatched` and create them again.
    const former = driver({ id: "d-old", status: "terminated", identity_source: "efs", full_name: "JOHN BUREN", cdl_number: "B1234567", termination_date: "2026-11-15", archived_at: "2026-09-14T19:10:00Z" });
    const rec = seed([former]);
    const r = await ingestDrivers(rec.client, ORG, [buren], "create");
    expect(rec.writtenRows("drivers")).toEqual([]);
    expect(r.created).toBe(0);
    expect(r.rehireReview).toEqual(["JBUREN"]);
    expect(r.retry).toContain("JBUREN");
  });

  it("creates nothing when two applicants share the name — nobody can tell which is the hire", async () => {
    const rec = seed([
      driver({ id: "d-a1", status: "applicant", identity_source: "manual", full_name: "CURTIS HAIRSTON" }),
      driver({ id: "d-a2", status: "applicant", identity_source: "manual", full_name: "CURTIS HAIRSTON" }),
    ]);
    const r = await ingestDrivers(rec.client, ORG, [hairston], "create");
    expect(rec.writtenRows("drivers")).toEqual([]);
    expect(r.ambiguous).toEqual(["CHAIRSTO"]);
  });
});

describe("the fuel card that arrives after the McLeod row (RL1)", () => {
  // The EFS import used to be how a hire got a row at all. Once McLeod creates the row first, the card's
  // name must land on it instead of provisioning a second driver — in either order of the name's parts.
  it("does not provision a driver McLeod already created", () => {
    expect(driversToProvision(["BUREN, JOHN", "JOHN BUREN"], [{ full_name: "JOHN BUREN" }])).toEqual([]);
  });
});
