import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { MedstopClient } from "../client.js";

/**
 * The close door (MEDSTOP-PLAN.md §7A.21, MSO2), end to end through `app.ts`. Med-Stop's switch and key are
 * stubbed at `orderClient` (the switch itself is proved off below by leaving it stubbed off); everything else
 * is real. Pinned: the order roles only; ordering off writes nothing; a close is audited; and the appointment
 * the order filled is retired through recruiting's real writer, matched on its reference.
 */
const holder = vi.hoisted(() => ({ client: null as unknown, medstop: null as unknown, on: true }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));
vi.mock("../order.js", async (real) => ({
  ...(await real<typeof import("../order.js")>()),
  orderClient: async () =>
    holder.on
      ? { client: holder.medstop, contact: { email: "der@x.test", phone: "3125550100" } }
      : { refusal: { status: 409, code: "medstop_orders_off", message: "Ordering tests is switched off." } },
}));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const INVITE = "10000000-0000-4000-8000-000000000001";
let auth: AuthContext = { userId: "u-rec", email: "r@x.test", orgId: ORG, role: "recruiter" };

const posts: string[] = [];
const medstop = () =>
  new MedstopClient({
    apiKey: "k", baseUrl: "https://api.med-stop.com", maxRetries: 0, pageDelayMs: 0, sleep: async () => {},
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (init?.method === "POST") return (posts.push(u.pathname), new Response("{}", { status: 200 }));
      if (u.pathname === "/Request/152d5f7a-e40a-f4bf-0428-00c53813b977") return new Response(JSON.stringify({ data: { id: "152d5f7a-e40a-f4bf-0428-00c53813b977", status: "OPEN", code: "AUTH-9", location: "Concentra Joliet", locationid: "LOC-1", zip: "60435", requestdate: "2026-11-04T16:00:00Z" } }), { status: 200 });
      if (u.pathname === "/Request/152d5f7a-e40a-f4bf-0428-00c53813b977/status") return new Response(JSON.stringify({ data: { id: "152d5f7a-e40a-f4bf-0428-00c53813b977", status: "", comment: "", refusal: "", notification: "" } }), { status: 200 });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch,
  });

let rec: SupabaseRecorder;
beforeEach(() => {
  posts.length = 0;
  holder.on = true;
  auth = { ...auth, role: "recruiter" };
  rec = createSupabaseRecorder({
    tables: {
      drivers: [{ id: DRIVER, full_name: "Al Applicant", first_name: "Al", last_name: "Applicant", date_of_birth: null, cdl_number: "B2", cdl_state: "IL", status: "applicant", archived_at: null }],
      medstop_employees: [{ medstop_id: "EE-APP", roster: "applicant", driver_id: DRIVER, match_rule: "licence" }],
      medstop_requests: postgrestFixture([{ org_id: ORG, medstop_id: "152d5f7a-e40a-f4bf-0428-00c53813b977", employee_medstop_id: "EE-APP" }]),
      application_invitations: postgrestFixture([{ id: INVITE, org_id: ORG, driver_id: DRIVER, created_at: "2026-11-01T00:00:00Z", revoked_at: null }]),
      organizations: postgrestFixture([{ id: ORG, operating_hours: { tz: "America/Chicago" } }]),
      drug_test_appointments: [{ id: "appt-1" }],
      audit_logs: [],
    },
    rpc: { medstop_merge: 0 },
  });
  holder.client = rec.client;
  holder.medstop = medstop();
});

let server: Server;
let baseUrl = "";
beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async () => auth;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

const post = (path: string, body: unknown) =>
  fetch(`${baseUrl}/api/drug-alcohol${path}`, { method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: (await r.json()) as { data?: unknown; error?: { code: string } } }));

describe("closing an order from the step (MSO2)", () => {
  it("closes it once, audits it, and retires the appointment the order filled — by its reference", async () => {
    const r = await post("/order/152d5f7a-e40a-f4bf-0428-00c53813b977/close", { status: "NO SHOW" });
    expect(r).toMatchObject({ status: 200, body: { data: { requestId: "152d5f7a-e40a-f4bf-0428-00c53813b977", status: "NO SHOW", reorder: { medstopId: "EE-APP", zip: "60435", locationId: "LOC-1" } } } });
    expect(posts).toEqual(["/Request/152d5f7a-e40a-f4bf-0428-00c53813b977/status"]);
    expect(rec.writtenRows("audit_logs")).toEqual([expect.objectContaining({ action: "medstop.order.closed", entity_id: "152d5f7a-e40a-f4bf-0428-00c53813b977" })]);
    const retire = rec.forTable("drug_test_appointments").find((q) => q.write?.method === "update")!;
    expect(retire.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "invitation_id", val: INVITE }, { col: "donor_reference", val: "AUTH-9" }]));
    expectOrgScoped(rec, ORG);
  });

  it("previews without writing anything", async () => {
    const r = await post("/order/152d5f7a-e40a-f4bf-0428-00c53813b977/close/preview", { status: "CANCELED" });
    expect(r).toMatchObject({ status: 200, body: { data: { status: "CANCELED", person: "Al Applicant" } } });
    expect(posts).toEqual([]);
    expect(rec.writtenRows("audit_logs")).toEqual([]);
  });

  it("is the order roles' only: the dispatcher and fleet manager are refused", async () => {
    for (const role of ["dispatcher", "fleet_manager"] as const) {
      auth = { ...auth, role };
      expect((await post("/order/152d5f7a-e40a-f4bf-0428-00c53813b977/close", { status: "NO SHOW" })).status).toBe(403);
    }
    expect(posts).toEqual([]);
  });

  it("writes nothing while ordering is switched off, and refuses REFUSAL — a §40.191 determination is not a button", async () => {
    holder.on = false;
    expect(await post("/order/152d5f7a-e40a-f4bf-0428-00c53813b977/close", { status: "NO SHOW" })).toMatchObject({ status: 409, body: { error: { code: "medstop_orders_off" } } });
    holder.on = true;
    expect((await post("/order/152d5f7a-e40a-f4bf-0428-00c53813b977/close", { status: "REFUSAL" })).status).toBe(400);
    expect((await post("/order/REQ%2F77/close", { status: "NO SHOW" })).status).toBe(400);
    expect(posts).toEqual([]);
  });
});
