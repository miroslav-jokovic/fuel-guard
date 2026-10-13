import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext, DrugAlcoholProgram } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Safety › Drug & Alcohol's read (MEDSTOP-PLAN.md §6 F-1/F-2). Proved here: every query is scoped to
 * the caller's org (the service role bypasses RLS), the reconciliation reaches the page, and the
 * selection lists are held to the roles that read testing records — NULL, not empty, for the rest.
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
const employees = [
  { medstop_id: "m-ann", roster: "active", first_name: "ANN", last_name: "POOLED", birth_date: null, license_number: "A1", license_state: "IL", medical_expires_on: "2027-07-22", driver_id: "d-in" },
  { medstop_id: "m-cy", roster: "active", first_name: "CY", last_name: "GONE", birth_date: null, license_number: "C3", license_state: "IL", medical_expires_on: null, driver_id: "d-gone" },
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
      certifications: [{ subject_id: "d-in", expires_at: "2027-01-01" }],
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

  it("answers the four reconciliation lists and the pool's tests owed", async () => {
    const { body } = await read();
    expect(body.data.roster.notInPool.map((p) => p.driverId)).toEqual(["d-out"]);
    expect(body.data.roster.leftButInPool.map((p) => p.driverId)).toEqual(["d-gone"]);
    expect(body.data.roster.medicalDisagrees).toEqual([
      { person: { driverId: "d-in", medstopId: "m-ann", name: "Ann Pooled" }, ours: "2027-01-01", medstop: "2027-07-22" },
    ]);
    expect(body.data.pools[0]).toMatchObject({ service: "drug", testsOwed: 17, requiredTests: 83 });
    expect(body.data.connected).toBe(true);
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
