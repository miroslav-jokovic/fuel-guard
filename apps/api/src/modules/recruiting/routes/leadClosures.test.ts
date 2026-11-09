import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";

/**
 * The recruiter's verdict doors (LQ5b over 0578): `POST /leads/:id/close|qualify|reopen` and
 * `GET /leads/:id/closures`. What the functions decide — the evidence each reason needs, the status moves,
 * idempotency — is the PGlite matrix `recruiting-lead-closures.test.mjs`; this file holds what the API adds:
 * the doors and their roles, the body held to the fixed reason list, every RL refusal as a status and the
 * function's own words, the audit row without the note, and the read-back order.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LEAD = "50000000-0000-4000-8000-000000000001";
const PURGED = "50000000-0000-4000-8000-000000000005";
const CLOSURE = "90000000-0000-4000-8000-000000000001";

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = Object.fromEntries(["admin", "recruiter", "auditor", "dispatcher"].map((r) => [r, ctx(r)]));

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;
/** What the next function call answers: a row, or an RL refusal as PostgREST reports it. */
const next: { answer?: Record<string, unknown>; error?: { code: string; message: string } } = {};
const closureRows: Array<Record<string, unknown>> = [];

const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/recruitment${path}`, { ...init, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } });
const post = (path: string, token: string, body: unknown = {}) => call(path, token, { method: "POST", body: JSON.stringify(body) });

function setup(): SupabaseRecorder {
  rec = createSupabaseRecorder({
    tables: {
      // The recorder does not filter; the lead read is by id, so the fake honours that one filter.
      recruiting_leads: postgrestFixture([
        { id: LEAD, org_id: ORG, status: "contacted", purged_at: null },
        { id: PURGED, org_id: ORG, status: "lost", purged_at: "2026-11-01T00:00:00Z" },
      ]),
      recruiting_lead_closures: () => ({ data: closureRows }),
      user_profiles: [{ full_name: "Dana Recruiter" }],
      audit_logs: [],
    },
    rpc: () => (next.error ? { error: next.error } : (next.answer ?? null)),
  });
  holder.client = rec.client;
  return rec;
}
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
beforeEach(() => {
  delete next.answer;
  delete next.error;
  closureRows.length = 0;
  setup();
});

const audits = () => rec.queries.filter((q) => q.table === "audit_logs" && q.write?.method === "insert").map((q) => q.write!.payload as Record<string, unknown>);

describe("closing a lead", () => {
  it("calls close_lead in the session's name, answers the function's result, and audits the reason without the note", async () => {
    next.answer = { lead_id: LEAD, closed: true, already: false, closure_id: CLOSURE, status: "not_qualified", verdict_written: true };
    const res = await post(`/leads/${LEAD}/close`, "recruiter", { reason: "not_qualified:class_a", note: "  drives a straight truck  " });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ kind: "done", closure_id: CLOSURE, status: "not_qualified", already: false, verdict_written: true });
    const [rpc] = rec.rpcs();
    expect(rpc).toEqual({ fn: "close_lead", args: {
      p_org: ORG, p_lead: LEAD, p_reason: "not_qualified:class_a", p_note: "drives a straight truck", p_actor: "u-recruiter", p_actor_name: "Dana Recruiter",
    } });
    const audit = audits()[0]!;
    expect(audit.action).toBe("recruitment.lead_closed");
    expect(audit.meta).toEqual({ closureId: CLOSURE, status: "not_qualified", reason: "not_qualified:class_a", verdictWritten: true });
    expect(JSON.stringify(audit)).not.toContain("straight truck");
    expectOrgScoped(rec, ORG, PROFILE_EXEMPT);
  });

  it("an already-closed lead answers 200 with already, and writes no audit row", async () => {
    next.answer = { lead_id: LEAD, closed: false, already: true, status: "lost", verdict_written: false };
    const res = await post(`/leads/${LEAD}/close`, "recruiter", { reason: "spam" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { already: boolean }).already).toBe(true);
    expect(audits()).toHaveLength(0);
  });

  it("holds the body to the fixed reason list: an unlisted reason never reaches the database", async () => {
    const res = await post(`/leads/${LEAD}/close`, "recruiter", { reason: "ghosted" });
    expect(res.status).toBe(400);
    expect(rec.rpcs()).toHaveLength(0);
    expect((await post(`/leads/${LEAD}/close`, "recruiter", { reason: "not_qualified:home_time" })).status).toBe(400);
    expect((await post(`/leads/${LEAD}/close`, "recruiter", {})).status).toBe(400);
  });

  it.each([
    ["RL055", "close_lead: not_interested needs a call with outcome reached on record — log the call first", 409, "needs_contact", "not_interested needs a call with outcome reached on record — log the call first"],
    ["RL056", "close_lead: unreachable needs 3 outbound attempts with no answer on record; 2 recorded", 409, "needs_attempts", "unreachable needs 3 outbound attempts with no answer on record; 2 recorded"],
    ["RL057", "close_lead: duplicate needs another lead of the same person; none shares this phone or e-mail", 409, "needs_duplicate", "duplicate needs another lead of the same person; none shares this phone or e-mail"],
    ["RL052", "close_lead: this lead's details were deleted, so nothing more can be recorded on it", 409, "lead_purged", "this lead's details were deleted, so nothing more can be recorded on it"],
    ["RL053", "close_lead: this lead became an applicant; record the outcome on the applicant", 409, "lead_converted", "this lead became an applicant; record the outcome on the applicant"],
    ["RL051", "close_lead: lead x is not this carrier's", 404, "not_found", "Lead not found"],
  ])("relays the database's refusal %s as %i %s in the function's own words", async (code, message, status, apiCode, words) => {
    next.error = { code, message };
    const res = await post(`/leads/${LEAD}/close`, "recruiter", { reason: "not_interested" });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error: { code: apiCode, message: words } });
    expect(audits()).toHaveLength(0);
  });

  it("a failure that is not a refusal is a 500, not a silent 200", async () => {
    next.error = { code: "42P01", message: "relation does not exist" };
    expect((await post(`/leads/${LEAD}/close`, "recruiter", { reason: "spam" })).status).toBe(500);
  });

  it("is closed to a view-only role and to roles outside recruiting; a malformed id is not found", async () => {
    expect((await post(`/leads/${LEAD}/close`, "auditor", { reason: "spam" })).status).toBe(403);
    expect((await post(`/leads/${LEAD}/close`, "dispatcher", { reason: "spam" })).status).toBe(403);
    expect((await post(`/leads/not-an-id/close`, "recruiter", { reason: "spam" })).status).toBe(404);
    expect(rec.rpcs()).toHaveLength(0);
  });
});

describe("qualifying and reopening", () => {
  it("qualify calls qualify_lead with the note and audits as qualified", async () => {
    next.answer = { lead_id: LEAD, qualified: true, already: false, closure_id: CLOSURE, status: "qualified" };
    const res = await post(`/leads/${LEAD}/qualify`, "recruiter", { note: "good fit, wants regional" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ kind: "done", closure_id: CLOSURE, status: "qualified", already: false, verdict_written: false });
    expect(rec.rpcs()[0]).toEqual({ fn: "qualify_lead", args: { p_org: ORG, p_lead: LEAD, p_note: "good fit, wants regional", p_actor: "u-recruiter", p_actor_name: "Dana Recruiter" } });
    const audit = audits()[0]!;
    expect(audit.action).toBe("recruitment.lead_qualified");
    expect(audit.meta).toEqual({ closureId: CLOSURE, status: "qualified" });
    expect(JSON.stringify(audit)).not.toContain("regional");
  });

  it("qualify on a closed lead relays RL058 as 409 lead_closed", async () => {
    next.error = { code: "RL058", message: "qualify_lead: this lead is closed; reopen it first" };
    const res = await post(`/leads/${LEAD}/qualify`, "recruiter");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "lead_closed", message: "this lead is closed; reopen it first" } });
  });

  it("reopen calls reopen_lead, answers the status the lead came back as, and audits as reopened", async () => {
    next.answer = { lead_id: LEAD, reopened: true, closure_id: CLOSURE, status: "new" };
    const res = await post(`/leads/${LEAD}/reopen`, "recruiter");
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ kind: "done", closure_id: CLOSURE, status: "new", already: false, verdict_written: false });
    expect(rec.rpcs()[0]).toMatchObject({ fn: "reopen_lead", args: { p_org: ORG, p_lead: LEAD, p_note: null } });
    expect(audits()[0]?.action).toBe("recruitment.lead_reopened");
  });

  it("reopen on an open lead relays RL059 as 409 not_closed", async () => {
    next.error = { code: "RL059", message: "reopen_lead: this lead is not closed (it is contacted)" };
    const res = await post(`/leads/${LEAD}/reopen`, "recruiter");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "not_closed", message: "this lead is not closed (it is contacted)" } });
  });

  it("a note over 2,000 characters is refused before the database", async () => {
    expect((await post(`/leads/${LEAD}/qualify`, "recruiter", { note: "x".repeat(2001) })).status).toBe(400);
    expect(rec.rpcs()).toHaveLength(0);
  });
});

describe("reading a lead's acts", () => {
  it("answers them newest first by seq, scoped to the carrier, for anyone who can view recruiting", async () => {
    closureRows.push(
      { id: "c2", kind: "reopened", reason: null, status_after: "contacted", note: null, actor_name: "Dana", recorded_at: "2026-11-09T12:00:00Z" },
      { id: "c1", kind: "closed", reason: "spam", status_after: "lost", note: "n", actor_name: "Dana", recorded_at: "2026-11-09T11:00:00Z" },
    );
    const res = await call(`/leads/${LEAD}/closures`, "auditor");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { closures: Array<{ id: string; note_withheld: boolean }> };
    expect(body.closures.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(body.closures.every((c) => c.note_withheld === false)).toBe(true);
    const q = rec.queries.find((x) => x.table === "recruiting_lead_closures")!;
    expect(q.ops.some((o) => o.method === "order" && o.args[0] === "seq")).toBe(true);
    expectOrgScoped(rec, ORG, PROFILE_EXEMPT);
  });

  it("on a purged lead every act says its note was removed", async () => {
    closureRows.push({ id: "c1", kind: "closed", reason: "spam", status_after: "lost", note: null, actor_name: "Dana", recorded_at: "2026-11-01T00:00:00Z" });
    const body = (await (await call(`/leads/${PURGED}/closures`, "recruiter")).json()) as { closures: Array<{ note_withheld: boolean }> };
    expect(body.closures[0]!.note_withheld).toBe(true);
  });

  it("another carrier's lead, a malformed id and an outside role are refused", async () => {
    expect((await call(`/leads/50000000-0000-4000-8000-0000000000ff/closures`, "recruiter")).status).toBe(404);
    expect((await call(`/leads/not-an-id/closures`, "recruiter")).status).toBe(404);
    expect((await call(`/leads/${LEAD}/closures`, "dispatcher")).status).toBe(403);
  });
});
