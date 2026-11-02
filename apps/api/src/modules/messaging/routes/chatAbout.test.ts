import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_ABOUT_READ_SECTION, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * CH11b's routes (0543's rules run in `supabase/tests/office-chat-about.test.mjs`). What this holds them
 * to: the caller's org and user come from the token; a conversation about a driver needs roster view,
 * the gate the driver's own page has (read from that route, so the two cannot drift); a load or a truck
 * needs only chat; bad kinds and ids are refused before the database is asked; the database's refusals
 * come back as 404s; and `/about` is never read as a conversation id.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";
const LOAD = "44444444-4444-4444-8444-444444444444";
const DRIVER = "55555555-5555-4555-8555-555555555555";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
let me: AuthContext = { userId: USER, email: "ana@example.test", orgId: ORG, role: "admin" };
let rpc: Record<string, unknown> = {};

let server: Server;
let baseUrl = "";
beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => me;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; resolve(); });
  });
});
afterAll(async () => closeTestServer(server));

const conv = { thread_id: THREAD, subject: "Load L-20481", created_at: "2026-11-02T10:00:00Z", last_message_at: "2026-11-02T11:00:00Z", unread: "2", member_count: "3", title_members: [{ user_id: BEN, name: "Ben Admin" }] };
beforeEach(() => {
  me = { userId: USER, email: "ana@example.test", orgId: ORG, role: "admin" };
  rpc = { org_module_enabled: true, chat_create_about: THREAD, chat_about: [conv], chat_thread_about: [{ kind: "load", record_id: LOAD, label: "L-20481" }] };
  holder.rec = createSupabaseRecorder({ rpc: (fn) => rpc[fn] });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();
const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/chat${path}`, { ...init, headers: { Authorization: "Bearer token", "Content-Type": "application/json" } });
const post = (body: unknown) => call("/about", { method: "POST", body: JSON.stringify(body) });
const args = (fn: string) => holder.rec!.rpcs().filter((c) => c.fn === fn).map((c) => c.args);
const create = (over: Record<string, unknown> = {}) => ({ thread_id: THREAD, kind: "load", record_id: LOAD, subject: "Load L-20481", member_ids: [BEN], ...over });

describe("POST /api/chat/about", () => {
  it("makes the group with the caller's org and user from the token, and answers its id", async () => {
    const res = await post(create());
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({ thread_id: THREAD });
    expect(args("chat_create_about")).toEqual([{ p_org: ORG, p_actor: USER, p_thread_id: THREAD, p_subject: "Load L-20481", p_members: [BEN], p_kind: "load", p_record: LOAD }]);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("refuses a kind there is no such thing as, and a bad id, before the database is asked", async () => {
    expect((await post(create({ kind: "case" }))).status).toBe(400);
    expect((await post(create({ record_id: "L-20481" }))).status).toBe(400);
    expect((await post(create({ member_ids: [] }))).status).toBe(400);
    expect(args("chat_create_about")).toEqual([]);
  });

  it("a record of another organisation is a 404 (the database's CH016)", async () => {
    rpc.chat_create_about = { error: { code: "CH016", message: "that record is not in this organisation" } };
    const res = await post(create());
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe("record_not_found");
  });

  it("about a driver needs roster view: a dispatcher without it is refused, and nothing is asked", async () => {
    me = { ...me, role: "dispatcher", sections: { roster: "none" } as AuthContext["sections"] };
    const res = await post(create({ kind: "driver", record_id: DRIVER }));
    expect(res.status).toBe(403);
    expect(args("chat_create_about")).toEqual([]);
    // ...while a load needs only chat.
    expect((await post(create())).status).toBe(201);
  });
});

describe("GET /api/chat/about/:kind/:recordId", () => {
  it("lists the caller's own conversations about the record, numbers parsed", async () => {
    const res = await call(`/about/load/${LOAD}`);
    expect(res.status).toBe(200);
    expect((await json(res)).conversations).toEqual([{ ...conv, unread: 2, member_count: 3 }]);
    expect(args("chat_about")).toEqual([{ p_org: ORG, p_user: USER, p_kind: "load", p_record: LOAD }]);
  });

  it("refuses an unknown kind or a bad id with a 404, and a driver without roster view with a 403", async () => {
    expect((await call(`/about/case/${LOAD}`)).status).toBe(404);
    expect((await call("/about/load/L-20481")).status).toBe(404);
    me = { ...me, role: "dispatcher", sections: { roster: "none" } as AuthContext["sections"] };
    expect((await call(`/about/driver/${DRIVER}`)).status).toBe(403);
    expect(args("chat_about")).toEqual([]);
  });
});

describe("GET /api/chat/:id/about", () => {
  it("says what the conversation is about, or null", async () => {
    expect(await json(await call(`/${THREAD}/about`))).toEqual({ about: { kind: "load", record_id: LOAD, label: "L-20481" } });
    rpc.chat_thread_about = [];
    expect(await json(await call(`/${THREAD}/about`))).toEqual({ about: null });
    expect(args("chat_thread_about")[0]).toEqual({ p_org: ORG, p_user: USER, p_thread: THREAD });
  });

  it("an id that is not one is a 404, before the database is asked", async () => {
    expect((await call("/not-an-id/about")).status).toBe(404);
    expect(args("chat_thread_about")).toEqual([]);
  });

  it("a conversation the caller is not in is a 404 (CH001)", async () => {
    rpc.chat_thread_about = { error: { code: "CH001", message: "not in that conversation" } };
    expect((await call(`/${THREAD}/about`)).status).toBe(404);
  });

  it("stands behind the chat's gates: a driver is refused", async () => {
    me = { ...me, role: "driver" };
    expect((await call(`/${THREAD}/about`)).status).toBe(403);
    expect((await post(create())).status).toBe(403);
    expect(holder.rec!.rpcs().filter((c) => c.fn.startsWith("chat_"))).toEqual([]);
  });
});

describe("the driver gate is the driver page's own", () => {
  it("GET /api/drivers/:id is gated by roster view, which is what CHAT_ABOUT_READ_SECTION.driver says", () => {
    const src = readFileSync(fileURLToPath(new URL("../../roster/routes/drivers.ts", import.meta.url)), "utf8");
    expect(src).toMatch(/const canView = requireSection\("roster", "view"\);/);
    expect(src).toMatch(/"\/:id",\s*requireOrg,\s*canView,/);
    expect(CHAT_ABOUT_READ_SECTION).toEqual({ load: null, driver: "roster", vehicle: null });
  });
});
