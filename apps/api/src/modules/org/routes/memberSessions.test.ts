import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { mintStepUpToken, STEP_UP_TOKEN_HEADER } from "../../../lib/stepUpToken.js";

/**
 * Signed-in devices (INSTALLED-APP-PLAN IA-S3). What a session is, whose it is and that ending one ends only
 * that one is 0615's, executed by `supabase/tests/member-sessions.test.mjs`. These routes are held to what
 * reaches it and what leaves: the person and the company from the token, never the path's say-so; a device
 * named as a browser would name itself and nothing of the raw user agent beyond that; the session the request
 * is signed in with marked and never ended; an admin's reach limited to their own company, and an end of a
 * colleague's device behind the password again and in the audit log.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ME = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const STRANGER = "99999999-9999-4999-8999-999999999999";
const THIS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PHONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TRUCK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const forgetMembership = vi.hoisted(() => vi.fn());
vi.mock("../../../middleware/membershipCurrent.js", async (orig) => ({ ...(await orig<typeof import("../../../middleware/membershipCurrent.js")>()), forgetMembership }));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
let me: AuthContext;
let rpc: Record<string, unknown>;
let members: Record<string, string>;
let base = "";
let server: Server;

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => me;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

const ROWS = [
  { id: PHONE, created_at: "2026-11-10T09:00:00+00:00", last_used_at: "2026-11-15T18:30:00+00:00", user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1", ip: "198.51.100.24", expires_at: null },
  { id: THIS, created_at: "2026-11-01T14:00:00+00:00", last_used_at: "2026-11-15T16:00:00+00:00", user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36", ip: "203.0.113.7", expires_at: null },
  { id: TRUCK, created_at: "2026-09-02T09:00:00+00:00", last_used_at: null, user_agent: "okhttp/4.12.0", ip: null, expires_at: null },
];

beforeEach(() => {
  me = { userId: ME, email: "ana@example.test", orgId: ORG, role: "dispatcher", sessionId: THIS };
  members = { [ME]: "dispatcher", [BEN]: "dispatcher" };
  rpc = { member_sessions: ROWS, member_session_end: 1 };
  holder.rec = createSupabaseRecorder({
    rpc: (fn, args) => (typeof rpc[fn] === "function" ? (rpc[fn] as (f: string, a: unknown) => unknown)(fn, args) : rpc[fn]),
    tables: {
      memberships: (q: { filters: () => Array<{ col: string; val: unknown }> }) => {
        const id = q.filters().find((f) => f.col === "user_id")?.val as string | undefined;
        return id && members[id] ? [{ role: members[id], suspended_at: null }] : [];
      },
      audit_logs: [],
    } as never,
  });
});

const call = (path: string, method = "GET", headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method, headers: { Authorization: "Bearer token", ...headers } });
const calls = (fn: string) => holder.rec!.rpcs().filter((c) => c.fn === fn).map((c) => c.args as Record<string, unknown>);
const audits = () => holder.rec!.forTable("audit_logs").filter((q) => q.write).map((q) => q.write!.payload as Record<string, unknown>);

describe("GET /api/me/sessions — a person's own devices", () => {
  it("lists the caller's sessions as devices, naming each as a browser would and marking the one in use", async () => {
    const res = await call("/api/me/sessions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessions: [
        { id: PHONE, device: "Safari on iPhone", created_at: ROWS[0]!.created_at, last_used_at: ROWS[0]!.last_used_at, ip: "198.51.100.24", current: false },
        { id: THIS, device: "Chrome on Windows", created_at: ROWS[1]!.created_at, last_used_at: ROWS[1]!.last_used_at, ip: "203.0.113.7", current: true },
        // Not a browser (the driver app's HTTP client): its own name; never used since: last used when created.
        { id: TRUCK, device: "okhttp/4.12.0", created_at: ROWS[2]!.created_at, last_used_at: ROWS[2]!.created_at, ip: null, current: false },
      ],
    });
    expect(calls("member_sessions")).toEqual([{ p_org: ORG, p_user: ME }]);
  });

  it("is the caller's list whoever the address tries to name", async () => {
    expect((await call(`/api/me/sessions?user_id=${BEN}&userId=${BEN}`)).status).toBe(200);
    expect(calls("member_sessions")).toEqual([{ p_org: ORG, p_user: ME }]);
  });

  it("marks none as in use when the token does not say which session it is", async () => {
    me = { ...me, sessionId: null };
    const body = (await (await call("/api/me/sessions")).json()) as { sessions: Array<{ current: boolean }> };
    expect(body.sessions.map((s) => s.current)).toEqual([false, false, false]);
  });

  it("is every signed-in member's — a driver's too — but not somebody with no company", async () => {
    me = { ...me, role: "driver" };
    expect((await call("/api/me/sessions")).status).toBe(200);
    me = { ...me, orgId: null, role: null };
    expect((await call("/api/me/sessions")).status).toBe(403);
    expect(calls("member_sessions")).toHaveLength(1);
  });
});

describe("DELETE /api/me/sessions/:id — end one of my own", () => {
  it("ends the caller's session, whoever the path might hope to name, and records which device it was", async () => {
    const res = await call(`/api/me/sessions/${PHONE}?user_id=${BEN}`, "DELETE");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ended: true });
    expect(calls("member_session_end")).toEqual([{ p_org: ORG, p_user: ME, p_session: PHONE }]);
    expect(audits()).toEqual([
      expect.objectContaining({ org_id: ORG, actor_id: ME, action: "session.ended", entity: "member", entity_id: ME, meta: { sessionId: PHONE, device: "Safari on iPhone", lastUsedAt: ROWS[0]!.last_used_at } }),
    ]);
  });

  it("makes this server forget what it knew of the person's sessions, so the ended device is refused at once (Q-IA10)", async () => {
    await call(`/api/me/sessions/${PHONE}`, "DELETE");
    expect(forgetMembership).toHaveBeenCalledWith(ME);
  });

  it("needs no second password for one's own device", async () => {
    expect((await call(`/api/me/sessions/${PHONE}`, "DELETE")).status).toBe(200);
  });

  it("refuses the device in use — that is Sign out — and ends nothing", async () => {
    const res = await call(`/api/me/sessions/${THIS.toUpperCase()}`, "DELETE");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("current_session");
    expect(calls("member_session_end")).toEqual([]);
    expect(audits()).toEqual([]);
  });

  it("answers 404, with no audit row, for a device that is already gone or is not theirs", async () => {
    rpc.member_session_end = 0;
    expect((await call(`/api/me/sessions/${PHONE}`, "DELETE")).status).toBe(404);
    expect(audits()).toEqual([]);
  });

  it("never asks the database about something that is not a session id", async () => {
    expect((await call("/api/me/sessions/everything", "DELETE")).status).toBe(400);
    expect(calls("member_session_end")).toEqual([]);
  });
});

describe("/api/members/:userId/sessions — an admin, for anybody in their company", () => {
  beforeEach(() => { me = { ...me, role: "admin" }; members[ME] = "admin"; });

  it("lists a member's devices, marking none as the admin's own", async () => {
    const body = (await (await call(`/api/members/${BEN}/sessions`)).json()) as { sessions: Array<{ id: string; current: boolean }> };
    expect(calls("member_sessions")).toEqual([{ p_org: ORG, p_user: BEN }]);
    // THIS is the admin's session id; Ben's list happens to hold the same id only in this fixture — the
    // marking is by id, so an admin looking at their OWN row on the Users page sees it marked.
    expect(body.sessions.map((s) => s.id)).toEqual([PHONE, THIS, TRUCK]);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("is the admin's alone", async () => {
    for (const role of ["dispatcher", "fleet_manager", "driver"] as const) {
      me = { ...me, role };
      expect((await call(`/api/members/${BEN}/sessions`)).status, role).toBe(403);
      expect((await call(`/api/members/${BEN}/sessions/${PHONE}`, "DELETE")).status, role).toBe(403);
    }
    expect(calls("member_sessions")).toEqual([]);
    expect(calls("member_session_end")).toEqual([]);
  });

  it("answers 404 for somebody who is not of the admin's company, before any session is read", async () => {
    expect((await call(`/api/members/${STRANGER}/sessions`)).status).toBe(404);
    expect((await call("/api/members/not-an-id/sessions")).status).toBe(404);
    expect(calls("member_sessions")).toEqual([]);
  });

  it("will not end a colleague's device without the password again", async () => {
    const res = await call(`/api/members/${BEN}/sessions/${PHONE}`, "DELETE");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("step_up_required");
    expect(calls("member_session_end")).toEqual([]);
    expect(audits()).toEqual([]);
  });

  const confirmed = () => ({ [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, ME, ORG)!.token });

  it("ends a colleague's device once the admin has confirmed it is them, and records who ended whose", async () => {
    const res = await call(`/api/members/${BEN}/sessions/${PHONE}`, "DELETE", confirmed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ended: true });
    expect(calls("member_session_end")).toEqual([{ p_org: ORG, p_user: BEN, p_session: PHONE }]);
    expect(audits()).toEqual([
      expect.objectContaining({ org_id: ORG, actor_id: ME, action: "member.session_ended", entity: "member", entity_id: BEN, meta: expect.objectContaining({ sessionId: PHONE, device: "Safari on iPhone" }) }),
    ]);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("will not end somebody's device in another company, even confirmed", async () => {
    expect((await call(`/api/members/${STRANGER}/sessions/${PHONE}`, "DELETE", confirmed())).status).toBe(404);
    expect(calls("member_session_end")).toEqual([]);
  });

  it("refuses the admin's own device in use through this door too", async () => {
    expect((await call(`/api/members/${ME}/sessions/${THIS}`, "DELETE", confirmed())).status).toBe(409);
    expect(calls("member_session_end")).toEqual([]);
  });
});
