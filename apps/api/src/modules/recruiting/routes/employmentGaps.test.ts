import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type AuthContext, type EmploymentGapsView } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";

/**
 * Employment gaps after signing (HW5c, 0538) through the mount: who may read and write, that every
 * query carries the org (0538 has no client policies, so `expectOrgScoped` is the only layer that can
 * see a missing filter), that the recorder is the session's person, and that the applicant's own
 * explanations come from the signed application's gap list alone.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "11111111-2222-4333-8444-555555555555";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const OTHER_DRIVER = "77777777-8888-4999-8aaa-000000000000";
const GAP_A = "50000000-0000-4000-8000-00000000000a";
const GAP_W = "50000000-0000-4000-8000-00000000000b";
const GAP_X = "50000000-0000-4000-8000-00000000000c";

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = Object.fromEntries(
  ["admin", "recruiter", "auditor", "dispatcher", "driver"].map((r) => [r, ctx(r)]),
);

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    ...init,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
  });

const GAP = (id: string, org: string, driver: string, withdrawn: string | null = null) => ({
  id, org_id: org, driver_id: driver, started_on: "2024-01-01", ended_on: "2024-03-01",
  explanation: id === GAP_X ? "Not ours" : "Cared for a parent", recorded_by_name: "Dana Recruiter",
  created_at: "2026-11-01T10:00:00Z", withdrawn_at: withdrawn,
});

function seed(): SupabaseRecorder {
  rec = createSupabaseRecorder({
    tables: {
      drivers: postgrestFixture([
        { id: DRIVER, org_id: ORG, full_name: "Ana Driver" },
        { id: OTHER_DRIVER, org_id: OTHER_ORG, full_name: "Somebody Else" },
      ]),
      user_profiles: [{ full_name: "Dana Recruiter" }],
      driver_employment_gaps: (q) => {
        if (q.write?.method === "insert") return [{ id: "new-gap", created_at: "2026-11-01T12:00:00Z", withdrawn_at: null, ...(q.write.payload as Record<string, unknown>) }];
        if (q.write?.method === "update") return [{ ...GAP(GAP_A, ORG, DRIVER), withdrawn_at: "2026-11-01T12:00:00Z" }];
        return postgrestFixture([GAP(GAP_A, ORG, DRIVER), GAP(GAP_W, ORG, DRIVER, "2026-10-31T10:00:00Z"), GAP(GAP_X, OTHER_ORG, OTHER_DRIVER)])(q);
      },
      driver_applications: postgrestFixture([{
        org_id: ORG, driver_id: DRIVER, certified_at: "2026-10-07T10:00:00Z",
        payload: { employment_gaps: [{ from: "2023-05-01", to: "2023-08-01", explanation: "School" }, { from: "bad" }], ssn_last4: "1234" },
      }]),
      audit_logs: [],
    },
  });
  holder.client = rec.client;
  return rec;
}

/** `user_profiles` is a person's own profile, read by their user id (`displayNameFor`): no `org_id`. */
const PROFILE_EXEMPT = { exempt: ["user_profiles"] };


beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));
describe("who may read and write gaps", () => {
  it("lets recruitment viewers read and refuses them a write; refuses outsiders before any query", async () => {
    seed();
    expect((await call(`/applicants/${DRIVER}/employment-gaps`, "auditor")).status).toBe(200);
    seed();
    const write = await call(`/applicants/${DRIVER}/employment-gaps`, "auditor",
      { method: "POST", body: JSON.stringify({ started_on: "2024-01-01", ended_on: "2024-02-01", explanation: "x" }) });
    expect(write.status).toBe(403);
    for (const token of ["dispatcher", "driver"]) {
      seed();
      expect((await call(`/applicants/${DRIVER}/employment-gaps`, token)).status).toBe(403);
      expect(rec.queries.filter((q) => q.table === "driver_employment_gaps")).toHaveLength(0);
    }
  });
});

