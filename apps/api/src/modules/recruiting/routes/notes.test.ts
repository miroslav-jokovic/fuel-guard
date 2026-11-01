import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { APPLICANT_ACTIVITY_KINDS, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { readLastNotes } from "../applicantBoardReads.js";

/**
 * Notes and activity on the applicant record (HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P10), through the
 * mount: who may read and write, that every query carries the org (the service role bypasses RLS and
 * 0535 has no client policies, so `expectOrgScoped` is the only layer that can see a missing filter),
 * and that the activity list is folded from the rows on file in date order.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "11111111-2222-4333-8444-555555555555";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const OTHER_DRIVER = "77777777-8888-4999-8aaa-000000000000";
const INV = "44444444-5555-4666-8777-888888888888";
const NOTE_A = "50000000-0000-4000-8000-00000000000a";
const NOTE_B = "50000000-0000-4000-8000-00000000000b";
const JOB = "60000000-0000-4000-8000-000000000001";

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

/** Every table the fixture applicant has a row in — one row per activity kind, each on its own day. */
const fixture = (over: { notes?: unknown[] } = {}) => ({
  drivers: postgrestFixture([
    { id: DRIVER, org_id: ORG, full_name: "Ana Plicant" },
    { id: OTHER_DRIVER, org_id: OTHER_ORG, full_name: "Somebody Else" },
  ]),
  user_profiles: [{ full_name: "Dana Recruiter" }],
  application_invitations: postgrestFixture([{
    id: INV, org_id: ORG, driver_id: DRIVER, created_by: "u-admin", revoked_at: null,
    created_at: "2026-10-01T10:00:00Z", intake_completed_at: "2026-10-02T10:00:00Z",
    application_sent_at: "2026-10-03T10:00:00Z", review_requested_at: "2026-10-04T10:00:00Z",
    approved_at: "2026-10-06T10:00:00Z", submitted_at: "2026-10-07T10:00:00Z",
  }]),
  driver_authorizations: postgrestFixture([
    { id: "a1", org_id: ORG, driver_id: DRIVER, purpose: "psp", accepted_at: "2026-10-02T11:00:00Z", revokes: null, recorded_by: null },
    { id: "a2", org_id: ORG, driver_id: DRIVER, purpose: "psp", accepted_at: "2026-10-20T11:00:00Z", revokes: "a1", recorded_by: "u-admin" },
  ]),
  qualification_records: postgrestFixture([
    { org_id: ORG, driver_id: DRIVER, kind: "mvr", created_at: "2026-10-08T10:00:00Z", created_by: "u-admin" },
  ]),
  psp_requests: postgrestFixture([{ org_id: ORG, driver_id: DRIVER, created_at: "2026-10-09T10:00:00Z", status: "succeeded" }]),
  sms_outbox: postgrestFixture([
    { org_id: ORG, driver_id: DRIVER, template: "nudge", status: "sent", created_at: "2026-10-10T09:00:00Z", sent_at: "2026-10-10T10:00:00Z", failed_at: null },
  ]),
  sms_consents: postgrestFixture([
    { org_id: ORG, driver_id: DRIVER, source: "application", granted_at: "2026-10-01T12:00:00Z", revoked_at: "2026-10-11T10:00:00Z", revoked_reason: "inbound: STOP" },
  ]),
  sms_suppressions: postgrestFixture([
    { org_id: ORG, driver_id: DRIVER, reason: "stop", created_at: "2026-10-11T10:00:00Z", lifted_at: "2026-10-12T10:00:00Z" },
  ]),
  application_edits: postgrestFixture([
    { org_id: ORG, invitation_id: INV, path: ["employers", JOB, "address_line1"], before: null, after: "1 Main St", edited_by: "u-admin", edited_at: "2026-10-05T10:00:00Z" },
  ]),
  application_drafts: postgrestFixture([
    { org_id: ORG, invitation_id: INV, payload: { employers: [{ key: JOB, employer_name: "ABC Trucking" }] } },
  ]),
  applicant_travel: postgrestFixture([
    { org_id: ORG, invitation_id: INV, mode: "bus", depart_at: "2026-10-20T10:00:00Z", booked_by: "u-admin", cancelled_at: "2026-10-14T10:00:00Z", created_at: "2026-10-13T10:00:00Z" },
  ]),
  applicant_dispositions: postgrestFixture([
    { org_id: ORG, driver_id: DRIVER, outcome: "withdrawn", decided_on: "2026-10-21", decided_by: "u-admin", created_at: "2026-10-21T10:00:00Z" },
  ]),
  applicant_notes: postgrestFixture((over.notes as Record<string, unknown>[] | undefined) ?? [
    { id: NOTE_A, org_id: ORG, driver_id: DRIVER, invitation_id: INV, body: "Called, sends the SSN card Monday", author_id: "u-admin", author_name: "Dana Recruiter", pinned: false, created_at: "2026-10-15T10:00:00Z" },
    { id: NOTE_B, org_id: ORG, driver_id: DRIVER, invitation_id: INV, body: "Prefers texts", author_id: "u-admin", author_name: "Dana Recruiter", pinned: true, created_at: "2026-10-01T09:00:00Z" },
    { id: "n-other", org_id: OTHER_ORG, driver_id: OTHER_DRIVER, invitation_id: null, body: "Not ours", author_id: null, author_name: "Them", pinned: false, created_at: "2026-10-30T10:00:00Z" },
  ]),
  audit_logs: [],
});

function seed(over: { notes?: unknown[]; rpc?: unknown } = {}): SupabaseRecorder {
  rec = createSupabaseRecorder({
    tables: fixture(over),
    rpc: (fn: string) =>
      fn === "org_member_directory"
        ? [{ user_id: "u-admin", email: "admin@x.test", full_name: "Dana Recruiter" }]
        : fn === "set_applicant_note_pinned" ? (over.rpc ?? true) : null,
  });
  holder.client = rec.client;
  return rec;
}

/**
 * `user_profiles` is a person's own profile, read by their user id (`displayNameFor`): it has no
 * `org_id`, and the user id came from the verified session, not from the request.
 */
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

describe("who may read and write notes", () => {
  it("lets recruitment viewers read and refuses them a write; refuses outsiders before any query", async () => {
    seed();
    expect((await call(`/applicants/${DRIVER}/notes`, "auditor")).status).toBe(200);
    expect((await call(`/applicants/${DRIVER}/activity`, "auditor")).status).toBe(200);
    seed();
    const write = await call(`/applicants/${DRIVER}/notes`, "auditor", { method: "POST", body: JSON.stringify({ body: "x" }) });
    expect(write.status).toBe(403);
    for (const token of ["dispatcher", "driver"]) {
      seed();
      expect((await call(`/applicants/${DRIVER}/notes`, token)).status).toBe(403);
      expect((await call(`/applicants/${DRIVER}/activity`, token)).status).toBe(403);
      expect(rec.queries).toHaveLength(0);
    }
  });
});

describe("adding a note", () => {
  it("inserts it org-scoped, trimmed, under the session's name and the live application", async () => {
    seed();
    const res = await call(`/applicants/${DRIVER}/notes`, "recruiter", {
      method: "POST",
      body: JSON.stringify({ body: "  Called 10/30, sends the SSN card Monday  " }),
    });
    expect(res.status).toBe(201);
    expect(rec.writtenRows("applicant_notes")).toEqual([{
      org_id: ORG,
      driver_id: DRIVER,
      invitation_id: INV,
      body: "Called 10/30, sends the SSN card Monday",
      author_id: "u-recruiter",
      author_name: "Dana Recruiter",
    }]);
    // The audit says a note was written, never what it says.
    const audit = rec.writtenRows("audit_logs")[0]!;
    expect(audit.action).toBe("recruitment.applicant_note_added");
    expect(JSON.stringify(audit)).not.toContain("SSN card");
    expectOrgScoped(rec, ORG, PROFILE_EXEMPT);
  });

  it("refuses another carrier's applicant with a 404 and writes nothing", async () => {
    seed();
    const res = await call(`/applicants/${OTHER_DRIVER}/notes`, "recruiter", { method: "POST", body: JSON.stringify({ body: "hi" }) });
    expect(res.status).toBe(404);
    expect(rec.writtenRows("applicant_notes")).toEqual([]);
  });

  it("refuses a blank note before any query", async () => {
    seed();
    const res = await call(`/applicants/${DRIVER}/notes`, "recruiter", { method: "POST", body: JSON.stringify({ body: "   " }) });
    expect(res.status).toBe(400);
    expect(rec.writtenRows("applicant_notes")).toEqual([]);
  });
});

describe("listing and pinning", () => {
  it("lists this org's notes for this applicant, the pinned one first and then newest first", async () => {
    seed({
      notes: [
        { id: "n1", org_id: ORG, driver_id: DRIVER, body: "old", author_name: "A", pinned: false, created_at: "2026-10-01T10:00:00Z" },
        { id: "n2", org_id: ORG, driver_id: DRIVER, body: "new", author_name: "A", pinned: false, created_at: "2026-10-09T10:00:00Z" },
        { id: "n3", org_id: ORG, driver_id: DRIVER, body: "pinned", author_name: "A", pinned: true, created_at: "2026-10-05T10:00:00Z" },
        { id: "n4", org_id: OTHER_ORG, driver_id: DRIVER, body: "theirs", author_name: "B", pinned: false, created_at: "2026-10-10T10:00:00Z" },
      ],
    });
    const res = await call(`/applicants/${DRIVER}/notes`, "auditor");
    const { notes } = (await res.json()) as { notes: Array<{ id: string }> };
    expect(notes.map((n) => n.id)).toEqual(["n3", "n2", "n1"]);
    expectOrgScoped(rec, ORG);
  });

  it("pins through the RPC with the session's org, and refuses a note that is not this applicant's", async () => {
    seed();
    const ok = await call(`/applicants/${DRIVER}/notes/${NOTE_A}/pin`, "recruiter", { method: "POST", body: JSON.stringify({ pinned: true }) });
    expect(ok.status).toBe(200);
    expect(rec.rpcs().filter((r) => r.fn === "set_applicant_note_pinned")).toEqual([
      { fn: "set_applicant_note_pinned", args: { p_org: ORG, p_note: NOTE_A, p_pinned: true } },
    ]);
    expectOrgScoped(rec, ORG);

    seed();
    const theirs = await call(`/applicants/${OTHER_DRIVER}/notes/${NOTE_A}/pin`, "recruiter", { method: "POST", body: JSON.stringify({ pinned: true }) });
    expect(theirs.status).toBe(404);
    expect(rec.rpcs().filter((r) => r.fn === "set_applicant_note_pinned")).toEqual([]);
  });
});

describe("the activity list", () => {
  it("lists every kind for a fixture applicant, newest first, from the rows on file", async () => {
    seed();
    const res = await call(`/applicants/${DRIVER}/activity`, "auditor");
    expect(res.status).toBe(200);
    const { activity } = (await res.json()) as { activity: Array<{ at: string; kind: string; text: string; actor: string | null; edit?: unknown }> };

    const ats = activity.map((a) => a.at);
    expect(ats).toEqual([...ats].sort().reverse());
    const kinds = new Set(activity.map((a) => a.kind));
    // `invitation_withdrawn` and a failed text are absent only because this applicant's link is live
    // and their one text went: every other kind the contract names is here.
    expect([...APPLICANT_ACTIVITY_KINDS].filter((k) => !kinds.has(k))).toEqual(["invitation_withdrawn"]);

    const edit = activity.find((a) => a.kind === "answer_edited")!;
    expect(edit.actor).toBe("Dana Recruiter");
    expect(edit.edit).toEqual({ path: ["employers", JOB, "address_line1"], change: "filled", employer: "ABC Trucking" });
    // A STOP by text is said once — by the suppression row — not again by the consent it revoked.
    expect(activity.filter((a) => a.text.includes("STOP"))).toHaveLength(1);
    expect(activity.filter((a) => a.kind === "texts_stopped")).toHaveLength(1);
    // Another carrier's note never reaches this list.
    expect(activity.filter((a) => a.kind === "note_added").map((a) => a.at)).toEqual(["2026-10-15T10:00:00Z", "2026-10-01T09:00:00Z"]);
    expectOrgScoped(rec, ORG);
  });
});

describe("the board's last note", () => {
  it("reads the newest note per applicant in one org-scoped query", async () => {
    seed();
    const last = await readLastNotes(rec.client, ORG, [DRIVER]);
    expect(last.get(DRIVER)).toEqual({ created_at: "2026-10-15T10:00:00Z", author_name: "Dana Recruiter" });
    expect(rec.forTable("applicant_notes")).toHaveLength(1);
    expectOrgScoped(rec, ORG);
  });
});
