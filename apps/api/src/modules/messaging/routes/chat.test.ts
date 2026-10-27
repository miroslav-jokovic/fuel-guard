import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/chat` (OFFICE-CHAT-PLAN CH1b). The rules live in 0512 and are executed by
 * `supabase/tests/office-chat.test.mjs`; what this file holds the ROUTER to is everything between the
 * token and the function: that every call carries the caller's org and user from the token and never
 * from the request, that a driver login is refused before any function runs, that each SQLSTATE becomes
 * its answer, that a malformed id is a 404 rather than a database error, and that a new message — and
 * only a new message — counts against the office budget.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
const USER = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";
const MSG = "44444444-4444-4444-8444-444444444444";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

let me: AuthContext = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
let rpc: Record<string, unknown> = {};

const conversation = (over: Record<string, unknown> = {}) => ({
  thread_id: THREAD, kind: "direct", subject: null, load_id: null,
  created_at: "2026-10-23T14:00:00Z", last_message_at: "2026-10-23T15:00:00Z",
  last_seq: 3, rev: 4, read_seq: 1, unread: 2, muted: "none", member_role: "member", member_count: 2,
  title_members: [{ user_id: PEER, name: "Ben Admin" }],
  last_message: { id: MSG, seq: 3, sender_user_id: PEER, sender_name: "Ben Admin", body: "Approved.", created_at: "2026-10-23T15:00:00Z", deleted: false },
  ...over,
});
const message = (seq: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, thread_id: THREAD, seq, rev: seq,
  sender_user_id: PEER, sender_name: "Ben Admin", body: `line ${seq}`,
  created_at: "2026-10-23T15:00:00Z", edited_at: null, deleted_at: null, ...over,
});

let server: Server;
let baseUrl = "";
beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => me;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

beforeEach(() => {
  me = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
  rpc = {
    org_module_enabled: true,
    bump_driver_write_counter: [{ allowed: true }],
    chat_inbox: [conversation()],
    chat_people: [{ user_id: PEER, name: "Ben Admin", role: "admin" }],
    chat_members: [
      { user_id: USER, name: "Ana", member_role: "member", read_seq: 1, last_read_at: null, joined_at: "2026-10-23T14:00:00Z" },
      { user_id: PEER, name: "Ben Admin", member_role: "member", read_seq: 3, last_read_at: null, joined_at: "2026-10-23T14:00:00Z" },
    ],
    chat_history: [message(3), message(2), message(1)],
    chat_sync: [message(2, { rev: 5, body: "edited" })],
    chat_send: [{ message_id: MSG, seq: 4, rev: 5, created_at: "2026-10-23T15:01:00Z", duplicate: false }],
    chat_open_direct: THREAD,
    chat_create_group: THREAD,
    chat_edit: 6,
    chat_retract: 7,
    chat_mark_read: 3,
  };
  holder.rec = createSupabaseRecorder({ rpc: (fn) => rpc[fn] });
});

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/chat${path}`, {
    ...init,
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
  });
const post = (path: string, body: unknown, method = "POST") => call(path, { method, body: JSON.stringify(body) });
const chatCalls = () => holder.rec!.rpcs().filter((c) => c.fn.startsWith("chat_"));

describe("who reaches /api/chat", () => {
  it("refuses a driver login before any chat function runs — drivers talk to dispatch on /api/messages", async () => {
    me = { ...me, role: "driver" };
    const res = await call("");
    expect(res.status).toBe(403);
    expect(chatCalls()).toEqual([]);
  });

  it("admits every office role, a technician and an accountant as much as an admin", async () => {
    for (const role of ["technician", "accountant", "admin", "recruiter"] as const) {
      me = { ...me, role };
      expect((await call("")).status).toBe(200);
    }
  });
});

