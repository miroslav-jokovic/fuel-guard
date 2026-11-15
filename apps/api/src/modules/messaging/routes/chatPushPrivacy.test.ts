import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/chat/push/privacy` (INSTALLED-APP-PLAN IA-S4). Who hides and who may set it is 0614's, executed by
 * `supabase/tests/chat-push-text-hidden.test.mjs`. These routes are held to what reaches it: the person and the
 * org from the token, never the body; only true or false ever reaches the database; the answer is what the
 * database stored; and chat's gates.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
let me: AuthContext;
let rpc: Record<string, unknown>;
let url = "";
let server: Server;

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => me;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat/push/privacy`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

beforeEach(() => {
  me = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
  rpc = { org_module_enabled: (_fn: string, args: { p_module: string }) => args.p_module === "messages", chat_push_text_hidden_for: [], chat_push_hide_text: true };
  holder.rec = createSupabaseRecorder({ rpc: (fn, args) => (typeof rpc[fn] === "function" ? (rpc[fn] as (f: string, a: unknown) => unknown)(fn, args) : rpc[fn]) });
});

const call = (method = "GET", body?: unknown) =>
  fetch(url, { method, headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const calls = (fn: string) => holder.rec!.rpcs().filter((c) => c.fn === fn).map((c) => c.args as Record<string, unknown>);

describe("GET /api/chat/push/privacy", () => {
  it("says the text is shown for a person who never chose, asking only about the caller", async () => {
    expect(await (await call()).json()).toEqual({ hide_text: false });
    expect(calls("chat_push_text_hidden_for")).toEqual([{ p_org: ORG, p_users: [USER] }]);
  });

  it("says hidden when the database answers the caller", async () => {
    rpc.chat_push_text_hidden_for = [{ user_id: USER }];
    expect(await (await call()).json()).toEqual({ hide_text: true });
  });

  it("does not guess when the database cannot be read", async () => {
    rpc.chat_push_text_hidden_for = { error: { code: "XX000", message: "down" } };
    expect((await call()).status).toBe(500);
  });

  it("is chat's: it needs Messages, and a driver is refused", async () => {
    expect((await call()).status).toBe(200);
    me = { ...me, role: "driver" };
    expect((await call()).status).toBe(403);
  });
});

describe("PUT /api/chat/push/privacy", () => {
  it("sets it for the caller of the token, whatever the body says about who, and answers what was stored", async () => {
    const res = await call("PUT", { hide_text: true, user_id: OTHER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hide_text: true });
    expect(calls("chat_push_hide_text")).toEqual([{ p_org: ORG, p_user: USER, p_hide: true }]);
  });

  it("answers what the database stored when that is not what was asked", async () => {
    rpc.chat_push_hide_text = false;
    expect(await (await call("PUT", { hide_text: true })).json()).toEqual({ hide_text: false });
  });

  it("turns it off", async () => {
    rpc.chat_push_hide_text = false;
    expect(await (await call("PUT", { hide_text: false })).json()).toEqual({ hide_text: false });
    expect(calls("chat_push_hide_text")[0]).toMatchObject({ p_hide: false });
  });

  it("never sends the database anything but true or false", async () => {
    for (const bad of [{}, { hide_text: null }, { hide_text: "yes" }, { hide_text: 1 }]) {
      expect((await call("PUT", bad)).status).toBe(400);
    }
    expect(calls("chat_push_hide_text")).toEqual([]);
  });

  it("answers the database's refusal of somebody who is not an office member as 403", async () => {
    rpc.chat_push_hide_text = { error: { code: "WP001", message: "not an active office member" } };
    expect((await call("PUT", { hide_text: true })).status).toBe(403);
  });
});
