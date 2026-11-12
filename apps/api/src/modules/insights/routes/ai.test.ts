import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_MONTHLY_CAP_MICRO_USD, readAssistantEvents, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `POST /api/ai/ask` — the meter around the assistant (F21 R2): refused before the model when the month is
 * spent, and every answer recorded once, with its outcome, whether or not it succeeded.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  ANTHROPIC_API_KEY: "sk-test",
} as NodeJS.ProcessEnv);

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));
const askData = vi.hoisted(() => vi.fn());
vi.mock("../askData.js", () => ({ askData }));

const USAGE = { model: "claude-haiku-5-5", rounds: 2, inputTokens: 900, cacheReadTokens: 8000, cacheWriteTokens: 0, outputTokens: 300, costMicroUsd: 320.4 };

let server: Server;
let baseUrl = "";
let rec: SupabaseRecorder;

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => ({ userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => {
  vi.restoreAllMocks();
  await closeTestServer(server);
});
beforeEach(() => askData.mockReset());

function setup(spentMicroUsd: number, tokens = { used: 0, budget: null as number | null }, dispatch: boolean | "error" = false) {
  rec = createSupabaseRecorder({
    tables: {
      organizations: [{ operating_hours: { tz: "America/Chicago" } }],
      org_usage_month: tokens.used ? [{ input_tokens: tokens.used, output_tokens: 0 }] : [],
      anomaly_thresholds: tokens.budget == null ? [] : [{ ai_monthly_token_budget: tokens.budget }],
      memberships: [{ user_id: "u-admin", role: "admin" }],
    },
    rpc: (fn, args) => {
      if (fn === "org_module_enabled") {
        if (dispatch === "error") throw new Error("entitlement read failed");
        return (args as { p_module: string }).p_module === "dispatch" ? dispatch : false;
      }
      return fn === "assistant_month_spend" ? [{ cost_micro_usd: spentMicroUsd, answers: 3 }] : fn === "emit_notification" ? "n-1" : "row-id";
    },
  });
  holder.client = rec.client;
}
const post = (question: string) =>
  fetch(`${baseUrl}/api/ai/ask`, { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify({ question }) });
const audit = () => rec.writtenRows("audit_logs").find((r) => r.action === "ai.ask") as { meta: Record<string, unknown> } | undefined;

describe("POST /api/ai/ask — the conversation (F21 R3a)", () => {
  const postWith = (body: unknown) =>
    fetch(`${baseUrl}/api/ai/ask`, { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body) });
  const answered = () => askData.mockResolvedValueOnce({ answer: "ok", tools: [], usage: USAGE, outcome: "answered" });

  it("hands askData the earlier turns, trimmed by the shared rule, and counts them on the audit row", async () => {
    setup(0);
    answered();
    const history = [{ question: "mpg on 748 last month", answer: "6.4" }, { question: "bad" }, { question: "and 751?", answer: "6.9" }];
    expect((await postWith({ question: "and the month before?", history })).status).toBe(200);
    expect(askData.mock.calls[0]![6]).toEqual([
      { question: "mpg on 748 last month", answer: "6.4" },
      { question: "and 751?", answer: "6.9" },
    ]);
    expect(audit()?.meta).toMatchObject({ question: "and the month before?", history_turns: 2 });
  });

  it("an older web that sends the question alone, or a history that is not a list, asks with none", async () => {
    setup(0);
    answered();
    answered();
    await postWith({ question: "mpg on 748" });
    await postWith({ question: "mpg on 748", history: "and 751?" });
    expect(askData.mock.calls.map((c) => c[6])).toEqual([[], []]);
  });
});

