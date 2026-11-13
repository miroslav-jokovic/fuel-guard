import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createECDH, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { generateVapidKeys } from "../webPush.js";

/**
 * `/api/chat/push` (CHAT-WEB-PUSH-PLAN WP2, D-WP1, D-WP5, D-WP7). The database decides who may register and
 * whose row a turn-off touches (0599, `chat-web-push.test.mjs`); these routes are held to what reaches it: the
 * org and the person always from the token, never the body; an endpoint that is not a push service's and an
 * origin that is not this app's never reach it; signing out works for somebody chat was taken from; a test
 * notifies only the caller's own devices; and a server without a key pair says so instead of half-working.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://360.silvicominc.com";
const pair = generateVapidKeys();

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const base = { NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173` };
const envOn = loadEnv({ ...base, WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: pair.privateKey } as NodeJS.ProcessEnv);
const envOff = loadEnv(base as NodeJS.ProcessEnv);

let me: AuthContext = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
let rpc: Record<string, unknown> = {};
let tables: Record<string, unknown> = {};

const ua = createECDH("prime256v1");
ua.generateKeys();
const subscription = (over: Record<string, unknown> = {}) => ({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
  origin: ORIGIN,
  device_label: "Chrome on Android",
  ...over,
});

const servers: Server[] = [];
const urls: Record<"on" | "off", string> = { on: "", off: "" };
const realFetch = globalThis.fetch;
let pushed: string[] = [];
beforeAll(async () => {
  for (const [name, env] of [["on", envOn], ["off", envOff]] as const) {
    const app = createApp(env);
    app.locals.verifyToken = async (): Promise<AuthContext> => me;
    await new Promise<void>((resolve) => {
      const s = app.listen(0, () => {
        urls[name] = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
        resolve();
      });
      servers.push(s);
    });
  }
  // The server's push requests go to a fake push service; the test's own requests to the app go through.
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    pushed.push(u);
    return new Response("", { status: 201 });
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  for (const s of servers) await closeTestServer(s);
});

beforeEach(() => {
  me = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
  rpc = {
    org_module_enabled: true,
    web_push_subscribe: "99999999-9999-4999-8999-999999999999",
    web_push_unsubscribe: 1,
  };
  tables = { web_push_subscriptions: [] };
  holder.rec = createSupabaseRecorder({ rpc: (fn) => rpc[fn], tables: tables as never });
  pushed = [];
});

const call = (path: string, init: RequestInit = {}, host: "on" | "off" = "on") =>
  realFetch(`${urls[host]}/api/chat/push${path}`, { ...init, headers: { Authorization: "Bearer token", "Content-Type": "application/json" } });
const send = (path: string, method: string, body: unknown, host: "on" | "off" = "on") => call(path, { method, body: JSON.stringify(body) }, host);
const calls = (fn: string) => holder.rec!.rpcs().filter((c) => c.fn === fn).map((c) => c.args as Record<string, unknown>);

describe("GET /api/chat/push", () => {
  it("answers whether this server can push, with the key a browser subscribes with — and is not read as a conversation", async () => {
    expect(await (await call("")).json()).toEqual({ available: true, public_key: pair.publicKey });
    expect(await (await call("", {}, "off")).json()).toEqual({ available: false, public_key: null });
  });

  it("is chat's: a driver is refused", async () => {
    me = { ...me, role: "driver" };
    expect((await call("")).status).toBe(403);
  });
});

describe("PUT /api/chat/push/subscription", () => {
  it("registers this browser for the caller of the token, whatever the body says about who", async () => {
    const res = await send("/subscription", "PUT", { ...subscription(), user_id: OTHER, org_id: "x" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "99999999-9999-4999-8999-999999999999" });
    const [args] = calls("web_push_subscribe");
    expect(args).toMatchObject({ p_org: ORG, p_user: USER, p_endpoint: subscription().endpoint, p_origin: ORIGIN, p_label: "Chrome on Android" });
  });

  it("never lets a client name where the server will send a request", async () => {
    for (const endpoint of ["https://evil.example/x", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.example/x"]) {
      expect((await send("/subscription", "PUT", subscription({ endpoint }))).status, endpoint).toBe(400);
    }
    expect(calls("web_push_subscribe")).toEqual([]);
  });

  it("opens only this app: an origin outside the allowed ones is refused", async () => {
    expect((await send("/subscription", "PUT", subscription({ origin: "https://phish.example" }))).status).toBe(422);
    expect(calls("web_push_subscribe")).toEqual([]);
    expect((await send("/subscription", "PUT", subscription({ origin: "http://localhost:5173" }))).status).toBe(200);
  });

  it("answers the database's refusal of a non-member as 403, and a server without keys as 503", async () => {
    rpc.web_push_subscribe = { error: { code: "WP001", message: "not an active office member" } };
    expect((await send("/subscription", "PUT", subscription())).status).toBe(403);
    expect((await send("/subscription", "PUT", subscription(), "off")).status).toBe(503);
  });
});

describe("DELETE /api/chat/push/subscription", () => {
  it("stops this browser for the caller, with the reason", async () => {
    const res = await send("/subscription", "DELETE", { endpoint: subscription().endpoint, reason: "signed_out" });
    expect(await res.json()).toEqual({ revoked: 1 });
    expect(calls("web_push_unsubscribe")).toEqual([{ p_org: ORG, p_user: USER, p_endpoint: subscription().endpoint, p_reason: "signed_out" }]);
  });

  it("works for somebody chat was taken from — signing out must still stop the phone", async () => {
    me = { ...me, role: "driver" };
    expect((await send("/subscription", "DELETE", { endpoint: subscription().endpoint, reason: "signed_out" })).status).toBe(200);
  });

  it("refuses a reason that is not turning off or signing out", async () => {
    expect((await send("/subscription", "DELETE", { endpoint: subscription().endpoint, reason: "gone" })).status).toBe(400);
    expect(calls("web_push_unsubscribe")).toEqual([]);
  });
});

describe("POST /api/chat/push/test", () => {
  it("notifies every live device of the caller's own, in this organisation, and only every ten seconds", async () => {
    const s = subscription();
    tables.web_push_subscriptions = [
      { id: "d1", endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, origin: ORIGIN },
      { id: "d2", endpoint: "https://web.push.apple.com/xyz", p256dh: s.keys.p256dh, auth: s.keys.auth, origin: ORIGIN },
    ];
    holder.rec = createSupabaseRecorder({ rpc: (fn) => rpc[fn], tables: tables as never });
    const res = await send("/test", "POST", {});
    expect(await res.json()).toEqual({ devices: 2, sent: 2 });
    expect(pushed.sort()).toEqual([s.endpoint, "https://web.push.apple.com/xyz"].sort());
    const read = holder.rec!.forTable("web_push_subscriptions").find((q) => !q.write)!;
    expect(read.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "user_id", val: USER }]));
    expectOrgScoped(holder.rec!, ORG);
    expect((await send("/test", "POST", {})).status).toBe(429);
  });
});
