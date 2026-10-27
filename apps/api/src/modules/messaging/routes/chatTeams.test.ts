import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/chat/teams…` and `/api/chat/channels…` (OFFICE-CHAT-PLAN CH5b). The rules live in 0519/0520
 * and are executed by `supabase/tests/office-chat-teams.test.mjs`; this file holds the ROUTER to what
 * is its own: the routes are reached ahead of the conversation router, every call carries the token's
 * org and user, making a team and listing every team ask the `chat.teams` permission, every other
 * team act hands the caller's answer to the database as `p_manager` (D-CHAT21), the new error codes
 * become answers, and a reply counts against the office budget as a post does.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
const USER = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const SPACE = "55555555-5555-4555-8555-555555555555";
const GENERAL = "66666666-6666-4666-8666-666666666666";
const CHANNEL = "77777777-7777-4777-8777-777777777777";
const POST = "88888888-8888-4888-8888-888888888888";
const MSG = "44444444-4444-4444-8444-444444444444";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

let me: AuthContext = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
let rpc: Record<string, unknown> = {};
type Row = { role?: string; user_id?: string; surface_key: string; allowed: boolean };
let userAnswers: Row[] = [];

const line = (seq: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, thread_id: CHANNEL, seq, rev: seq,
  sender_user_id: PEER, sender_name: "Ben Admin", body: `line ${seq}`,
  created_at: "2026-10-25T15:00:00Z", edited_at: null, deleted_at: null,
  parent_id: null, reply_count: 0, last_reply_at: null, ...over,
});
const team = () => ({
  space_id: SPACE, name: "Dispatch", description: null, space_role: "member", member_count: 3,
  created_at: "2026-10-25T14:00:00Z",
  channels: [{
    thread_id: GENERAL, name: "General", visibility: "public", general: true, joined: true,
    last_message_at: "2026-10-25T15:00:00Z", last_seq: 4, read_seq: 2, unread: 2, muted: "none",
  }, {
    thread_id: CHANNEL, name: "Loads", visibility: "public", general: false, joined: false,
    last_message_at: "2026-10-25T15:00:00Z", last_seq: 9, read_seq: null, unread: 0, muted: null,
  }],
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
  userAnswers = [];
  rpc = {
    org_module_enabled: true,
    bump_driver_write_counter: [{ allowed: true }],
    chat_teams: [team()],
    chat_team_directory: [{
      space_id: SPACE, name: "Dispatch", description: null, created_at: "2026-10-25T14:00:00Z", created_by_name: "Ben Admin",
      archived_at: null, member_count: "3", channel_count: "2", owners: [{ user_id: PEER, name: "Ben Admin" }], is_member: false,
    }],
    chat_team_create: SPACE,
    chat_team_update: null,
    chat_team_archive: null,
    chat_team_members: [{ user_id: PEER, name: "Ben Admin", role: "admin", space_role: "owner", joined_at: "2026-10-25T14:00:00Z" }],
    chat_team_add_members: 1,
    chat_team_remove: null,
    chat_team_set_role: null,
    chat_channel_create: CHANNEL,
    chat_channel_join: null,
    chat_channel_add_members: 1,
    chat_channel_leave: null,
    chat_channel_rename: null,
    chat_channel_archive: null,
    chat_channel_posts: [line(3, { reply_count: 2, last_reply_at: "2026-10-25T15:05:00Z" }), line(1)],
    chat_replies: [line(5, { parent_id: POST }), line(4, { parent_id: POST })],
    chat_send_reply: [{ message_id: MSG, seq: 6, rev: 6, created_at: "2026-10-25T15:06:00Z", duplicate: false }],
  };
  // The org's stored screen answers, filtered the way PostgREST would (the recorder does not filter).
  const byUser = (q: { filters(): Array<{ col: string; val: unknown }> }) =>
    userAnswers.filter((r) => r.user_id === q.filters().find((f) => f.col === "user_id")?.val);
  holder.rec = createSupabaseRecorder({
    rpc: (fn) => rpc[fn],
    tables: { org_role_surface_access: [], user_surface_access: byUser },
  });
});

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/chat${path}`, {
    ...init,
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
  });
