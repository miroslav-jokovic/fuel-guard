import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { MedstopClient } from "./client.js";
import { medicalClaims, sweepMedstop } from "./sync.js";

/**
 * One sweep (MEDSTOP-PLAN.md §6 MS1). Proved here: everything is fetched before anything is written,
 * so a failure half-way through leaves yesterday's mirror; the match is written with the row; and a
 * rehire on two Med-Stop lists is stored once, as the most current.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function medstop(routes: Record<string, unknown[] | "fail">) {
  const fetchImpl = (async (url: string) => {
    const path = new URL(url).pathname;
    const rows = routes[path];
    if (rows === "fail") return new Response("{}", { status: 500 });
    if (!rows || rows.length === 0) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ data: { pagemax: 1 }, rows: [rows] }), { status: 200 });
  }) as unknown as typeof fetch;
  return new MedstopClient({ apiKey: "k", baseUrl: "https://api.med-stop.com", fetchImpl, maxRetries: 0, sleep: async () => {} });
}

const drivers = [{ id: "d1", full_name: "Ann Pooled", first_name: "Ann", last_name: "Pooled", date_of_birth: null, cdl_number: "A-1", cdl_state: "IL", status: "active", archived_at: null }];

describe("sweepMedstop", () => {
  it("matches, de-duplicates a rehire, and replaces each kind whole — all scoped to the org", async () => {
    const db = createSupabaseRecorder({ tables: { drivers }, rpc: () => ({ data: 1, error: null }) });
    const result = await sweepMedstop(db.client, medstop({
      "/Employee/list": [{ id: "e1", fname: "ANN", lname: "POOLED", license: "A1", licensestate: "il", status: "FULL TIME" }],
      "/Employee/applicants": [],
      "/Employee/terminated": [{ id: "e1", fname: "ANN", lname: "POOLED", status: "TERMINATED" }, { id: "e2", fname: "X", lname: "Y" }],
      "/Random/pools": [{ id: "p1", service: "TD", poolyear: 2026, targetpercent: "53.00", currentpercent: 42.58, membersavg: 155 }],
      "/Random/selections": [],
    }), ORG);

    expect(result).toMatchObject({ employees: 2, matched: 1, pools: 1, selections: 0 });
    const calls = db.rpcs();
    expect(calls.map((c) => (c.args as { p_kind: string }).p_kind)).toEqual(["employees", "pools"]);
    const rows = (calls[0]!.args as { p_rows: Record<string, unknown>[] }).p_rows;
    expect(rows.find((r) => r.medstop_id === "e1")).toMatchObject({ roster: "active", driver_id: "d1", match_rule: "licence", license_state: "IL" });
    expect((calls[1]!.args as { p_rows: Record<string, unknown>[] }).p_rows[0]).toMatchObject({ target_percent: 53, members_avg: 155 });
    for (const c of calls) expect((c.args as { p_org: string }).p_org).toBe(ORG);
    expectOrgScoped(db, ORG);
  });

  it("writes NOTHING when a later list fails — a partial roster would put real drivers outside the pool", async () => {
    const db = createSupabaseRecorder({ tables: { drivers }, rpc: () => ({ data: 1, error: null }) });
    await expect(sweepMedstop(db.client, medstop({
      "/Employee/list": [{ id: "e1", fname: "ANN", lname: "POOLED" }],
      "/Employee/applicants": [],
      "/Employee/terminated": "fail",
    }), ORG)).rejects.toThrow();
    expect(db.rpcs()).toEqual([]);
  });

  /**
   * UX2 (D-MSUX4a): Med-Stop's medical date reaches the qualification file as a CLAIM, through
   * evidence's door — never `.from("certifications")` here — and only for a certain match (R3).
   */
  it("reports a matched driver's medical date to evidence, which files it on an empty file", async () => {
    const db = createSupabaseRecorder({
      tables: { drivers },
      rpc: (fn) => (fn === "insert_certification" ? [{ id: "c1", superseded_id: null }] : fn === "record_credential_source_date" ? true : 1),
    });
    const result = await sweepMedstop(db.client, medstop({
      "/Employee/list": [{ id: "e1", fname: "ANN", lname: "POOLED", license: "A1", licensestate: "il", medexpiration: "2027-03-01" }],
      "/Employee/applicants": [],
      "/Employee/terminated": [],
      "/Random/pools": [],
      "/Random/selections": [],
    }), ORG);
    expect(result.medical).toEqual({ written: 1, unchanged: 0, failed: 0 });
    const claim = db.rpcs().find((c) => c.fn === "record_credential_source_date");
    expect(claim?.args).toMatchObject({ p_org: ORG, p_driver: "d1", p_source: "medstop", p_expires_on: "2027-03-01" });
    const filed = db.rpcs().find((c) => c.fn === "insert_certification");
    expect(filed?.args).toMatchObject({ p_org_id: ORG, p_subject_id: "d1", p_kind: "medical_card", p_expires_at: "2027-03-01" });
    expect(db.writes().filter((w) => w.table === "certifications")).toEqual([]);
    expectOrgScoped(db, ORG);
  });
});

describe("medicalClaims", () => {
  const row = (over: Record<string, unknown>) =>
    ({ driver_id: "d1", roster: "active", match_rule: "licence", medical_expires_on: "2027-03-01", ...over }) as never;
  it("claims for an active, certain match only", () => {
    expect(medicalClaims([row({})])).toEqual([{ driverId: "d1", expiresOn: "2027-03-01" }]);
    expect(medicalClaims([row({ match_rule: "name_dob" })])).toHaveLength(1);
    // R3: a name-only match never moves a qualification file.
    expect(medicalClaims([row({ match_rule: "name" })])).toEqual([]);
    expect(medicalClaims([row({ roster: "terminated" })])).toEqual([]);
    expect(medicalClaims([row({ roster: "applicant" })])).toEqual([]);
    expect(medicalClaims([row({ driver_id: null, match_rule: null })])).toEqual([]);
  });
});