describe("every call is the caller's, from the token", () => {
  it("passes the token's org and user to every function, and reads no table directly", async () => {
    await call("");
    await call(`/${THREAD}`);
    await call(`/${THREAD}/sync?since_rev=4`);
    await post(`/${THREAD}/messages`, { message_id: MSG, body: "On it." });
    await post(`/${THREAD}/read`, { seq: 3 });
    const calls = chatCalls();
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const c of calls) {
      const args = c.args as Record<string, unknown>;
      expect(args.p_org, c.fn).toBe(ORG);
      // Who a line's bell tells (0521) is asked of the line itself, which the send just wrote as the caller.
      if (c.fn === "chat_notify_targets") expect(args.p_message).toBe(MSG);
      else expect(args.p_user ?? args.p_actor, c.fn).toBe(USER);
    }
    // The only table reads are the screen gate's own (`requireSurface("chat")` reads the org's surface
    // answers), and every one is org-scoped; the chat code itself reads no table at all.
    expectOrgScoped(holder.rec!, ORG);
    const tables = new Set(holder.rec!.queries.filter((q) => !q.table.startsWith("rpc:")).map((q) => q.table));
    expect([...tables].sort()).toEqual(["org_role_surface_access", "user_surface_access"]);
  });

  it("ignores an org or a user named in the body", async () => {
    await post(`/${THREAD}/messages`, { message_id: MSG, body: "x", org_id: OTHER_ORG, sender_user_id: PEER });
    const send = holder.rec!.rpcs().find((c) => c.fn === "chat_send")!.args as Record<string, unknown>;
    expect(send.p_org).toBe(ORG);
    expect(send.p_actor).toBe(USER);
  });

  it("asks the inbox for office conversations only — driver threads stay on /api/messages", async () => {
    await call("");
    const inbox = holder.rec!.rpcs().find((c) => c.fn === "chat_inbox")!.args as Record<string, unknown>;
    expect(inbox.p_kinds).toEqual(["direct", "group", "channel"]);
  });
});

describe("the inbox", () => {
  it("returns the conversations, their unread total, and no next page when the page is short", async () => {
    const body = (await (await call("")).json()) as { conversations: unknown[]; unread_total: number; next: unknown };
    expect(body.conversations).toHaveLength(1);
    expect(body.unread_total).toBe(2);
    expect(body.next).toBeNull();
  });

  it("does not count a fully muted conversation in the badge", async () => {
    rpc.chat_inbox = [conversation({ muted: "all", unread: 9 }), conversation({ thread_id: PEER, unread: 1 })];
    const body = (await (await call("")).json()) as { unread_total: number };
    expect(body.unread_total).toBe(1);
  });

  it("hands back the cursor of the last row when the page is full", async () => {
    rpc.chat_inbox = [conversation()];
    const body = (await (await call("?limit=1")).json()) as { next: { before_at: string; before_id: string } };
    expect(body.next).toEqual({ before_at: "2026-10-23T15:00:00Z", before_id: THREAD });
  });

  it("narrows to the kinds asked for — the Chats list leaves channels to the Teams rail — and refuses an unknown kind", async () => {
    await call("?kinds=direct,group");
    expect((holder.rec!.rpcs().find((c) => c.fn === "chat_inbox")!.args as { p_kinds: string[] }).p_kinds).toEqual(["direct", "group"]);
    expect((await call("?kinds=direct,driver")).status).toBe(400);
    expect(chatCalls()).toHaveLength(1);
  });

  it("refuses half a cursor", async () => {
    expect((await call("?before_at=2026-10-23T15:00:00Z")).status).toBe(400);
    expect(chatCalls()).toEqual([]);
  });
});

