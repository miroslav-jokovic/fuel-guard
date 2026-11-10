import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_MONTHLY_CAP_MICRO_USD, type AuthContext } from "@silvicom/shared";
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

function setup(spentMicroUsd: number, tokens = { used: 0, budget: null as number | null }) {
  rec = createSupabaseRecorder({
    tables: {
      organizations: [{ operating_hours: { tz: "America/Chicago" } }],
      org_usage_month: tokens.used ? [{ input_tokens: tokens.used, output_tokens: 0 }] : [],
      anomaly_thresholds: tokens.budget == null ? [] : [{ ai_monthly_token_budget: tokens.budget }],
    },
    rpc: (fn) => (fn === "assistant_month_spend" ? [{ cost_micro_usd: spentMicroUsd, answers: 3 }] : "row-id"),
  });
  holder.client = rec.client;
}
const post = (question: string) =>
  fetch(`${baseUrl}/api/ai/ask`, { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify({ question }) });
const audit = () => rec.writtenRows("audit_logs").find((r) => r.action === "ai.ask") as { meta: Record<string, unknown> } | undefined;

describe("POST /api/ai/ask — the meter", () => {
  it("answers under the cap, records one ledger row and keeps the outcome and cost on the audit row", async () => {
    setup(1_000_000);
    askData.mockResolvedValueOnce({ answer: "Unit 748 ran 6.4 MPG.", tools: [{ name: "fuel_report", input: {} }], usage: USAGE, outcome: "answered" });
    const res = await post("mpg on 748 last month");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: "Unit 748 ran 6.4 MPG." });
    const records = rec.rpcs().filter((c) => c.fn === "record_assistant_answer");
    expect(records).toHaveLength(1);
    expect(records[0]!.args).toMatchObject({
      p_org: ORG, p_user: "u-admin", p_model: "claude-haiku-5-5", p_rounds: 2, p_input_tokens: 900, p_cache_read_tokens: 8000,
      p_output_tokens: 300, p_cost_micro_usd: 320, p_tools: ["fuel_report"], p_outcome: "answered",
    });
    expect(audit()?.meta).toMatchObject({ question: "mpg on 748 last month", outcome: "answered", cost_micro_usd: 320 });
    expectOrgScoped(rec, ORG);
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