const post = (path: string, body: unknown, method = "POST") => call(path, { method, body: JSON.stringify(body) });
const chatCalls = () => holder.rec!.rpcs().filter((c) => c.fn.startsWith("chat_"));
const argsOf = (fn: string) => holder.rec!.rpcs().find((c) => c.fn === fn)?.args as Record<string, unknown> | undefined;
const grantTeams = () => { userAnswers = [{ user_id: USER, surface_key: "chat.teams", allowed: true }]; };

describe("who reaches the teams routes", () => {
  it("refuses a driver login before any chat function runs", async () => {
    me = { ...me, role: "driver" };
    expect((await call("/teams")).status).toBe(403);
    expect((await call(`/channels/${CHANNEL}/posts`)).status).toBe(403);
    expect(chatCalls()).toEqual([]);
  });

  it("answers /teams itself rather than letting the conversation router read it as a conversation id", async () => {
    const res = await call("/teams");
    expect(res.status).toBe(200);
    expect(chatCalls().map((c) => c.fn)).toEqual(["chat_teams"]);
  });
});

describe("every call is the caller's, from the token", () => {
  it("passes the token's org and user to every function, and reads no table but the screen answers", async () => {
    grantTeams();
    await call("/teams");
    await call("/teams/directory");
    await post("/teams", { space_id: SPACE, general_id: GENERAL, name: "Dispatch" });
    await post(`/teams/${SPACE}/archive`, {});
    await post(`/channels/${CHANNEL}/join`, {});
    await call(`/channels/${CHANNEL}/posts`);
    await post(`/channels/${CHANNEL}/posts/${POST}/replies`, { message_id: MSG, body: "On it." });
    const calls = chatCalls();
    // Seven, and the reply's bell question (`chat_notify_targets`, CH6b-2), asked of the line just written.
    expect(calls.length).toBe(8);
    for (const c of calls) {
      const args = c.args as Record<string, unknown>;
      expect(args.p_org, c.fn).toBe(ORG);
      if (c.fn === "chat_notify_targets") expect(args.p_message).toBe(MSG);
      else expect(args.p_user ?? args.p_actor, c.fn).toBe(USER);
    }
    expectOrgScoped(holder.rec!, ORG);
    const tables = new Set(holder.rec!.queries.filter((q) => !q.table.startsWith("rpc:")).map((q) => q.table));
    expect([...tables].sort()).toEqual(["org_role_surface_access", "user_surface_access"]);
  });

  it("ignores an org or an actor named in the body", async () => {
    grantTeams();
    await post("/teams", { space_id: SPACE, general_id: GENERAL, name: "Dispatch", org_id: OTHER_ORG, created_by: PEER });
    expect(argsOf("chat_team_create")).toMatchObject({ p_org: ORG, p_actor: USER });
  });
});