describe("POST /api/ai/ask — the meter", () => {
  it("answers under the cap, records one ledger row and keeps the outcome and cost on the audit row", async () => {
    setup(1_000_000);
    const link = { surfaceKey: "fuel.spend", query: { from: "2026-10-01", to: "2026-10-31", trucks: "v748" } };
    askData.mockResolvedValueOnce({ answer: "Unit 748 ran 6.4 MPG.", tools: [{ name: "fuel_report", input: {} }], usage: USAGE, outcome: "answered", links: [link] });
    const res = await post("mpg on 748 last month");
    expect(res.status).toBe(200);
    // R4a: the page behind the answer travels with it, as a surface key; R4b: with the answer's filters.
    expect(await res.json()).toEqual({ answer: "Unit 748 ran 6.4 MPG.", pages: ["fuel.spend"], links: [link] });
    // The link's vehicle ids are for the browser, not the audit record of what was asked and said.
    expect(JSON.stringify(audit()?.meta)).not.toContain("v748");
    const records = rec.rpcs().filter((c) => c.fn === "record_assistant_answer");
    expect(records).toHaveLength(1);
    expect(records[0]!.args).toMatchObject({
      p_org: ORG, p_user: "u-admin", p_model: "claude-haiku-5-5", p_rounds: 2, p_input_tokens: 900, p_cache_read_tokens: 8000,
      p_output_tokens: 300, p_cost_micro_usd: 320, p_tools: ["fuel_report"], p_outcome: "answered",
    });
    expect(audit()?.meta).toMatchObject({ question: "mpg on 748 last month", outcome: "answered", cost_micro_usd: 320 });
    expectOrgScoped(rec, ORG);
  });

  it("rings the 80% bell on the answer that carries the month past $40, and not on one that does not (R2b)", async () => {
    setup(39_999_900);
    askData.mockResolvedValueOnce({ answer: "ok", tools: [], usage: USAGE, outcome: "answered" });
    expect((await post("q")).status).toBe(200);
    expect(rec.rpcs().filter((c) => c.fn === "emit_notification").map((c) => (c.args as { p_dedupe_key: string }).p_dedupe_key))
      .toEqual([expect.stringMatching(new RegExp(`^ai_assistant_budget:warn:${ORG}:\\d{4}-\\d{2}$`))]);
    setup(1_000_000);
    askData.mockResolvedValueOnce({ answer: "ok", tools: [], usage: USAGE, outcome: "answered" });
    await post("q");
    expect(rec.rpcs().some((c) => c.fn === "emit_notification")).toBe(false);
  });

  it("refuses with 429 at the $50 cap without reaching the model, and records nothing", async () => {
    setup(ASSISTANT_MONTHLY_CAP_MICRO_USD);
    const res = await post("fuel spend last month");
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ai_budget_exhausted");
    expect(askData).not.toHaveBeenCalled();
    expect(rec.rpcs().some((c) => c.fn === "record_assistant_answer")).toBe(false);
  });

  it("refuses when the carrier's own monthly token limit is used up", async () => {
    setup(0, { used: 5000, budget: 5000 });
    const res = await post("fuel spend last month");
    expect(res.status).toBe(429);
    expect(askData).not.toHaveBeenCalled();
  });

  it("a model failure is a 503 the composer can retry — and what it spent is still recorded", async () => {
    setup(0);
    askData.mockResolvedValueOnce({ answer: "The assistant could not answer just now. Try again in a minute.", tools: [], usage: { ...USAGE, rounds: 1 }, outcome: "error" });
    const res = await post("fuel spend last month");
    expect(res.status).toBe(503);
    expect(rec.rpcs().find((c) => c.fn === "record_assistant_answer")!.args).toMatchObject({ p_outcome: "error", p_rounds: 1 });
    expect(audit()?.meta).toMatchObject({ outcome: "error" });
  });
});

/**
 * F21 R6b: a dispatch tool reaches the model only when the carrier bought Dispatch, read through the
 * same `org_module_enabled` its page's `requireModule` asks. A failed read withholds the module tools
 * and nothing else.
 */
