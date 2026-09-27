import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { APPLICATION_RELEASE_ORDER, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The applicant's trip to the office (D-AW7, APPLICATION-FLOW-V2-PLAN §7, C2b2) through its HTTP door.
 *
 * ⚠ The refusal is the property: Q-HM5's *"we will not even bring him if this not green"* was an answer
 * nobody had to read until this writer existed. So the fixture is an applicant for whom every step
 * before travel is done, and each refusal case takes exactly ONE of those away — a fixture missing two
 * could not say which one the refusal was reading.
 *
 * ⚠ `postgrestFixture` applies the service's own filters, so another org's trip and another
 * invitation's trip are seeded to be picked up by a read that dropped either.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITE = "10000000-0000-4000-8000-000000000001";
const OLD_INVITE = "10000000-0000-4000-8000-000000000000";
const LIVE_TRIP = "20000000-0000-4000-8000-000000000001";
const NEW_TRIP = "20000000-0000-4000-8000-000000000009";

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = { recruiter: ctx("recruiter"), auditor: ctx("auditor"), dispatcher: ctx("dispatcher") };

/**
 * `organizations` is read by its own primary key — the caller's org id — for the carrier's zone, so it
 * has no `org_id` column to filter on; the id IS the tenant.
 */
const ORG_ROW = { exempt: ["organizations"] };

/** Every kind a step before travel reads: MVR, Clearinghouse, drug test, medical registry, PSP. */
const SCREENED = ["mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "psp_report"];

const TRIP = { mode: "air", depart_at: "2026-10-05T08:30", arrive_at: "2026-10-05T11:10", confirmation_ref: "QX7K2P" };

/**
 * `applicant_travel` as PostgREST would answer it: reads narrowed by the service's filters, an insert
 * handed back as the row it wrote (with the id the database would mint).
 */
const travelTable = (rows: Array<Record<string, unknown>>) => {
  const read = postgrestFixture(rows);
  return (q: RecordedQuery) => {
    if (q.write?.method === "insert") {
      const payload = q.write.payload as Record<string, unknown>;
      return [{ id: NEW_TRIP, created_at: "2026-09-26T18:00:00Z", cancelled_at: null, ...payload }];
    }
    return read(q);
  };
};

const seed = (over: { kinds?: string[]; intakeDone?: boolean; trips?: Array<Record<string, unknown>> } = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: postgrestFixture([{ id: DRIVER, org_id: ORG, hire_date: null }]),
      application_invitations: postgrestFixture([{
        id: INVITE, org_id: ORG, driver_id: DRIVER, created_at: "2026-09-01T00:00:00Z", revoked_at: null,
        intake_completed_at: over.intakeDone === false ? null : "2026-09-01T06:00:00Z",
        application_sent_at: "2026-09-02T00:00:00Z", review_requested_at: "2026-09-03T00:00:00Z",
        // ⚠ NOT approved: the owner buys the ticket before the office reads the application (§7).
        approved_at: null, signing_opened_at: null, submitted_at: null,
      }]),
      application_intakes: postgrestFixture([{ id: "in-1", org_id: ORG, invitation_id: INVITE }]),
      driver_authorizations: postgrestFixture(APPLICATION_RELEASE_ORDER.map((purpose, i) => ({
        id: `auth-${i}`, org_id: ORG, driver_id: DRIVER, purpose, accepted_at: "2026-09-01T07:00:00Z", revokes: null,
      }))),
      qualification_records: postgrestFixture((over.kinds ?? SCREENED).map((kind, i) => ({
        id: `qr-${i}`, org_id: ORG, driver_id: DRIVER, kind, created_at: "2026-09-04T00:00:00Z",
        occurred_on: "2026-09-04",
      }))),
      psp_requests: postgrestFixture([]),
      application_packet_marks: postgrestFixture([]),
      application_drafts: postgrestFixture([{ id: "dr-1", org_id: ORG, invitation_id: INVITE }]),
      driver_employment_history: postgrestFixture([]),
      employer_inquiries: postgrestFixture([]),
      handbook_marks: postgrestFixture([]),
      applicant_travel: travelTable(over.trips ?? [
        { id: LIVE_TRIP, org_id: ORG, invitation_id: INVITE, mode: "bus", depart_at: "2026-10-04T13:00:00Z",
          arrive_at: "2026-10-04T20:00:00Z", confirmation_ref: null, created_at: "2026-09-20T00:00:00Z", cancelled_at: null },
        { id: "trip-old-app", org_id: ORG, invitation_id: OLD_INVITE, mode: "air", depart_at: "2025-03-01T13:00:00Z",
          arrive_at: "2025-03-01T15:00:00Z", confirmation_ref: null, created_at: "2025-02-20T00:00:00Z", cancelled_at: null },
        { id: "trip-other-org", org_id: OTHER, invitation_id: INVITE, mode: "air", depart_at: "2026-10-04T13:00:00Z",
          arrive_at: "2026-10-04T15:00:00Z", confirmation_ref: null, created_at: "2026-09-21T00:00:00Z", cancelled_at: null },
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

describe("booking the trip (D-AW7)", () => {
  it("records it on the live invitation, in the carrier's clock, and replaces the live trip", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("POST", "/travel", "recruiter", TRIP);
    expect(res.status).toBe(201);

    const [row] = rec.writtenRows("applicant_travel");
    expect(row).toMatchObject({
      org_id: ORG, invitation_id: INVITE, mode: "air", booked_by: "u-recruiter", confirmation_ref: "QX7K2P",
      // 08:30 and 11:10 in Chicago on 2026-10-05 is CDT, UTC-5 — never the test machine's zone.
      depart_at: "2026-10-05T13:30:00.000Z",
      arrive_at: "2026-10-05T16:10:00.000Z",
    });
    // The older live trip is cancelled AFTER the insert, on this invitation only, never the new one.
    const cancel = rec.forTable("applicant_travel").find((q) => q.write?.method === "update")!;
    expect(cancel.filters()).toEqual(expect.arrayContaining([
      { col: "org_id", val: ORG }, { col: "invitation_id", val: INVITE },
    ]));
    expect(cancel.ops.find((o) => o.method === "neq")?.args).toEqual(["id", NEW_TRIP]);
    expectOrgScoped(rec, ORG, ORG_ROW);

    const [audit] = rec.writtenRows("audit_logs") as Array<{ action: string; meta: Record<string, unknown> }>;
    expect(audit).toMatchObject({ action: "recruiting.travel_booked", meta: { invitationId: INVITE, mode: "air" } });
    // The booking reference is an airline credential and stays out of the log.
    expect(JSON.stringify(audit)).not.toContain("QX7K2P");
  });

  /** One step before travel missing at a time — each must refuse, and name itself. */
  it.each([
    ["drug_test", { kinds: SCREENED.filter((k) => k !== "drug_test") }],
    ["medical_certificate", { kinds: SCREENED.filter((k) => k !== "medical_registry_verification") }],
    ["psp", { kinds: SCREENED.filter((k) => k !== "psp_report") }],
    ["intake_completed", { intakeDone: false }],
  ] as const)("refuses while %s is open, and writes nothing", async (step, over) => {
    const rec = seed(over);
    holder.client = rec.client;
    const res = await call("POST", "/travel", "recruiter", TRIP);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string }; missing: string[] };
    expect(body.error.code).toBe("not_ready_to_travel");
    expect(body.missing).toEqual([step]);
    expect(rec.writtenRows("applicant_travel")).toHaveLength(0);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("refuses an arrival before the departure, naming the field", async () => {
    holder.client = seed().client;
    const res = await call("POST", "/travel", "recruiter", { ...TRIP, arrive_at: "2026-10-05T07:00" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("arrival");
  });

  it("is the recruitment section's to write: a viewer may read, and may not book", async () => {
    holder.client = seed().client;
    expect((await call("POST", "/travel", "auditor", TRIP)).status).toBe(403);
    expect((await call("GET", "/travel", "auditor")).status).toBe(200);
    expect((await call("GET", "/travel", "dispatcher")).status).toBe(403);
  });

  it("404s a driver who is not this org's", async () => {
    const rec = seed();
    holder.client = createSupabaseRecorder({ tables: { drivers: postgrestFixture([]), audit_logs: [] } }).client;
    expect((await call("POST", "/travel", "recruiter", TRIP)).status).toBe(404);
    expect(rec.writtenRows("applicant_travel")).toHaveLength(0);
  });
});

describe("reading and cancelling", () => {
  it("lists the live invitation's trips only, with the zone they are shown in", async () => {
    const rec = seed();
    holder.client = rec.client;
    const body = (await (await call("GET", "/travel", "recruiter")).json()) as { trips: Array<{ id: string }>; timeZone: string };
    expect(body.trips.map((t) => t.id)).toEqual([LIVE_TRIP]);
    expect(body.timeZone).toBe("America/Chicago");
    expectOrgScoped(rec, ORG, ORG_ROW);
  });

  it("cancels a live trip on this application, and audits it", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("DELETE", `/travel/${LIVE_TRIP}`, "recruiter");
    expect(res.status).toBe(200);
    const [row] = rec.writtenRows("applicant_travel") as Array<{ cancelled_at: string }>;
    expect(row!.cancelled_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const update = rec.forTable("applicant_travel").find((q) => q.write?.method === "update")!;
    expect(update.filters()).toEqual(expect.arrayContaining([
      { col: "org_id", val: ORG }, { col: "invitation_id", val: INVITE }, { col: "id", val: LIVE_TRIP },
    ]));
    expect(rec.writtenRows("audit_logs")).toEqual([expect.objectContaining({ action: "recruiting.travel_cancelled" })]);
  });

  it("answers 404 for another application's trip and for an id that is not one", async () => {
    holder.client = seed().client;
    expect((await call("DELETE", "/travel/trip-old-app", "recruiter")).status).toBe(404);
    expect((await call("DELETE", `/travel/${NEW_TRIP}`, "recruiter")).status).toBe(404);
  });
});
