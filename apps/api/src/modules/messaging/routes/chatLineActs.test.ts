import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * CH6c-2's routes: react, pin, save, a conversation's pins and the caller's saved lines. The rules are
 * 0523's and run in `supabase/tests/office-chat-reactions.test.mjs`; this file holds the ROUTER to the
 * token-to-function path — the caller's org and user from the token, never the body; a bad id or an
 * unknown reaction refused before the database; each SQLSTATE its answer; and none of these acts a new
 * message, so none counts against the message budget or rings a bell.
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

const saved = (n: number) => ({
  message_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, saved_at: `2026-10-2${n}T15:00:00Z`,
  thread_id: THREAD, kind: "channel", subject: "Loads", space_id: PEER, parent_id: null, seq: n,
  sender_user_id: PEER, sender_name: "Ben Admin", body: `line ${n}`, created_at: "2026-10-23T15:00:00Z",
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
    chat_react: 9,
    chat_pin: "10", // a bigint may arrive as a string
    chat_save: true,
    chat_pins: [{
      id: MSG, thread_id: THREAD, seq: 3, rev: 10, sender_user_id: PEER, sender_name: "Ben Admin", body: "Gate code 4411",
      created_at: "2026-10-23T15:00:00Z", edited_at: null, parent_id: null,
      pinned_at: "2026-10-24T09:00:00Z", pinned_by: USER, pinned_by_name: "Ana",
    }],
    chat_saved: [saved(3), saved(2)],
  };
  holder.rec = createSupabaseRecorder({ rpc: (fn) => rpc[fn] });
});

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/chat${path}`, { ...init, headers: { Authorization: "Bearer token", "Content-Type": "application/json" } });
const send = (path: string, body: unknown, method = "POST") => call(path, { method, body: JSON.stringify(body) });
const chatCalls = () => holder.rec!.rpcs().filter((c) => c.fn.startsWith("chat_"));

describe("reacting, pinning and saving a line", () => {
  it("passes the token's org and user and the line's id, and answers the line's new rev", async () => {
    expect(await (await send(`/messages/${MSG}/reactions`, { reaction: "thumbs_up", on: true })).json()).toEqual({ rev: 9 });
    expect(await (await send(`/messages/${MSG}/pin`, { on: true }, "PUT")).json()).toEqual({ rev: 10 });
    expect(await (await send(`/messages/${MSG}/save`, { on: false }, "PUT")).json()).toEqual({ saved: true });
    const [react, pin, save] = chatCalls();
    expect(react!.args).toEqual({ p_org: ORG, p_actor: USER, p_message: MSG, p_reaction: "thumbs_up", p_on: true });
    expect(pin!.args).toEqual({ p_org: ORG, p_actor: USER, p_message: MSG, p_on: true });
    expect(save!.args).toEqual({ p_org: ORG, p_user: USER, p_message: MSG, p_on: false });
    expectOrgScoped(holder.rec!, ORG);
  });

  it("ignores an org or a user named in the body", async () => {
    await send(`/messages/${MSG}/reactions`, { reaction: "heart", on: true, org_id: OTHER_ORG, user_id: PEER });
    expect(chatCalls()[0]!.args).toMatchObject({ p_org: ORG, p_actor: USER });
  });

  it("refuses a reaction that is not one of the six, a missing `on` and a bad id before the database", async () => {
    expect((await send(`/messages/${MSG}/reactions`, { reaction: "angry", on: true })).status).toBe(400);
    expect((await send(`/messages/${MSG}/pin`, {}, "PUT")).status).toBe(400);
    expect((await send("/messages/not-a-uuid/save", { on: true }, "PUT")).status).toBe(404);
    expect(chatCalls()).toEqual([]);
  });

  it.each([
    ["CH001", 404, "not_found"],
    ["CH004", 409, "message_retracted"],
    ["CH005", 409, "conversation_archived"],
    ["CH006", 422, "not_allowed_here"],
  ])("a %s refusal becomes %i %s", async (sqlstate, status, code) => {
    rpc.chat_react = { error: { code: sqlstate, message: "refused" } };
    const res = await send(`/messages/${MSG}/reactions`, { reaction: "done", on: true });
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
  });

  it("is not a new message: nothing counts against the message budget and no bell is asked", async () => {
    await send(`/messages/${MSG}/reactions`, { reaction: "thumbs_up", on: true });
    await send(`/messages/${MSG}/pin`, { on: true }, "PUT");
    await send(`/messages/${MSG}/save`, { on: true }, "PUT");
    const fns = holder.rec!.rpcs().map((c) => c.fn);
    expect(fns.filter((f) => f === "bump_driver_write_counter" || f === "chat_notify_targets")).toEqual([]);
  });

  it("refuses a driver login before any chat function runs", async () => {
    me = { ...me, role: "driver" };
    expect((await send(`/messages/${MSG}/reactions`, { reaction: "thumbs_up", on: true })).status).toBe(403);
    expect(chatCalls()).toEqual([]);
  });
});

describe("the lists", () => {
  it("lists a conversation's pins as the caller sees them, and is a 404 when they are not in it", async () => {
    const body = (await (await call(`/${THREAD}/pins`)).json()) as { pins: Array<{ id: string; pinned_by_name: string }> };
    expect(body.pins).toEqual([expect.objectContaining({ id: MSG, pinned_by_name: "Ana" })]);
    expect(chatCalls()[0]!.args).toEqual({ p_org: ORG, p_user: USER, p_thread: THREAD });
    rpc.chat_pins = { error: { code: "CH001", message: "" } };
    expect((await call(`/${THREAD}/pins`)).status).toBe(404);
  });

  it("lists the caller's saved lines — `/saved` is not read as a conversation id — and pages them", async () => {
    const short = (await (await call("/saved")).json()) as { items: unknown[]; next: unknown };
    expect(short.items).toHaveLength(2);
    expect(short.next).toBeNull();
    expect(chatCalls().map((c) => c.fn)).toEqual(["chat_saved"]);
    const full = (await (await call("/saved?limit=2")).json()) as { next: unknown };
    expect(full.next).toEqual({ before_at: "2026-10-22T15:00:00Z", before_id: saved(2).message_id });
    await call(`/saved?before_at=2026-10-22T15:00:00Z&before_id=${saved(2).message_id}`);
    expect(chatCalls()[2]!.args).toMatchObject({ p_org: ORG, p_user: USER, p_before_at: "2026-10-22T15:00:00Z", p_before_id: saved(2).message_id });
  });

  it("refuses half a cursor", async () => {
    expect((await call("/saved?before_at=2026-10-22T15:00:00Z")).status).toBe(400);
    expect(chatCalls()).toEqual([]);
  });
});
