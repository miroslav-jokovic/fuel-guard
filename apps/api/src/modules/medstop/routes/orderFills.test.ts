import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { MedstopClient } from "../client.js";

/**
 * The order door, end to end through `app.ts` (MEDSTOP-PLAN.md §7A.21, MSO1). Med-Stop's half is
 * stubbed at `order.ts` — placing is proved in `order.test.ts`; here the order is simply accepted — so
 * what this proves is the composition: a placed pre-employment order reaches recruiting's real writer,
 * which `app.ts` hands to medstop because medstop may not import recruiting. The step's appointment is
 * written from Med-Stop's request, and the answer says so.
 */
const holder = vi.hoisted(() => ({ client: null as unknown, medstop: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));
vi.mock("../order.js", async (real) => ({
  ...(await real<typeof import("../order.js")>()),
  orderClient: async () => ({ client: holder.medstop, contact: { email: "der@x.test", phone: "3125550100" } }),
  placeOrder: async (_a: unknown, _c: unknown, contact: { email: string; phone: string }, _o: string, input: { medstopId: string }) => ({
    requestId: "REQ-77",
    person: { medstopId: input.medstopId, driverId: DRIVER, name: "Al Applicant" },
    payload: { payment: "EMPLOYER", tosms: contact.phone, toemail: contact.email },
  }),
}));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const INVITE = "10000000-0000-4000-8000-000000000001";
const auth: AuthContext = { userId: "u-rec", email: "r@x.test", orgId: ORG, role: "recruiter" };

const medstop = () =>
  new MedstopClient({
    apiKey: "k", baseUrl: "https://api.med-stop.com", maxRetries: 0, pageDelayMs: 0, sleep: async () => {},
    fetchImpl: (async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/Request/REQ-77")
        return new Response(JSON.stringify({ data: { id: "REQ-77", code: "AUTH-9", location: "Concentra Joliet", address: "1051 Essington Rd", city: "Joliet", state: "IL", zip: "60435", requestdate: "2026-11-04 16:00:00" } }), { status: 200 });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch,
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

describe("a pre-employment order fills the hiring step (MSO1)", () => {
  it("writes the applicant's appointment from Med-Stop's request through recruiting's writer, and answers 'filled'", async () => {
    const insertAnswer = (q: RecordedQuery) =>
      q.write?.method === "insert" ? [{ id: "appt-1", created_at: "2026-11-03T18:00:00Z", sent_to_driver_at: null, cancelled_at: null, ...(q.write.payload as object) }] : [];
    const rec = createSupabaseRecorder({
      tables: {
        organizations: postgrestFixture([{ id: ORG, operating_hours: { tz: "America/Chicago" } }]),
        application_invitations: postgrestFixture([{ id: INVITE, org_id: ORG, driver_id: DRIVER, created_at: "2026-11-01T00:00:00Z", revoked_at: null }]),
        drug_test_appointments: insertAnswer,
        audit_logs: [],
      },
      rpc: { medstop_merge: 0 },
    });
    holder.client = rec.client;
    holder.medstop = medstop();
    const res = await fetch(`${baseUrl}/api/drug-alcohol/order`, {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ medstopId: "EE-APP", service: "drug", reason: "PRE-EMPLOYMENT", locationId: "LOC-1", requestDate: "2099-01-01", requestTime: "16:00", notifyBy: "PHONE CALL" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { requestId: "REQ-77", appointment: "filled" } });
    // The writer's own insert (its second write cancels any older live appointment).
    expect(rec.writtenRows("drug_test_appointments").filter((r) => "site_name" in r)).toEqual([
      expect.objectContaining({ invitation_id: INVITE, site_name: "Concentra Joliet", site_address: "1051 Essington Rd, Joliet, IL 60435", donor_reference: "AUTH-9", arranged_by: "u-rec" }),
    ]);
    expect(rec.writtenRows("audit_logs").map((a) => a.action)).toEqual(["medstop.order.placed", "recruiting.drug_test_arranged"]);
  });
});
