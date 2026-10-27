import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * CH6b-2's API (OFFICE-CHAT-PLAN §9.2): mute, Activity, and the bell a line rings. Who is told — never
 * the author, never a conversation muted `all`, only a mention through `mentions` — is 0521's
 * `chat_notify_targets`, executed by `supabase/tests/office-chat-mentions.test.mjs`. What this file holds
 * the ROUTES to is everything around that answer: each row becomes one `emit_notification` with the key
 * the database chose, worded from the sender's view of the conversation; a retried send and an edit
 * that names nobody new ring nothing; a bell that fails never fails the line; and every call carries
 * the token's org.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const CARA = "55555555-5555-4555-8555-555555555555";
const THREAD = "33333333-3333-4333-8333-333333333333";
const MSG = "44444444-4444-4444-8444-444444444444";
const POST = "66666666-6666-4666-8666-666666666666";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

const me: AuthContext = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
let rpc: Record<string, unknown> = {};
let tables: Record<string, unknown[]> = {};

const conversation = (over: Record<string, unknown> = {}) => ({
  thread_id: THREAD, kind: "group", subject: "Night dispatch", load_id: null,
  created_at: "2026-10-27T14:00:00Z", last_message_at: "2026-10-27T15:00:00Z",
  last_seq: 3, rev: 4, read_seq: 3, unread: 0, muted: "none", member_role: "member", member_count: 3,
  title_members: [{ user_id: BEN, name: "Ben" }], last_message: null, ...over,
});
const member = (user_id: string, name: string) => ({
  user_id, name, member_role: "member", read_seq: 1, last_read_at: null, joined_at: "2026-10-27T14:00:00Z",
});
const target = (user_id: string, category: string, read_seq = 3) => ({
  user_id, category, read_seq, dedupe_key: `${category}:${THREAD}:${read_seq}`,
});
const item = (n: number, over: Record<string, unknown> = {}) => ({
  message_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, reason: "mention",
  at: `2026-10-27T15:0${n}:00.123456+00:00`, unread: true, thread_id: THREAD, kind: "group", subject: "Night dispatch",
  space_id: null, parent_id: null, seq: n, sender_user_id: BEN, sender_name: "Ben", body: `<@${USER}> line ${n}`,
  created_at: `2026-10-27T15:0${n}:00Z`, ...over,
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
  rpc = {
    org_module_enabled: true,
    bump_driver_write_counter: [{ allowed: true }],
    chat_inbox: [conversation()],
    chat_members: [member(USER, "Ana"), member(BEN, "Ben"), member(CARA, "Cara")],
    chat_send: [{ message_id: MSG, seq: 4, rev: 5, created_at: "2026-10-27T15:01:00Z", duplicate: false }],
    chat_send_reply: [{ message_id: MSG, seq: 6, rev: 6, created_at: "2026-10-27T15:06:00Z", duplicate: false }],
    chat_edit: 6,
    chat_notify_targets: [],
    emit_notification: "77777777-7777-4777-8777-777777777777",
    chat_set_mute: "mentions",
    chat_activity: [item(2), item(1)],
    chat_activity_unread: "2",
    chat_activity_mark_read: "2026-10-27T15:02:00.123456+00:00",
  };
  tables = {};
  holder.rec = createSupabaseRecorder({ rpc: (fn) => rpc[fn], tables });
});

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/chat${path}`, { ...init, headers: { Authorization: "Bearer token", "Content-Type": "application/json" } });
const post = (path: string, body: unknown, method = "POST") => call(path, { method, body: JSON.stringify(body) });
const calls = (fn: string) => holder.rec!.rpcs().filter((c) => c.fn === fn).map((c) => c.args as Record<string, unknown>);

describe("mute", () => {
  it("sets the caller's own mute, from the token, and answers the level", async () => {
    const res = await post(`/${THREAD}/mute`, { muted: "mentions", user_id: BEN }, "PUT");
    expect(await res.json()).toEqual({ muted: "mentions" });
    expect(calls("chat_set_mute")).toEqual([{ p_org: ORG, p_user: USER, p_thread: THREAD, p_level: "mentions" }]);
  });

  it("refuses a level that is not one before the database, and a conversation the caller is not in as a 404", async () => {
    expect((await post(`/${THREAD}/mute`, { muted: "loud" }, "PUT")).status).toBe(400);
    expect(calls("chat_set_mute")).toEqual([]);
    rpc.chat_set_mute = { error: { code: "CH001", message: "" } };
    expect((await post(`/${THREAD}/mute`, { muted: "all" }, "PUT")).status).toBe(404);
  });
});

describe("Activity", () => {
  it("is the caller's, newest first, with the badge, and is not read as a conversation called 'activity'", async () => {
    const body = (await (await call("/activity")).json()) as { items: Array<{ seq: number }>; next: unknown; unread: number };
    expect(body.items.map((i) => i.seq)).toEqual([2, 1]);
    expect(body).toMatchObject({ next: null, unread: 2 });
    expect(calls("chat_activity")).toEqual([{ p_org: ORG, p_user: USER, p_before_at: null, p_before_id: null, p_limit: 50 }]);
    expect(calls("chat_inbox")).toEqual([]);
  });

  it("hands back the last row's instant and id, to the microsecond, when the page is full", async () => {
    const body = (await (await call("/activity?limit=2")).json()) as { next: { before_at: string; before_id: string } };
    expect(body.next).toEqual({ before_at: item(1).at, before_id: item(1).message_id });
    await call(`/activity?before_at=${encodeURIComponent(body.next.before_at)}&before_id=${body.next.before_id}`);
    expect(calls("chat_activity")[1]).toMatchObject({ p_before_at: item(1).at, p_before_id: item(1).message_id });
  });

  it("refuses half a cursor", async () => {
    expect((await call("/activity?before_at=2026-10-27T15:00:00Z")).status).toBe(400);
    expect(calls("chat_activity")).toEqual([]);
  });

  it("answers the badge alone", async () => {
    expect(await (await call("/activity/unread")).json()).toEqual({ unread: 2 });
    expect(calls("chat_activity")).toEqual([]);
  });

  it("marks read up to the instant given, or now, and refuses words that are not an instant", async () => {
    expect(await (await post("/activity/read", { at: "2026-10-27T15:02:00.123456Z" })).json())
      .toEqual({ activity_read_at: "2026-10-27T15:02:00.123456+00:00" });
    await post("/activity/read", {});
    expect(calls("chat_activity_mark_read")).toEqual([
      { p_org: ORG, p_user: USER, p_at: "2026-10-27T15:02:00.123456Z" },
      { p_org: ORG, p_user: USER, p_at: null },
    ]);
    expect((await post("/activity/read", { at: "now" })).status).toBe(400);
  });
});

describe("the bell a new line rings (D-CHAT23)", () => {
  it("tells each person the database names, with its key, worded from the sender's view of the conversation", async () => {
    rpc.chat_notify_targets = [target(BEN, "chat_mention", 3), target(CARA, "chat_mention", 7)];
    const res = await post(`/${THREAD}/messages`, { message_id: MSG, body: `<@${BEN}> and <@${CARA}>, the Joliet load is ready` });
    expect(res.status).toBe(201);
    expect(calls("chat_notify_targets")).toEqual([{ p_org: ORG, p_message: MSG }]);
    // The sender's view: the conversation's name and the names its tokens stand for.
    expect(calls("chat_inbox")[0]).toMatchObject({ p_org: ORG, p_user: USER, p_thread: THREAD });
    expect(calls("chat_members")).toEqual([{ p_org: ORG, p_user: USER, p_thread: THREAD }]);
    const emits = calls("emit_notification");
    expect(emits.map((e) => [e.p_user, e.p_dedupe_key])).toEqual([
      [BEN, `chat_mention:${THREAD}:3`],
      [CARA, `chat_mention:${THREAD}:7`],
    ]);
    expect(emits[0]).toMatchObject({
      p_org: ORG, p_category: "chat_mention", p_title: "Ana mentioned you in Night dispatch",
      p_body: "@Ben and @Cara, the Joliet load is ready", p_entity_type: "chat_conversation", p_entity_id: THREAD,
    });
    expectOrgScoped(holder.rec!, ORG);
  });

  it("names a channel with its # and opens it as a channel; a direct line names no place", async () => {
    rpc.chat_notify_targets = [target(BEN, "chat_mention")];
    rpc.chat_inbox = [conversation({ kind: "channel", subject: "Loads" })];
    await post(`/${THREAD}/messages`, { message_id: MSG, body: `<@${BEN}> look` });
    rpc.chat_inbox = [conversation({ kind: "direct", subject: null })];
    await post(`/${THREAD}/messages`, { message_id: MSG, body: `<@${BEN}> look` });
    expect(calls("emit_notification").map((e) => [e.p_title, e.p_entity_type])).toEqual([
      ["Ana mentioned you in # Loads", "chat_channel"],
      ["Ana mentioned you", "chat_conversation"],
    ]);
  });

  it("cuts the words at 80 characters (Q-CHAT18)", async () => {
    rpc.chat_notify_targets = [target(BEN, "chat_mention")];
    await post(`/${THREAD}/messages`, { message_id: MSG, body: `<@${BEN}> ${"x".repeat(200)}` });
    const body = calls("emit_notification")[0]!.p_body as string;
    expect(body).toHaveLength(80);
    expect(body.endsWith("…")).toBe(true);
  });

  it("words nothing when nobody is to be told — the conversation is not even looked up", async () => {
    await post(`/${THREAD}/messages`, { message_id: MSG, body: "no names here" });
    expect(calls("chat_notify_targets")).toHaveLength(1);
    expect(calls("chat_members")).toEqual([]);
    expect(calls("emit_notification")).toEqual([]);
  });

  it("rings nothing for a retried send the database recognised", async () => {
    rpc.chat_notify_targets = [target(BEN, "chat_mention")];
    rpc.chat_send = [{ message_id: MSG, seq: 4, rev: 5, created_at: "2026-10-27T15:01:00Z", duplicate: true }];
    expect((await post(`/${THREAD}/messages`, { message_id: MSG, body: `<@${BEN}>` })).status).toBe(200);
    expect(calls("chat_notify_targets")).toEqual([]);
  });

  it("never fails the line it rings for", async () => {
    rpc.chat_notify_targets = { error: { code: "XX000", message: "boom" } };
    expect((await post(`/${THREAD}/messages`, { message_id: MSG, body: "x" })).status).toBe(201);
  });

  it("a channel reply tells the post's people as a reply", async () => {
    rpc.chat_inbox = [conversation({ kind: "channel", subject: "Loads" })];
    rpc.chat_notify_targets = [target(BEN, "chat_reply")];
    const res = await post(`/channels/${THREAD}/posts/${POST}/replies`, { message_id: MSG, body: "Done." });
    expect(res.status).toBe(201);
    expect(calls("emit_notification")[0]).toMatchObject({
      p_user: BEN, p_category: "chat_reply", p_title: "Ana replied in # Loads", p_body: "Done.", p_entity_type: "chat_channel",
    });
  });
});

describe("the bell an edit rings", () => {
  it("tells only the people the edit newly names, as a mention", async () => {
    tables.messages = [{ thread_id: THREAD, body: `<@${BEN}> see this` }];
    rpc.chat_notify_targets = [target(BEN, "chat_mention"), target(CARA, "chat_mention"), target(USER, "chat_reply")];
    expect((await post(`/messages/${MSG}`, { body: `<@${BEN}> <@${CARA}> see this` }, "PATCH")).status).toBe(200);
    expect(calls("emit_notification").map((e) => e.p_user)).toEqual([CARA]);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("reads nothing before an edit that names nobody, and rings nothing", async () => {
    await post(`/messages/${MSG}`, { body: "fixed a typo" }, "PATCH");
    expect(holder.rec!.forTable("messages")).toEqual([]);
    expect(calls("chat_notify_targets")).toEqual([]);
  });

  it("rings nothing when the edit is refused", async () => {
    tables.messages = [{ thread_id: THREAD, body: "x" }];
    rpc.chat_notify_targets = [target(BEN, "chat_mention")];
    rpc.chat_edit = { error: { code: "CH003", message: "" } };
    expect((await post(`/messages/${MSG}`, { body: `<@${BEN}>` }, "PATCH")).status).toBe(409);
    expect(calls("chat_notify_targets")).toEqual([]);
  });
});