describe("POST /api/ai/ask — module-gated tools", () => {
  const allowedOf = () => askData.mock.calls[0]![4] as string[];
  const answered = () => askData.mockResolvedValueOnce({ answer: "ok", tools: [], usage: USAGE, outcome: "answered" });

  it("withholds fleet_now from a carrier without Dispatch, and keeps every other tool", async () => {
    setup(0);
    answered();
    expect((await post("how many are moving")).status).toBe(200);
    expect(allowedOf()).not.toContain("fleet_now");
    expect(allowedOf()).toContain("fuel_report");
  });

  it("gives fleet_now to a carrier that bought Dispatch", async () => {
    setup(0, undefined, true);
    answered();
    expect((await post("how many are moving")).status).toBe(200);
    expect(allowedOf()).toContain("fleet_now");
    expect(rec.rpcs().find((c) => c.fn === "org_module_enabled")!.args).toEqual({ p_org: ORG, p_module: "dispatch" });
  });

  it("a failed entitlement read withholds only the module tools; the question is still answered", async () => {
    setup(0, undefined, "error");
    answered();
    expect((await post("fuel last month")).status).toBe(200);
    expect(allowedOf()).not.toContain("fleet_now");
    expect(allowedOf()).toContain("fuel_report");
  });
});

describe("POST /api/ai/ask — the streamed answer (F21 Step 2d)", () => {
  const postStream = (question: string) =>
    fetch(`${baseUrl}/api/ai/ask`, {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json", accept: "text/event-stream", "accept-encoding": "gzip, deflate, br" },
      body: JSON.stringify({ question }),
    });

  it("sends each event the moment it happens, through the app's compression: the answer waits on the reader having seen the first", async () => {
    setup(0);
    let release!: () => void;
    const reached = new Promise<void>((r) => (release = r));
    askData.mockImplementationOnce(async (...a: unknown[]) => {
      const onEvent = a[7] as (e: unknown) => void;
      onEvent({ type: "step", label: "Reading the fuel report" });
      // Held until the test has READ that step off the wire. A buffered stream never delivers it,
      // so this answer never finishes and the test times out.
      await reached;
      onEvent({ type: "text", delta: "Spend was $41,200." });
      return { answer: "Spend was $41,200.", tools: [{ name: "fuel_report", input: {} }], usage: USAGE, outcome: "answered", links: [] };
    });
    const res = await postStream("fuel spend last month");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(res.headers.get("content-encoding")).toBeNull();
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const seen: Array<{ type: string }> = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const read = readAssistantEvents(buffer + decoder.decode(value, { stream: true }));
      buffer = read.rest;
      for (const e of read.events) {
        seen.push(e);
        if (e.type === "step") release();
      }
    }
    expect(seen).toEqual([
      { type: "step", label: "Reading the fuel report" },
      { type: "text", delta: "Spend was $41,200." },
      { type: "done", answer: "Spend was $41,200.", pages: ["fuel.spend"], links: [] },
    ]);
    // The meter and the audit row are the same as the JSON answer's.
    expect(rec.rpcs().filter((c) => c.fn === "record_assistant_answer")).toHaveLength(1);
    expect(audit()?.meta.outcome).toBe("answered");
  });

  it("a model failure after the stream began ends it with an error event, and what it spent is still recorded", async () => {
    setup(0);
    askData.mockResolvedValueOnce({ answer: "The assistant could not answer just now. Try again in a minute.", tools: [], usage: USAGE, outcome: "error", links: [] });
    const res = await postStream("fuel spend");
    expect(res.status).toBe(200);
    expect(readAssistantEvents(await res.text()).events).toEqual([{ type: "error", message: "The assistant could not answer just now. Try again in a minute." }]);
    expect(rec.rpcs().filter((c) => c.fn === "record_assistant_answer")).toHaveLength(1);
  });

  it("a refusal before the model is reached is still a JSON status, never a stream", async () => {
    setup(ASSISTANT_MONTHLY_CAP_MICRO_USD);
    const res = await postStream("fuel spend");
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ai_budget_exhausted");
    expect(askData).not.toHaveBeenCalled();
  });

  it("without the stream header the answer is JSON, as an older web expects, and askData is given no listener", async () => {
    setup(0);
    askData.mockResolvedValueOnce({ answer: "ok", tools: [], usage: USAGE, outcome: "answered", links: [] });
    const res = await post("fuel spend");
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(((await res.json()) as { answer: string }).answer).toBe("ok");
    expect(askData.mock.calls[0]![7]).toBeUndefined();
  });
});