describe("reading", () => {
  it("lists this carrier's recorded gaps, withdrawn ones included, and the applicant's own from the signed application", async () => {
    seed();
    const res = await call(`/applicants/${DRIVER}/employment-gaps`, "recruiter");
    expect(res.status).toBe(200);
    const body = (await res.json()) as EmploymentGapsView;
    expect(body.recorded.map((g) => g.id).sort()).toEqual([GAP_A, GAP_W].sort());
    expect(body.recorded.find((g) => g.id === GAP_W)?.withdrawnAt).toBe("2026-10-31T10:00:00Z");
    // The unreadable entry is skipped, not shown half.
    expect(body.applicant).toEqual([{ from: "2023-05-01", to: "2023-08-01", explanation: "School" }]);
    expectOrgScoped(rec, ORG);
    // Only the gap list of the payload, never the whole application (identity) or the sealed SSN.
    const appSelect = rec.queries.find((q) => q.table === "driver_applications")!.ops.find((o) => o.method === "select")!.args[0];
    expect(appSelect).toBe("gaps:payload->employment_gaps");
  });

  it("answers 404 for another carrier's driver and reads none of their gaps", async () => {
    seed();
    expect((await call(`/applicants/${OTHER_DRIVER}/employment-gaps`, "recruiter")).status).toBe(404);
    expect(rec.queries.filter((q) => q.table === "driver_employment_gaps")).toHaveLength(0);
  });
});

describe("recording and withdrawing", () => {
  it("records a gap under the session's person, scoped to the org, and audits the dates without the words", async () => {
    seed();
    const res = await call(`/applicants/${DRIVER}/employment-gaps`, "recruiter",
      { method: "POST", body: JSON.stringify({ started_on: "2024-01-01", ended_on: "2024-03-01", explanation: "  Cared for a parent  ", recorded_by_name: "Eve" }) });
    // A client-named recorder is refused by the strict contract, not silently ignored.
    expect(res.status).toBe(400);

    seed();
    const ok = await call(`/applicants/${DRIVER}/employment-gaps`, "recruiter",
      { method: "POST", body: JSON.stringify({ started_on: "2024-01-01", ended_on: "2024-03-01", explanation: "  Cared for a parent  " }) });
    expect(ok.status).toBe(201);
    const [row] = rec.writtenRows("driver_employment_gaps");
    expect(row).toMatchObject({
      org_id: ORG, driver_id: DRIVER, started_on: "2024-01-01", ended_on: "2024-03-01",
      explanation: "Cared for a parent", recorded_by: "u-recruiter", recorded_by_name: "Dana Recruiter",
    });
    const [audit] = rec.writtenRows("audit_logs");
    expect(JSON.stringify(audit)).not.toContain("Cared for a parent");
    expectOrgScoped(rec, ORG, PROFILE_EXEMPT);
  });

  it("refuses dates that run backwards", async () => {
    seed();
    const res = await call(`/applicants/${DRIVER}/employment-gaps`, "recruiter",
      { method: "POST", body: JSON.stringify({ started_on: "2024-05-01", ended_on: "2024-03-01", explanation: "x" }) });
    expect(res.status).toBe(400);
    expect(rec.writtenRows("driver_employment_gaps")).toHaveLength(0);
  });

  it("withdraws a gap once, scoped to the org and the driver, and refuses a second withdrawal", async () => {
    seed();
    const res = await call(`/applicants/${DRIVER}/employment-gaps/${GAP_A}/withdraw`, "recruiter", { method: "POST" });
    expect(res.status).toBe(200);
    const update = rec.writes().find((w) => w.table === "driver_employment_gaps")!;
    expect(Object.keys(update.write!.payload as object).sort()).toEqual(["withdrawn_at", "withdrawn_by"]);
    expectOrgScoped(rec, ORG);

    seed();
    expect((await call(`/applicants/${DRIVER}/employment-gaps/${GAP_W}/withdraw`, "recruiter", { method: "POST" })).status).toBe(409);
    expect(rec.writes().filter((w) => w.table === "driver_employment_gaps")).toHaveLength(0);
  });

  it("cannot withdraw another carrier's gap", async () => {
    seed();
    expect((await call(`/applicants/${DRIVER}/employment-gaps/${GAP_X}/withdraw`, "recruiter", { method: "POST" })).status).toBe(404);
    expect(rec.writes().filter((w) => w.table === "driver_employment_gaps")).toHaveLength(0);
  });
});
