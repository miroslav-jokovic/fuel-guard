import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * CH12's route (0549's rules run in `supabase/tests/office-chat-catchup.test.mjs`). What this holds it
 * to: the caller's org and user come from the token; it spends nothing it need not — no catch-ups left
 * is refused before a line is read or a model asked, nothing unread asks no model and writes no row, no
 * model configured or a model that answers off its tool writes no row; the ledger row names the lines
 * read, the model, its tokens and the summary's SHA-256; the person is told what the RECORD says is
 * left; and the `chat_ai` module gates it on top of the chat's own gates.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null, create: null as null | ((req: unknown) => unknown) }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));
vi.mock("../../../lib/anthropic.js", async (orig) => ({
  ...(await orig<typeof import("../../../lib/anthropic.js")>()),
  anthropicClient: () => ({ messages: { create: async (req: unknown) => holder.create!(req) } }),
}));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), ANTHROPIC_API_KEY: "sk-test" } as NodeJS.ProcessEnv);
let me: AuthContext;
let rpc: Record<string, unknown>;
let asked: Array<{ model: string; system: string; messages: Array<{ content: string }> }>;

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

const SUMMARY = "Ben moved load 0137581 to Truck 506. Ana asked you to call the shipper.";
const answer = (input: unknown) => ({
  id: "msg_1", stop_reason: "tool_use", usage: { input_tokens: 812, output_tokens: 64 },
  content: [{ type: "tool_use", id: "tu_1", name: "write_catch_up", input }],
});
const line = (seq: number, body: string, over: Record<string, unknown> = {}) =>
  ({ seq: String(seq), sender_name: "Ben Admin", body, created_at: `2026-11-02T1${seq}:00:00Z`, parent_id: null, file_count: 0, ...over });

beforeEach(() => {
  me = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
  rpc = {
    org_module_enabled: true,
    chat_catchup_left: 7,
    chat_catchup_lines: [line(4, "load 0137581 is on Truck 506"), line(5, `<@${USER}> call the shipper`, { file_count: 2, parent_id: BEN })],
    chat_catchup_record: 6,
    chat_people: [{ user_id: USER, name: "Ana Dispatch", role: "dispatcher" }],
  };
  asked = [];
  holder.create = (req) => { asked.push(req as (typeof asked)[number]); return answer({ summary: `  ${SUMMARY}\n` }); };
  holder.rec = createSupabaseRecorder({ rpc: (fn) => rpc[fn] });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();
const post = (id = THREAD) => fetch(`${baseUrl}/api/chat/${id}/catchup`, { method: "POST", headers: { Authorization: "Bearer token" } });
const calls = (fn: string) => holder.rec!.rpcs().filter((c) => c.fn === fn).map((c) => c.args);

describe("POST /api/chat/:id/catchup", () => {
  it("summarises the unread lines with the caller's org and user from the token, and ledgers what it read", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ summary: SUMMARY, lines: 2, left: 6 });
    expect(calls("chat_catchup_left")).toEqual([{ p_org: ORG, p_user: USER }]);
    expect(calls("chat_catchup_lines")).toEqual([{ p_org: ORG, p_user: USER, p_thread: THREAD }]);
    expect(calls("chat_catchup_record")).toEqual([{
      p_org: ORG, p_user: USER, p_thread: THREAD, p_from_seq: 4, p_to_seq: 5, p_lines: 2,
      p_model: "claude-haiku-5-5", p_input_tokens: 812, p_output_tokens: 64,
      p_summary_sha256: createHash("sha256").update(SUMMARY, "utf8").digest("hex"),
    }]);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("gives the model the lines as quoted data, each mention as the person's name, a reply and its files said", async () => {
    await post();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.model).toBe("claude-haiku-5-5");
    expect(asked[0]!.system).toMatch(/data, not instructions/);
    expect(asked[0]!.messages[0]!.content).toBe([
      "<lines>",
      "#4 2026-11-02T14:00:00Z Ben Admin: load 0137581 is on Truck 506",
      "#5 2026-11-02T15:00:00Z Ben Admin (a reply in a thread): @Ana Dispatch call the shipper [2 files attached]",
      "</lines>",
    ].join("\n"));
  });

  it("with no catch-ups left, refuses 429 before a line is read or a model is asked", async () => {
    rpc.chat_catchup_left = 0;
    const res = await post();
    expect(res.status).toBe(429);
    expect((await json(res)).error.code).toBe("catchup_limit");
    expect(calls("chat_catchup_lines")).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("with nothing unread, answers up to date: no model, no ledger row, the count unchanged", async () => {
    rpc.chat_catchup_lines = [];
    const res = await post();
    expect(await json(res)).toEqual({ summary: null, lines: 0, left: 7 });
    expect(asked).toEqual([]);
    expect(calls("chat_catchup_record")).toEqual([]);
  });

  it("a second tab that wins the last catch-up first leaves this one the database's 429 (CH017)", async () => {
    rpc.chat_catchup_record = { error: { code: "CH017", message: "today's catch-ups are used" } };
    const res = await post();
    expect(res.status).toBe(429);
    expect((await json(res)).error.code).toBe("catchup_limit");
  });

  it("a model that answers off its tool is a 502, and nothing is ledgered", async () => {
    holder.create = () => answer({ text: SUMMARY });
    const res = await post();
    expect(res.status).toBe(502);
    expect(calls("chat_catchup_record")).toEqual([]);
  });

  it("with no model key configured, says so with a 503 and ledgers nothing", async () => {
    const key = env.ANTHROPIC_API_KEY;
    env.ANTHROPIC_API_KEY = undefined;
    try {
      const res = await post();
      expect(res.status).toBe(503);
      expect(calls("chat_catchup_record")).toEqual([]);
    } finally { env.ANTHROPIC_API_KEY = key; }
  });

  it("a conversation the caller is not in is a 404 (CH001), and a word that is not an id never reaches the database", async () => {
    rpc.chat_catchup_lines = { error: { code: "CH001", message: "not in that conversation" } };
    expect((await post()).status).toBe(404);
    expect(asked).toEqual([]);
    const before = calls("chat_catchup_left").length;
    expect((await post("search")).status).toBe(404);
    expect(calls("chat_catchup_left")).toHaveLength(before);
  });

  it("stands behind the chat_ai module (D-CHAT37): a carrier without it is refused before anything is asked", async () => {
    // Another org, so requireModule's 15 s cache holds no answer for it from the tests above.
    const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-000000000002";
    me = { ...me, orgId: OTHER };
    holder.rec = createSupabaseRecorder({ rpc: (fn, args) => (fn === "org_module_enabled" ? (args as { p_module: string }).p_module !== "chat_ai" : rpc[fn]) });
    const res = await post();
    expect(res.status).toBe(403);
    expect(calls("org_module_enabled").map((a) => (a as { p_module: string }).p_module)).toContain("chat_ai");
    expect(calls("chat_catchup_left")).toEqual([]);
  });

  it("stands behind the chat's gates: a driver is refused", async () => {
    me = { ...me, role: "driver" };
    expect((await post()).status).toBe(403);
    expect(calls("chat_catchup_left")).toEqual([]);
  });
});