describe("the Chat teams permission (D-CHAT17, D-CHAT21)", () => {
  it("is the admin's by default: an admin makes a team, a dispatcher is refused before the database", async () => {
    expect((await post("/teams", { space_id: SPACE, general_id: GENERAL, name: "Dispatch" })).status).toBe(403);
    expect((await call("/teams/directory")).status).toBe(403);
    expect(chatCalls()).toEqual([]);
    me = { ...me, role: "admin" };
    const res = await post("/teams", { space_id: SPACE, general_id: GENERAL, name: "Dispatch", member_ids: [PEER] });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ space_id: SPACE });
    expect(argsOf("chat_team_create")).toMatchObject({ p_space_id: SPACE, p_general_id: GENERAL, p_name: "Dispatch", p_members: [PEER] });
  });

  it("reaches a dispatcher the admin has given it, which no section gate could have done", async () => {
    grantTeams();
    expect((await post("/teams", { space_id: SPACE, general_id: GENERAL, name: "Dispatch" })).status).toBe(201);
    const body = (await (await call("/teams/directory")).json()) as { teams: Array<{ member_count: number; is_member: boolean }> };
    expect(body.teams).toEqual([expect.objectContaining({ member_count: 3, is_member: false })]);
  });

  // One answer per test: the screen answers are cached per caller for 15 s (lib/ttlCache.ts), and the
  // cache is reset between tests, not within one.
  it("tells the rail a caller without it may not make a team", async () => {
    expect(((await (await call("/teams")).json()) as { can_manage: boolean }).can_manage).toBe(false);
  });

  it("tells the rail a caller given it may", async () => {
    grantTeams();
    expect(((await (await call("/teams")).json()) as { can_manage: boolean }).can_manage).toBe(true);
  });

  const teamActs = async () => {
    await post(`/teams/${SPACE}`, { name: "Dispatch day" }, "PATCH");
    await post(`/teams/${SPACE}/archive`, {});
    await call(`/teams/${SPACE}/members`);
    await post(`/teams/${SPACE}/members`, { user_ids: [PEER] });
    await post(`/teams/${SPACE}/members/${PEER}`, { space_role: "owner" }, "PATCH");
    await call(`/teams/${SPACE}/members/${PEER}`, { method: "DELETE" });
    await post(`/channels/${CHANNEL}`, { name: "Loads" }, "PATCH");
    await post(`/channels/${CHANNEL}/archive`, {});
    await call(`/channels/${CHANNEL}/members/${PEER}`, { method: "DELETE" });
  };
  const managers = () => chatCalls().map((c) => (c.args as { p_manager?: boolean }).p_manager);

  it("hands a non-holder's team acts to the database as p_manager = false, which then decides", async () => {
    await teamActs();
    expect(managers()).toEqual(Array(9).fill(false));
  });

  it("hands a holder's as p_manager = true", async () => {
    grantTeams();
    await teamActs();
    expect(managers()).toEqual(Array(9).fill(true));
  });

  it("never lends the permission to leaving: leaving is the member's own act", async () => {
    grantTeams();
    await post(`/teams/${SPACE}/leave`, {});
    await post(`/channels/${CHANNEL}/leave`, {});
    expect(argsOf("chat_team_remove")).toMatchObject({ p_user: null, p_manager: false });
    expect(argsOf("chat_channel_leave")).toMatchObject({ p_user: null, p_manager: false });
  });
});

describe("refusals from the database become answers", () => {
  it.each([
    ["CH001", 404, "not_found"],
    ["CH008", 403, "owner_only"],
    ["CH011", 422, "reply_not_allowed"],
    ["CH012", 409, "name_in_use"],
    // 0521 (Q-CHAT20): a reply naming somebody who is not in the channel.
    ["CH013", 422, "mention_not_in_conversation"],
  ])("%s → %i %s", async (sqlstate, status, code) => {
    rpc.chat_send_reply = { error: { code: sqlstate, message: "refused" } };
    const res = await post(`/channels/${CHANNEL}/posts/${POST}/replies`, { message_id: MSG, body: "x" });
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
  });

  it("a name already in use keeps the database's sentence", async () => {
    grantTeams();
    rpc.chat_team_create = { error: { code: "CH012", message: "a team called Dispatch already exists" } };
    const res = await post("/teams", { space_id: SPACE, general_id: GENERAL, name: "Dispatch" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "name_in_use", message: "a team called Dispatch already exists" } });
  });

  it("refuses an empty name or an empty update before the database", async () => {
    grantTeams();
    expect((await post("/teams", { space_id: SPACE, general_id: GENERAL, name: "   " })).status).toBe(400);
    expect((await post(`/teams/${SPACE}`, {}, "PATCH")).status).toBe(400);
    expect((await post(`/teams/${SPACE}/channels`, { thread_id: CHANNEL, name: "x", visibility: "secret" })).status).toBe(400);
    expect(chatCalls()).toEqual([]);
  });

  it("is a 404 for an id that is not a uuid, without asking the database", async () => {
    expect((await post("/teams/not-a-uuid/archive", {})).status).toBe(404);
    expect((await call("/channels/not-a-uuid/posts")).status).toBe(404);
    expect(chatCalls()).toEqual([]);
  });
});

