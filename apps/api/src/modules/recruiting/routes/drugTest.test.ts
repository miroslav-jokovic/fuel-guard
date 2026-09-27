import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The drug test's appointment (D-AW6, APPLICATION-FLOW-V2-PLAN §6.3, C2b3) through its HTTP door.
 *
 * ⚠ `postgrestFixture` applies the service's own filters, so another org's appointment and another
 * invitation's appointment are seeded to be picked up by a read that dropped either.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITE = "10000000-0000-4000-8000-000000000001";
const OLD_INVITE = "10000000-0000-4000-8000-000000000000";
const LIVE = "30000000-0000-4000-8000-000000000001";
const NEW = "30000000-0000-4000-8000-000000000009";

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = { recruiter: ctx("recruiter"), auditor: ctx("auditor"), dispatcher: ctx("dispatcher") };

const BOOKING = {
  site_name: "Concentra Joliet",
  site_address: "1051 Essington Rd, Joliet, IL 60435",
  site_phone: "815-555-0142",
  window_start: "2026-10-01T08:00",
  window_end: "2026-10-01T12:00",
  donor_reference: "REG-448812",
};

const appointmentTable = (rows: Array<Record<string, unknown>>) => {
  const read = postgrestFixture(rows);
  return (q: RecordedQuery) => {
    if (q.write?.method === "insert") {
      const payload = q.write.payload as Record<string, unknown>;
      return [{ id: NEW, created_at: "2026-09-26T18:00:00Z", sent_to_driver_at: null, cancelled_at: null, ...payload }];
    }
    return read(q);
  };
};

const row = (id: string, org: string, invitation: string) => ({
  id, org_id: org, invitation_id: invitation, site_name: "Old site", site_address: "1 Main St",
  site_phone: null, window_start: "2026-09-28T14:00:00Z", window_end: null, donor_reference: null,
  created_at: "2026-09-20T00:00:00Z", sent_to_driver_at: null, cancelled_at: null,
});

const seed = (over: { invitations?: Array<Record<string, unknown>> } = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: postgrestFixture(over.invitations ?? [{
        id: INVITE, org_id: ORG, driver_id: DRIVER, created_at: "2026-09-01T00:00:00Z", revoked_at: null,
      }]),
      drug_test_appointments: appointmentTable([
        row(LIVE, ORG, INVITE), row("appt-old-app", ORG, OLD_INVITE), row("appt-other-org", OTHER, INVITE),
      ]),
      organizations: postgrestFixture([{ id: ORG, operating_hours: { tz: "America/Chicago" } }]),
      audit_logs: [],
    },
  });

let server: Server;
let baseUrl: string;

const call = (method: string, path: string, token: string, body?: unknown) =>
  fetch(`${baseUrl}/api/recruitment/applicants/${DRIVER}${path}`, {
    method,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

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

describe("arranging the drug test (D-AW6)", () => {
  it("records it on the live invitation, in the carrier's clock, and replaces the live one", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("POST", "/drug-test-appointments", "recruiter", BOOKING);
    expect(res.status).toBe(201);

    const [written] = rec.writtenRows("drug_test_appointments");
    expect(written).toMatchObject({
      org_id: ORG, invitation_id: INVITE, arranged_by: "u-recruiter", site_name: "Concentra Joliet",
      donor_reference: "REG-448812",
      // 08:00 and 12:00 in Chicago on 2026-10-01 is CDT, UTC-5 — never the test machine's zone.
      window_start: "2026-10-01T13:00:00.000Z",
      window_end: "2026-10-01T17:00:00.000Z",
    });
    const cancel = rec.forTable("drug_test_appointments").find((q) => q.write?.method === "update")!;
    expect(cancel.filters()).toEqual(expect.arrayContaining([
      { col: "org_id", val: ORG }, { col: "invitation_id", val: INVITE },
    ]));
    expect(cancel.ops.find((o) => o.method === "neq")?.args).toEqual(["id", NEW]);
    expectOrgScoped(rec, ORG);

    const [audit] = rec.writtenRows("audit_logs") as Array<{ action: string; meta: Record<string, unknown> }>;
    expect(audit).toMatchObject({ action: "recruiting.drug_test_arranged", meta: { invitationId: INVITE, siteName: "Concentra Joliet" } });
    // The donor reference identifies a specimen at the lab and stays out of the log.
    expect(JSON.stringify(audit)).not.toContain("REG-448812");
  });

  it("refuses a window that ends before it starts, naming the field", async () => {
    holder.client = seed().client;
    const res = await call("POST", "/drug-test-appointments", "recruiter", { ...BOOKING, window_end: "2026-10-01T07:00" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("window");
  });

  it("refuses an applicant with no live invitation, writing nothing", async () => {
    const rec = seed({ invitations: [] });
    holder.client = rec.client;
    expect((await call("POST", "/drug-test-appointments", "recruiter", BOOKING)).status).toBe(409);
    expect(rec.writtenRows("drug_test_appointments")).toHaveLength(0);
  });

  it("is the recruitment section's to write: a viewer may read, and may not arrange", async () => {
    holder.client = seed().client;
    expect((await call("POST", "/drug-test-appointments", "auditor", BOOKING)).status).toBe(403);
    expect((await call("GET", "/drug-test-appointments", "auditor")).status).toBe(200);
    expect((await call("GET", "/drug-test-appointments", "dispatcher")).status).toBe(403);
  });
});

describe("reading and cancelling", () => {
  it("lists the live invitation's appointments only, with the zone they are shown in", async () => {
    const rec = seed();
    holder.client = rec.client;
    const body = (await (await call("GET", "/drug-test-appointments", "recruiter")).json()) as {
      appointments: Array<{ id: string }>; timeZone: string;
    };
    expect(body.appointments.map((a) => a.id)).toEqual([LIVE]);
    expect(body.timeZone).toBe("America/Chicago");
    expectOrgScoped(rec, ORG);
  });

  it("cancels a live appointment on this application, and audits it", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await call("DELETE", `/drug-test-appointments/${LIVE}`, "recruiter")).status).toBe(200);
    const update = rec.forTable("drug_test_appointments").find((q) => q.write?.method === "update")!;
    expect(update.filters()).toEqual(expect.arrayContaining([
      { col: "org_id", val: ORG }, { col: "invitation_id", val: INVITE }, { col: "id", val: LIVE },
    ]));
    expect(rec.writtenRows("audit_logs")).toEqual([expect.objectContaining({ action: "recruiting.drug_test_cancelled" })]);
  });

  it("answers 404 for another application's appointment and for an id that is not one", async () => {
    holder.client = seed().client;
    expect((await call("DELETE", "/drug-test-appointments/appt-old-app", "recruiter")).status).toBe(404);
    expect((await call("DELETE", `/drug-test-appointments/${NEW}`, "recruiter")).status).toBe(404);
  });
});
