import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { STEP_UP_TOKEN_HEADER, mintStepUpToken } from "../../../lib/stepUpToken.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/chat/compliance` (OFFICE-CHAT-PLAN CHA2). The reads live in 0516 and are executed by
 * `supabase/tests/office-chat-compliance.test.mjs`; what this file holds the ROUTER to is the door:
 * nobody without the settings section and the `chat.compliance` grant gets in; no content without a
 * step-up token and a reason; the caller's org and user come from the token and never from the body;
 * every act that returned content also left an `audit_logs` row naming the category and reason; and
 * when that row cannot be written, the content is withheld. The chat's own `/api/chat` routes keep
 * answering beside it.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
const USER = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

let me: AuthContext = { userId: USER, email: "ana@example.test", orgId: ORG, role: "admin" };
let rpc: Record<string, unknown> = {};
let auditWriteError: unknown = null;

const REASON = { category: "hr", text: "Grievance case HR-2026-14, messages about the night shift" };
const member = (id: string, name: string, left: string | null = null) =>
  ({ user_id: id, name, role: "dispatcher", member_role: "member", joined_at: "2026-10-23T14:00:00Z", left_at: left });
const conversation = {
  thread_id: THREAD, kind: "group", subject: "Night dispatch", load_id: null, created_at: "2026-10-23T14:00:00Z",
  archived_at: null, last_message_at: "2026-10-23T15:00:00Z", message_count: 3, members: [member(USER, "Ana"), member(PEER, "Ben", "2026-10-24T09:00:00Z")],
};
const message = (seq: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, thread_id: THREAD, thread_kind: "group", thread_subject: "Night dispatch",
  seq, sender_user_id: PEER, sender_name: "Ben", body: `line ${seq}`, created_at: `2026-10-23T15:0${seq}:00Z`,
  edited_at: null, deleted_at: null, versions: [], ...over,
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
  me = { userId: USER, email: "ana@example.test", orgId: ORG, role: "admin" };
  auditWriteError = null;
  rpc = {
    org_module_enabled: true,
    org_member_directory: [
      { user_id: USER, email: "ana@example.test", full_name: "Ana", role: "admin", suspended_at: null },
      { user_id: PEER, email: "ben@example.test", full_name: null, role: "driver", suspended_at: "2026-10-01T00:00:00Z" },
    ],
    chat_compliance_conversations: [conversation],
    chat_compliance_messages: [message(3, { deleted_at: "2026-10-23T16:00:00Z" }), message(2, { versions: [{ version: 1, body: "old words", replaced_at: "2026-10-23T15:30:00Z", replaced_by: PEER }] }), message(1)],
    chat_compliance_thread: [{ conversation: { ...conversation, created_by: USER, last_seq: 3, message_count: undefined }, messages: [message(3), message(2), message(1)] }],
    chat_compliance_access_log: [
      { seq: 9, occurred_at: "2026-10-24T10:00:00Z", actor_user_id: USER, actor_name: "Ana", action: "compliance_search", thread_id: null, subject_user_id: PEER, subject_name: "Ben", detail: { scope: "messages", reason: REASON } },
    ],
  };
  holder.rec = createSupabaseRecorder({
    rpc: (fn) => rpc[fn],
    tables: { audit_logs: () => ({ data: [], writeError: auditWriteError }) },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const stepUp = () => ({ [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, me.userId, me.orgId!)!.token });
const call = (path: string, init: RequestInit = {}, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}/api/chat/compliance${path}`, {
    ...init,
    headers: { Authorization: "Bearer token", "Content-Type": "application/json", ...headers },
  });
const post = (path: string, body: unknown, headers: Record<string, string> = stepUp()) =>
  call(path, { method: "POST", body: JSON.stringify(body) }, headers);
const complianceCalls = () => holder.rec!.rpcs().filter((c) => c.fn.startsWith("chat_compliance_"));
const auditRows = () => holder.rec!.writtenRows("audit_logs");

describe("the door", () => {
  it("refuses a role without the settings section before any function runs, and a driver login", async () => {
    for (const role of ["dispatcher", "driver", "technician"] as const) {
      me = { ...me, role };
      expect((await call("/people")).status, role).toBe(403);
    }
    expect(complianceCalls()).toEqual([]);
    expect(holder.rec!.rpcs().some((c) => c.fn === "org_member_directory")).toBe(false);
  });

  it("admits the admin, who holds chat.compliance by default", async () => {
    expect((await call("/people")).status).toBe(200);
    expect((await call("/access-log")).status).toBe(200);
  });

  it("returns no content without a step-up token — the body's reason is not enough", async () => {
    for (const path of ["/conversations", "/messages", `/conversations/${THREAD}`]) {
      const res = await post(path, { reason: REASON }, {});
      expect(res.status, path).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("step_up_required");
    }
    expect(complianceCalls()).toEqual([]);
    expect(auditRows()).toEqual([]);
  });

  it("returns no content without a reason, or with a reason too short to mean anything", async () => {
    expect((await post("/messages", { q: "shift" })).status).toBe(400);
    expect((await post("/messages", { reason: { category: "hr", text: "short" } })).status).toBe(400);
    expect((await post("/messages", { reason: { category: "curiosity", text: REASON.text } })).status).toBe(400);
    expect(complianceCalls()).toEqual([]);
  });
});

describe("every act is the caller's, from the token, and leaves two records", () => {
  it("passes the token's org and user to every function and ignores any named in the body", async () => {
    await post("/conversations", { reason: REASON, person: PEER, org_id: OTHER_ORG, actor: PEER });
    await post("/messages", { reason: REASON, q: "night", thread: THREAD });
    await post(`/conversations/${THREAD}`, { reason: REASON });
    const calls = complianceCalls();
    expect(calls.map((c) => c.fn)).toEqual(["chat_compliance_conversations", "chat_compliance_messages", "chat_compliance_thread"]);
    for (const c of calls) {
      const args = c.args as Record<string, unknown>;
      expect(args.p_org, c.fn).toBe(ORG);
      expect(args.p_actor, c.fn).toBe(USER);
      expect(args.p_reason, c.fn).toEqual(REASON);
    }
    expectOrgScoped(holder.rec!, ORG);
  });

  it("writes an audit_logs row for each act, naming the category, the reason and what was asked", async () => {
    await post("/messages", { reason: REASON, q: "night", person: PEER });
    await post(`/conversations/${THREAD}`, { reason: REASON, before_seq: 40 });
    const rows = auditRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      org_id: ORG, actor_id: USER, action: "chat_compliance.search", entity: "message_threads", entity_id: null,
      meta: { category: "hr", reason: REASON.text, scope: "messages", q: "night", person: PEER },
    });
    expect(rows[1]).toMatchObject({ action: "chat_compliance.view", entity_id: THREAD, meta: { category: "hr", before_seq: 40 } });
  });

  it("withholds the content when the audit row cannot be written", async () => {
    auditWriteError = { message: "audit_logs unavailable" };
    const res = await post("/messages", { reason: REASON });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string }; messages?: unknown };
    expect(body.error.code).toBe("audit_unavailable");
    expect(body.messages).toBeUndefined();
  });

  it("writes no audit row for a refused act", async () => {
    rpc.chat_compliance_thread = { error: { code: "CH001", message: "not in that conversation" } };
    const res = await post(`/conversations/${THREAD}`, { reason: REASON });
    expect(res.status).toBe(404);
    expect(auditRows()).toEqual([]);
  });
});

describe("what comes back", () => {
  it("lists the people the console may filter by — drivers and suspended members included, named", async () => {
    const body = (await (await call("/people")).json()) as { people: Array<{ user_id: string; name: string | null; role: string; suspended: boolean }> };
    expect(body.people).toEqual([
      { user_id: USER, name: "Ana", role: "admin", suspended: false },
      { user_id: PEER, name: "ben", role: "driver", suspended: true },
    ]);
  });

  it("returns messages with their retraction and their earlier versions, and a cursor only when the page is full", async () => {
    const res = await post("/messages", { reason: REASON, limit: 3 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: Array<{ seq: number; deleted_at: string | null; versions: unknown[] }>; next: unknown };
    expect(body.messages.map((m) => m.seq)).toEqual([3, 2, 1]);
    expect(body.messages[0]!.deleted_at).not.toBeNull();
    expect(body.messages[1]!.versions).toHaveLength(1);
    expect(body.next).toEqual({ before_at: "2026-10-23T15:01:00Z", before_id: message(1).id });
    const args = complianceCalls()[0]!.args as Record<string, unknown>;
    expect(args.p_limit).toBe(3);
  });

  it("opens a conversation oldest first, with everyone who was ever in it", async () => {
    const res = await post(`/conversations/${THREAD}`, { reason: REASON });
    const body = (await res.json()) as { conversation: { members: Array<{ left_at: string | null }> }; messages: Array<{ seq: number }>; before_seq: number | null };
    expect(body.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(body.conversation.members.some((m) => m.left_at)).toBe(true);
    expect(body.before_seq).toBeNull();
  });

  it("is a 404 for a conversation id that is not a uuid, without asking the database", async () => {
    expect((await post("/conversations/not-a-uuid", { reason: REASON })).status).toBe(404);
    expect(complianceCalls()).toEqual([]);
  });

  it("pages the access log by seq and needs no step-up for it", async () => {
    const res = await call("/access-log?before_seq=50&limit=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ seq: number }>; before_seq: number | null };
    expect(body.rows[0]!.seq).toBe(9);
    expect(body.before_seq).toBe(9);
    const args = complianceCalls()[0]!.args as Record<string, unknown>;
    expect(args).toEqual({ p_org: ORG, p_before_seq: 50, p_limit: 1 });
  });

  it("leaves the chat's own routes answering beside it", async () => {
    rpc.chat_inbox = [];
    me = { ...me, role: "dispatcher" };
    const res = await fetch(`${baseUrl}/api/chat`, { headers: { Authorization: "Bearer token" } });
    expect(res.status).toBe(200);
  });
});