describe("channels, posts and replies", () => {
  it("makes a channel in the team, naming its people only when it is private", async () => {
    await post(`/teams/${SPACE}/channels`, { thread_id: CHANNEL, name: "Loads", visibility: "public", member_ids: [PEER] });
    expect(argsOf("chat_channel_create")).toMatchObject({ p_space: SPACE, p_visibility: "public", p_members: null });
    await post(`/teams/${SPACE}/channels`, { thread_id: CHANNEL, name: "Payroll", visibility: "private", member_ids: [PEER] });
    const second = holder.rec!.rpcs().filter((c) => c.fn === "chat_channel_create")[1]!.args;
    expect(second).toMatchObject({ p_visibility: "private", p_members: [PEER] });
  });

  it("lists the rail's channels, joined and not, with unread only where the caller is in", async () => {
    const body = (await (await call("/teams")).json()) as { teams: Array<{ channels: Array<{ joined: boolean; unread: number; read_seq: number | null }> }> };
    expect(body.teams[0]!.channels.map((c) => [c.joined, c.unread, c.read_seq])).toEqual([[true, 2, 2], [false, 0, null]]);
  });

  it("pages a channel's posts oldest first, each with its reply counters", async () => {
    const body = (await (await call(`/channels/${CHANNEL}/posts`)).json()) as { posts: Array<{ seq: number; reply_count: number }>; before_seq: number | null };
    expect(body.posts.map((p) => [p.seq, p.reply_count])).toEqual([[1, 0], [3, 2]]);
    expect(body.before_seq).toBeNull();
  });

  it("pages a post's replies, and refuses a post that belongs to another channel", async () => {
    const body = (await (await call(`/channels/${CHANNEL}/posts/${POST}/replies`)).json()) as { posts: Array<{ seq: number; parent_id: string }> };
    expect(body.posts.map((p) => p.seq)).toEqual([4, 5]);
    expect(argsOf("chat_replies")).toMatchObject({ p_parent: POST });
    rpc.chat_replies = [line(5, { parent_id: POST, thread_id: GENERAL })];
    expect((await call(`/channels/${CHANNEL}/posts/${POST}/replies`)).status).toBe(404);
  });

  it("answers 201 for a new reply and 200 for a retry, naming the post and the channel", async () => {
    expect((await post(`/channels/${CHANNEL}/posts/${POST}/replies`, { message_id: MSG, body: "x" })).status).toBe(201);
    expect(argsOf("chat_send_reply")).toMatchObject({ p_thread: CHANNEL, p_parent: POST, p_message_id: MSG });
    rpc.chat_send_reply = [{ message_id: MSG, seq: 6, rev: 6, created_at: "2026-10-25T15:06:00Z", duplicate: true }];
    expect((await post(`/channels/${CHANNEL}/posts/${POST}/replies`, { message_id: MSG, body: "x" })).status).toBe(200);
  });

  it("counts a reply against the office budget, and joining a channel against nothing", async () => {
    await post(`/channels/${CHANNEL}/posts/${POST}/replies`, { message_id: MSG, body: "x" });
    await post(`/channels/${CHANNEL}/join`, {});
    const bumps = holder.rec!.rpcs().filter((c) => c.fn === "bump_driver_write_counter");
    expect(bumps.map((b) => (b.args as { p_bucket: string }).p_bucket)).toEqual(["chat_message"]);
  });
});
