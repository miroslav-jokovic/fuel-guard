import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The order door (MEDSTOP-PLAN.md §7A.4, UX3). Proved here: only the three order roles reach it (owner
 * answer 1 — the recruiter included, the fleet manager not); with ordering switched off nothing is
 * placed and nothing reaches Med-Stop (0468, D-MSUX2); and a body field the preview did not show is
 * refused before anything else is asked.
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

const credential = (over: object = {}) => [{
  base_url: "https://api.med-stop.com", enabled: true, api_key_sealed: "v1.x", key_expires_on: null, last_synced_at: null, last_error: null,
  orders_enabled: false, order_contact_email: null, order_contact_phone: null, ...over,
}];
const order = {
  medstopId: "EE-ANN", service: "drug", reason: "POST-ACCIDENT", locationId: "LOC-1",
  requestDate: "2099-01-01", requestTime: "09:30", notifyBy: "PHONE CALL",
};

beforeEach(() => {
  holder.auth = as("safety_manager");
  db = createSupabaseRecorder({
    tables: {
      organizations: [{ operating_hours: { tz: "America/Chicago" } }],
      medstop_credentials: credential(),
      medstop_employees: [{ medstop_id: "EE-ANN", roster: "active", driver_id: "d-ann", match_rule: "licence" }],
      drivers: [{ id: "d-ann", full_name: "Ann Pooled", first_name: "Ann", last_name: "Pooled", date_of_birth: null, cdl_number: "A1", cdl_state: "IL", status: "active", archived_at: null }],
    },
  });
  holder.client = db.client;
});

const call = (path: string, body?: unknown) =>
  fetch(`${baseUrl}/api/drug-alcohol${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as { data?: unknown; error?: { code: string } } }));

describe("the order door", () => {
  it("admits the safety manager, an admin and the recruiter; refuses the fleet manager and dispatcher", async () => {
    for (const role of ["safety_manager", "admin", "recruiter"] as const) {
      holder.auth = as(role);
      expect((await call("/order/context")).status).toBe(200);
    }
    for (const role of ["fleet_manager", "dispatcher"] as const) {
      holder.auth = as(role);
      expect((await call("/order/context")).status).toBe(403);
      expect((await call("/order", order)).status).toBe(403);
    }
  });

  it("says ordering is off, and lists who could be ordered for, org-scoped", async () => {
    const { body } = await call("/order/context");
    expect(body.data).toMatchObject({ enabled: false, contactSet: false, people: [{ medstopId: "EE-ANN", driverId: "d-ann", name: "Ann Pooled" }], timeZone: "America/Chicago" });
    expectOrgScoped(db, ORG);
  });

  it("offers the next business day at 4 pm on the carrier's clock as the default 'Go by' (D-MSO2)", async () => {
    const { body } = await call("/order/context");
    const data = body.data as { today: string; goBy: { requestDate: string; requestTime: string } };
    expect(data.goBy.requestTime).toBe("16:00");
    expect(data.goBy.requestDate > data.today).toBe(true);
    expect([0, 6]).not.toContain(new Date(`${data.goBy.requestDate}T12:00:00Z`).getUTCDay());
    expectOrgScoped(db, ORG);
  });

  it("places nothing while ordering is switched off — and writes no audit row", async () => {
    const r = await call("/order", order);
    expect(r).toMatchObject({ status: 409, body: { error: { code: "medstop_orders_off" } } });
    expect(db.writtenRows("audit_logs")).toEqual([]);
  });

  it("refuses an order with no office contact even when switched on", async () => {
    db = createSupabaseRecorder({ tables: { medstop_credentials: credential({ orders_enabled: true }) } });
    holder.client = db.client;
    expect(await call("/order/preview", order)).toMatchObject({ status: 409, body: { error: { code: "medstop_contact_missing" } } });
  });

  it("refuses a body carrying a field the preview never showed (a driver's phone, say)", async () => {
    expect((await call("/order/preview", { ...order, tosms: "7735550199" })).status).toBe(400);
  });

  it("lets only a reader of results order a recollection or choose observation (MSO3) — the recruiter is refused before anything", async () => {
    holder.auth = as("recruiter");
    expect((await call("/order/preview", { ...order, recollectionOf: "T-DIL" })).status).toBe(403);
    expect((await call("/order", { ...order, recollectionOf: "T-DIL", observed: true })).status).toBe(403);
    expect((await call("/order/sites?service=drug&reason=POST-ACCIDENT&requestDate=2099-01-01&requestTime=16:00&zip=60601&medstopId=EE-ANN&observed=true")).status).toBe(403);
    // The same order without the recollection reaches the next check (ordering is switched off here).
    expect((await call("/order/preview", order)).status).toBe(409);
    holder.auth = as("safety_manager");
    expect((await call("/order/preview", { ...order, recollectionOf: "T-DIL" })).status).toBe(409);
  });
});

