import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext, DrugAlcoholProgram } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Safety › Drug & Alcohol's read (MEDSTOP-PLAN.md §6, §7A five tabs). Proved here: every query is
 * scoped to the caller's org (the service role bypasses RLS); the roster check, medical cards and
 * in-progress list reach the page; and the selection lists — and any RANDOM order in progress — are
 * held to the roles that read testing records.
 */

const holder = vi.hoisted(() => ({ client: null as unknown, auth: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const as = (role: AuthContext["role"]): AuthContext => ({ userId: "u", email: "u@x.test", orgId: ORG, role });
const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

let server: Server;
let baseUrl = "";
let db: SupabaseRecorder;

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async () => holder.auth as AuthContext;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

const drivers = [
  { id: "d-in", full_name: "Ann Pooled", first_name: "Ann", last_name: "Pooled", date_of_birth: null, cdl_number: "A1", cdl_state: "IL", status: "active", archived_at: null },
  { id: "d-out", full_name: "Bob Outside", first_name: "Bob", last_name: "Outside", date_of_birth: null, cdl_number: "B2", cdl_state: "IL", status: "active", archived_at: null },
  { id: "d-gone", full_name: "Cy Gone", first_name: "Cy", last_name: "Gone", date_of_birth: null, cdl_number: "C3", cdl_state: "IL", status: "terminated", archived_at: null },
];
// Relative to the server's today, so the Medical tab's 60-day horizon holds on any day the suite runs.
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const employees = [
  { medstop_id: "m-ann", roster: "active", first_name: "ANN", last_name: "POOLED", birth_date: null, license_number: "A1", license_state: "IL", medical_expires_on: inDays(20), driver_id: "d-in", match_rule: "licence" },
  { medstop_id: "m-cy", roster: "active", first_name: "CY", last_name: "GONE", birth_date: null, license_number: "C3", license_state: "IL", medical_expires_on: null, driver_id: "d-gone", match_rule: "licence" },
];

beforeEach(() => {
  holder.auth = as("safety_manager");
  db = createSupabaseRecorder({
    tables: {
      organizations: [{ operating_hours: { tz: "America/Chicago" } }],
      medstop_credentials: [{ base_url: "https://api.med-stop.com", enabled: true, api_key_sealed: "v1.x", key_expires_on: null, last_synced_at: "2026-10-13T14:00:00Z", last_error: null }],
      medstop_employees: employees,
      medstop_pools: [{ service: "TD", name: "drug", pool_year: new Date().getFullYear(), ends_on: null, frequency: "QUARTERLY", target_percent: 53, current_percent: 42.58, members_avg: 155, completed_tests: 66, scheduled_tests: 17 }],
      medstop_selections: [{ medstop_id: "s1", employee_medstop_id: "m-ann", service: "TD", selected_on: "2020-01-02", request_medstop_id: null, test_medstop_id: null, status: "OPEN" }],
      drivers,
      certifications: [{ subject_id: "d-in", expires_at: inDays(300), document_id: null }],
      // What each source last said (0467): McLeod agrees with the card on file, Med-Stop is earlier.
      credential_source_dates: [
        { driver_id: "d-in", source: "mcleod", expires_on: inDays(300) },
        { driver_id: "d-in", source: "medstop", expires_on: inDays(20) },
      ],
      medstop_requests: [{ medstop_id: "r-rand", employee_medstop_id: "m-ann", service: "TD", reason: "RANDOM", status: "OPEN", requested_local: `${inDays(-1)}T09:00:00`, test_medstop_id: null }],
      medstop_tests: [{ medstop_id: "t-pre", employee_medstop_id: "m-ann", service: "TD", reason: "PRE-EMPLOYMENT", status: "AT LAB", result: null, collected_local: `${inDays(-2)}T09:00:00` }],
    },
  });
  holder.client = db.client;
});

const read = async () => {
  const res = await fetch(`${baseUrl}/api/drug-alcohol/program`, { headers: { Authorization: "Bearer t" } });
  return { status: res.status, body: (await res.json()) as { data: DrugAlcoholProgram } };
};

describe("GET /api/drug-alcohol/program", () => {
  it("scopes every query to the caller's org", async () => {
    expect((await read()).status).toBe(200);
    expectOrgScoped(db, ORG);
  });

  it("answers the two roster violations, the medical card on the safe side, and the pool's tests owed", async () => {
    const { body } = await read();
    expect(body.data.roster).toEqual({
      notInPool: [{ driverId: "d-out", medstopId: null, name: "Bob Outside" }],
      leftButInPool: [{ driverId: "d-gone", medstopId: "m-cy", name: "Cy Gone" }],
    });
    // Unscanned card at 300 days, Med-Stop says 20: Q-MSUX7 files the earliest, so the driver is due
    // AND flagged, with each source's date beside it.
    const ann = {
      person: { driverId: "d-in", medstopId: null, name: "Ann Pooled" },
      expiresOn: inDays(20),
      daysLeft: 20,
      documented: false,
      sources: [{ source: "mcleod", expiresOn: inDays(300) }, { source: "medstop", expiresOn: inDays(20) }],
      disagree: true,
    };
    expect(body.data.medical).toEqual({ due: [ann], disagree: [ann] });
    expect(body.data.pools[0]).toMatchObject({ service: "drug", testsOwed: 17, requiredTests: 83 });
    expect(body.data.connected).toBe(true);
  });

  it("lists every order and test in progress for the DER, random included", async () => {
    const { body } = await read();
    expect(body.data.inProgress.map((r) => r.key).sort()).toEqual(["order:r-rand", "test:t-pre"]);
  });

  it("hides a random order from a fleet manager, who still sees the pre-employment test (§382.305(l))", async () => {
    holder.auth = as("fleet_manager");
    const { body } = await read();
    expect(body.data.inProgress.map((r) => r.key)).toEqual(["test:t-pre"]);
  });

  it("shows the DER who is selected and untested, by our driver's name", async () => {
    const { body } = await read();
    expect(body.data.selections?.due.map((s) => s.person.name)).toEqual(["Ann Pooled"]);
  });

  it("holds the selection lists back — null, not empty — from a fleet manager", async () => {
    holder.auth = as("fleet_manager");
    const { status, body } = await read();
    expect(status).toBe(200);
    expect(body.data.selections).toBeNull();
    expect(body.data.roster.notInPool).toHaveLength(1);
  });

  it("refuses a role outside the safety section", async () => {
    holder.auth = as("dispatcher");
    expect((await read()).status).toBe(403);
  });
});