describe("a conversation", () => {
  it("opens with its header, members and newest page, oldest first, with a cursor only when there is more", async () => {
    const body = (await (await call(`/${THREAD}`)).json()) as { messages: Array<{ seq: number }>; before_seq: number | null; members: unknown[] };
    expect(body.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(body.members).toHaveLength(2);
    expect(body.before_seq).toBeNull();
  });

  it("is a 404 when the caller is not in it — the inbox row is missing, so nothing else is read", async () => {
    rpc.chat_inbox = [];
    expect((await call(`/${THREAD}`)).status).toBe(404);
    expect(chatCalls().map((c) => c.fn)).toEqual(["chat_inbox"]);
  });

  it("is a 404 for an id that is not a uuid, without asking the database", async () => {
    expect((await call("/not-a-uuid")).status).toBe(404);
    expect(chatCalls()).toEqual([]);
  });

  it("lists its people, as the caller sees them, and is a 404 when the caller is not in it", async () => {
    const body = (await (await call(`/${THREAD}/members`)).json()) as { members: Array<{ user_id: string }> };
    expect(body.members.map((m) => m.user_id)).toEqual([USER, PEER]);
    expect(holder.rec!.rpcs().find((c) => c.fn === "chat_members")!.args).toEqual({ p_org: ORG, p_user: USER, p_thread: THREAD });
    rpc.chat_members = { error: { code: "CH001", message: "" } };
    expect((await call(`/${THREAD}/members`)).status).toBe(404);
  });

  it("syncs from the rev asked for and returns the new rev", async () => {
    const body = (await (await call(`/${THREAD}/sync?since_rev=4`)).json()) as { rev: number; changes: unknown[]; more: boolean };
    expect((holder.rec!.rpcs().find((c) => c.fn === "chat_sync")!.args as { p_since_rev: number }).p_since_rev).toBe(4);
    expect(body).toMatchObject({ rev: 5, more: false });
  });
});

describe("refusals from the database become answers", () => {
  it.each([
    ["CH001", 404, "not_found"],
    ["CH002", 422, "not_an_office_member"],
    ["CH005", 409, "conversation_archived"],
    ["CH006", 422, "not_allowed_here"],
    ["CH007", 409, "id_in_use"],
    ["CH008", 403, "owner_only"],
  ])("%s → %i %s", async (sqlstate, status, code) => {
    rpc.chat_send = { error: { code: sqlstate, message: "refused" } };
    const res = await post(`/${THREAD}/messages`, { message_id: MSG, body: "x" });
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
  });

  it("an unknown database error is a fault, not an answer", async () => {
    rpc.chat_send = { error: { code: "XX000", message: "boom" } };
    expect((await post(`/${THREAD}/messages`, { message_id: MSG, body: "x" })).status).toBe(500);
  });
});

describe("writing", () => {
  it("answers 201 for a new message and 200 for a retry the database recognised", async () => {
    expect((await post(`/${THREAD}/messages`, { message_id: MSG, body: "x" })).status).toBe(201);
    rpc.chat_send = [{ message_id: MSG, seq: 4, rev: 5, created_at: "2026-10-23T15:01:00Z", duplicate: true }];
    expect((await post(`/${THREAD}/messages`, { message_id: MSG, body: "x" })).status).toBe(200);
  });

  it("refuses an empty message before it reaches the database", async () => {
    expect((await post(`/${THREAD}/messages`, { message_id: MSG, body: "   " })).status).toBe(400);
    expect(chatCalls()).toEqual([]);
  });

  it("counts a new message against the office budget, and opening a conversation against nothing", async () => {
    await post(`/${THREAD}/messages`, { message_id: MSG, body: "x" });
    await post("/direct", { thread_id: THREAD, user_id: PEER });
    const bumps = holder.rec!.rpcs().filter((c) => c.fn === "bump_driver_write_counter");
    expect(bumps.map((b) => (b.args as { p_bucket: string }).p_bucket)).toEqual(["chat_message"]);
    expect((bumps[0]!.args as { p_limit: number }).p_limit).toBe(3000);
  });

  it("stops at the office day's maximum", async () => {
    rpc.bump_driver_write_counter = [{ allowed: false }];
    const res = await post(`/${THREAD}/messages`, { message_id: MSG, body: "x" });
    expect(res.status).toBe(429);
    expect(holder.rec!.rpcs().some((c) => c.fn === "chat_send")).toBe(false);
  });

  it("opens a direct conversation with the person named, and creates a group with the people named", async () => {
    expect(await (await post("/direct", { thread_id: THREAD, user_id: PEER })).json()).toEqual({ thread_id: THREAD });
    const res = await post("/groups", { thread_id: THREAD, subject: "Night dispatch", member_ids: [PEER] });
    expect(res.status).toBe(201);
    expect(holder.rec!.rpcs().find((c) => c.fn === "chat_create_group")!.args).toMatchObject({ p_members: [PEER], p_subject: "Night dispatch" });
  });

  it("edits and retracts by message id", async () => {
    expect(await (await post(`/messages/${MSG}`, { body: "fixed" }, "PATCH")).json()).toEqual({ rev: 6 });
    expect(await (await call(`/messages/${MSG}`, { method: "DELETE" })).json()).toEqual({ rev: 7 });
  });

  it("leaving is removing yourself; removing somebody names them", async () => {
    rpc.chat_leave = null;
    await post(`/${THREAD}/leave`, {});
    await call(`/${THREAD}/members/${PEER}`, { method: "DELETE" });
    const leaves = holder.rec!.rpcs().filter((c) => c.fn === "chat_leave").map((c) => (c.args as { p_user: string | null }).p_user);
    expect(leaves).toEqual([null, PEER]);
  });
});
