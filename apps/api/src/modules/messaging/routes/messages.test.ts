import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type RecordedQuery,
  type SupabaseRecorder,
} from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/messages` (Phase 5M, D54) serves DRIVER threads only. Office chat (D-CHAT1, 0511) keeps its
 * `direct` / `group` / `channel` conversations in the same three tables, and until 2026-11-04 this
 * router read every thread the caller was in: the dispatch inbox listed office DMs as driver
 * conversations, counted them in its badge, and a reply from that page posted into an office chat
 * around `/api/chat`'s rules. The world below is one dispatcher who is in one driver thread and one
 * office DM; every route must behave as if the DM were not there.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "11111111-1111-4111-8111-111111111111";
const DRIVER_USER = "22222222-2222-4222-8222-222222222222";
const PEER = "33333333-3333-4333-8333-333333333333";
const DRIVER_THREAD = "44444444-4444-4444-8444-444444444444";
const OFFICE_DM = "55555555-5555-4555-8555-555555555555";
const NEW_MESSAGE = "66666666-6666-4666-8666-666666666666";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

const me: AuthContext = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };

type Row = Record<string, unknown>;
const threads: Row[] = [
  { id: DRIVER_THREAD, org_id: ORG, kind: "driver", subject: "Load 1042", load_id: null, status: "open",
    last_message_at: "2026-11-03T15:00:00Z", created_at: "2026-11-03T14:00:00Z", loads: null },
  { id: OFFICE_DM, org_id: ORG, kind: "direct", subject: null, load_id: null, status: "open",
    last_message_at: "2026-11-03T16:00:00Z", created_at: "2026-11-03T16:00:00Z", loads: null },
];
const participants: Row[] = [
  { thread_id: DRIVER_THREAD, org_id: ORG, user_id: USER, role: "office", last_read_at: null },
  { thread_id: DRIVER_THREAD, org_id: ORG, user_id: DRIVER_USER, role: "driver", last_read_at: null },
  { thread_id: OFFICE_DM, org_id: ORG, user_id: USER, role: "office", last_read_at: null },
  { thread_id: OFFICE_DM, org_id: ORG, user_id: PEER, role: "office", last_read_at: null },
];
const messages: Row[] = [
  { id: "70000000-0000-4000-8000-000000000001", thread_id: DRIVER_THREAD, org_id: ORG, sender_user_id: DRIVER_USER,
    body: "At the shipper", created_at: "2026-11-03T15:00:00Z", edited_at: null, deleted_at: null },
  { id: "70000000-0000-4000-8000-000000000002", thread_id: OFFICE_DM, org_id: ORG, sender_user_id: PEER,
    body: "office only words", created_at: "2026-11-03T16:00:00Z", edited_at: null, deleted_at: null },
];

/**
 * The recorder does not filter, so this applies the query's own `eq` / `neq` / `in` filters the way
 * PostgREST would. Without it a service that forgot `kind = 'driver'` would still get only the rows
 * a test chose to hand it, and pass.
 */
const filtered = (rows: Row[]) => (q: RecordedQuery): Row[] =>
  rows.filter((r) =>
    q.ops.every((op) => {
      const [col, val] = op.args as [string, unknown];
      if (op.method === "eq") return r[col] === val;
      if (op.method === "neq") return r[col] !== val;
      if (op.method === "in") return (val as unknown[]).includes(r[col]);
      return true;
    }),
  );

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
  holder.rec = createSupabaseRecorder({
    rpc: (fn) =>
      ({ org_module_enabled: true, bump_driver_write_counter: [{ allowed: true }], emit_notification: [] })[fn] ?? null,
    tables: {
      message_threads: filtered(threads),
      thread_participants: filtered(participants),
      messages: filtered(messages),
      drivers: filtered([{ org_id: ORG, user_id: DRIVER_USER, full_name: "Dan Driver" }]),
    },
  });
});

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}/api/messages${path}`, {
    method,
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("/api/messages serves driver threads only", () => {
  it("the inbox lists the driver thread and not the office DM, and the DM's messages are never read", async () => {
    const res = await call("GET", "/");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { threads: Array<{ id: string; unread: number }>; unread_total: number };
    expect(json.threads.map((t) => t.id)).toEqual([DRIVER_THREAD]);
    expect(json.unread_total).toBe(1);
    const messageReads = holder.rec!.forTable("messages");
    expect(messageReads.flatMap((q) => q.filters().filter((f) => f.col === "thread_id").map((f) => f.val))).toEqual([
      [DRIVER_THREAD],
    ]);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("an office DM cannot be opened through the driver router", async () => {
    expect((await call("GET", `/${OFFICE_DM}`)).status).toBe(404);
    const ok = await call("GET", `/${DRIVER_THREAD}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { messages: Array<{ body: string }> }).messages.map((m) => m.body)).toEqual([
      "At the shipper",
    ]);
  });

  it("a reply into an office DM is refused with 404 and writes nothing", async () => {
    const res = await call("POST", `/${OFFICE_DM}/messages`, { message_id: NEW_MESSAGE, body: "hello" });
    expect(res.status).toBe(404);
    expect(holder.rec!.writes()).toEqual([]);
  });

  it("a reply into the driver thread is still posted", async () => {
    const res = await call("POST", `/${DRIVER_THREAD}/messages`, { message_id: NEW_MESSAGE, body: "hello" });
    expect(res.status).toBe(200);
    expect(holder.rec!.writtenRows("messages")).toEqual([
      expect.objectContaining({ id: NEW_MESSAGE, thread_id: DRIVER_THREAD, org_id: ORG, body: "hello" }),
    ]);
  });

  it("marking an office DM read is refused and leaves its read state alone", async () => {
    expect((await call("POST", `/${OFFICE_DM}/read`)).status).toBe(404);
    expect(holder.rec!.writes()).toEqual([]);
    expect((await call("POST", `/${DRIVER_THREAD}/read`)).status).toBe(200);
    expect(holder.rec!.writtenRows("thread_participants")).toHaveLength(1);
    expectOrgScoped(holder.rec!, ORG);
  });
});
