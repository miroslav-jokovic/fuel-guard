import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * CH8's route (0542's rules — what a person may find and how words match — run in
 * `supabase/tests/office-chat-search.test.mjs`). What this holds the route to: the caller's org and user
 * come from the token and nowhere else; the search, the conversation and the cursor reach the database
 * as given, or are refused before it is asked; a conversation the caller is not in is a 404; a full page
 * says where the next one starts; and the chat's own gates stand in front of it.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "11111111-1111-4111-8111-111111111111";
const THREAD = "33333333-3333-4333-8333-333333333333";
const LINE = (n: number) => ({
  id: `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`,
  thread_id: THREAD, kind: "group", subject: "Night desk", space_id: null, parent_id: null, seq: n,
  sender_user_id: USER, sender_name: "Ana Petrović", body: `Truck 702 is loaded ${n}`,
  created_at: `2026-11-02T1${n}:00:00Z`,
});

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
let me: AuthContext = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
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

beforeEach(() => {
  me = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
  rpc = { org_module_enabled: true, chat_search: [LINE(2), LINE(1)] };
  holder.rec = createSupabaseRecorder({ rpc: (fn) => rpc[fn] });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();
const get = (qs: string) => fetch(`${baseUrl}/api/chat/search?${qs}`, { headers: { Authorization: "Bearer token" } });
const searchArgs = () => holder.rec!.rpcs().filter((c) => c.fn === "chat_search").map((c) => c.args);

describe("GET /api/chat/search", () => {
  it("asks chat_search with the caller's org and user from the token, and answers its lines", async () => {
    const res = await get("q=truck%20702");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.items.map((l: { seq: number }) => l.seq)).toEqual([2, 1]);
    expect(body.items[0]).toMatchObject({ thread_id: THREAD, kind: "group", body: "Truck 702 is loaded 2" });
    expect(searchArgs()).toEqual([{ p_org: ORG, p_user: USER, p_q: "truck 702", p_thread: null, p_before_at: null, p_before_id: null, p_limit: 25 }]);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("a short page says there is no next one; a full page says where the next starts", async () => {
    expect((await json(await get("q=truck"))).next).toBeNull();
    rpc.chat_search = [LINE(3), LINE(2)];
    const body = await json(await get("q=truck&limit=2"));
    expect(body.next).toEqual({ before_at: LINE(2).created_at, before_id: LINE(2).id });
  });

  it("keeps the search to one conversation when asked, and passes the cursor back as given", async () => {
    await get(`q=truck&thread=${THREAD}&before_at=${encodeURIComponent(LINE(2).created_at)}&before_id=${LINE(2).id}`);
    expect(searchArgs()[0]).toMatchObject({ p_thread: THREAD, p_before_at: LINE(2).created_at, p_before_id: LINE(2).id });
  });

  it("a conversation the caller is not in is a 404 (the database's CH001)", async () => {
    rpc.chat_search = { error: { code: "CH001", message: "not in that conversation" } };
    const res = await get(`q=truck&thread=${THREAD}`);
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe("not_found");
  });

  it("refuses before asking the database: a thread that is not an id, half a cursor, a bad instant, a search past 200", async () => {
    expect((await get("q=truck&thread=search")).status).toBe(404);
    expect((await get(`q=truck&before_at=${encodeURIComponent(LINE(2).created_at)}`)).status).toBe(400);
    expect((await get(`q=truck&before_id=${LINE(2).id}`)).status).toBe(400);
    expect((await get(`q=truck&before_at=yesterday&before_id=${LINE(2).id}`)).status).toBe(400);
    expect((await get(`q=${"a".repeat(201)}`)).status).toBe(422);
    expect(searchArgs()).toEqual([]);
    expect((await get(`q=${"a".repeat(200)}`)).status).toBe(200);
  });

  it("a search of no words is still the database's to answer (it answers nothing)", async () => {
    rpc.chat_search = [];
    const body = await json(await get("q="));
    expect(body).toEqual({ items: [], next: null });
    expect(searchArgs()[0]).toMatchObject({ p_q: "" });
  });

  it("stands behind the chat's gates: a driver is refused and the database is never asked", async () => {
    me = { ...me, role: "driver" };
    expect((await get("q=truck")).status).toBe(403);
    expect(searchArgs()).toEqual([]);
  });

  it("is not read as a conversation called 'search' by the conversation router", async () => {
    const res = await get("q=truck");
    expect(res.status).toBe(200);
    expect(holder.rec!.rpcs().map((c) => c.fn)).not.toContain("chat_history");
  });

});

describe("POST /api/chat/links (Q-CHATUI6, 0547)", () => {
  const M1 = "55555555-5555-4555-8555-000000000001";
  const LOAD = "66666666-6666-4666-8666-000000000001";
  const post = (body: unknown) => fetch(`${baseUrl}/api/chat/links`, { method: "POST", body: JSON.stringify(body), headers: { Authorization: "Bearer token", "Content-Type": "application/json" } });
  const linkArgs = () => holder.rec!.rpcs().filter((c) => c.fn === "chat_line_links").map((c) => c.args);

  it("asks chat_line_links with the caller's org and user from the token, and answers the words and records", async () => {
    rpc.chat_line_links = [{ message_id: M1, text: "0137581", kind: "load", record_id: LOAD }];
    const res = await post({ message_ids: [M1] });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ links: [{ message_id: M1, text: "0137581", kind: "load", record_id: LOAD }] });
    expect(linkArgs()).toEqual([{ p_org: ORG, p_user: USER, p_messages: [M1] }]);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("refuses no ids, more than 200, or an id that is not one, before the database is asked", async () => {
    expect((await post({ message_ids: [] })).status).toBe(400);
    expect((await post({ message_ids: Array.from({ length: 201 }, () => M1) })).status).toBe(400);
    expect((await post({ message_ids: ["0137581"] })).status).toBe(400);
    expect(linkArgs()).toEqual([]);
    expect((await post({ message_ids: Array.from({ length: 200 }, () => M1) })).status).toBe(200);
  });

  it("stands behind the chat's gates: a driver is refused", async () => {
    me = { ...me, role: "driver" };
    expect((await post({ message_ids: [M1] })).status).toBe(403);
    expect(linkArgs()).toEqual([]);
  });
});
