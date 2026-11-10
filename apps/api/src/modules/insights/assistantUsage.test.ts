import { describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { assistantLogLine, monthStartInstant, readAssistantBudget, recordAssistantAnswer } from "./assistantUsage.js";

/** Ask AI's meter (F21 R2): the cap's month is the carrier's, the gate fails open, the record never throws. */
const ORG = "org-1";
const USAGE = { model: "claude-haiku-5-5", rounds: 1, inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5, costMicroUsd: 3.6 };

describe("monthStartInstant", () => {
  it("is the first instant of the carrier's month: 10:00 pm Central on 10/31 is still October", () => {
    expect(monthStartInstant(new Date("2026-11-01T03:00:00Z"), "America/Chicago")).toBe("2026-10-01T05:00:00.000Z");
    expect(monthStartInstant(new Date("2026-11-10T15:00:00Z"), "America/Chicago")).toBe("2026-11-01T05:00:00.000Z");
  });
});

describe("readAssistantBudget", () => {
  it("sums the ledger from the carrier's month start, scoped to the org", async () => {
    const rec = createSupabaseRecorder({
      tables: { organizations: [{ operating_hours: { tz: "America/Chicago" } }], org_usage_month: [], anomaly_thresholds: [] },
      rpc: () => [{ cost_micro_usd: "1500000", answers: 4 }],
    });
    const v = await readAssistantBudget(rec.client, ORG, new Date("2026-11-10T15:00:00Z"));
    expect(v).toEqual({ open: true, spentMicroUsd: 1_500_000, capMicroUsd: 50_000_000 });
    expect(rec.rpcs()).toEqual([{ fn: "assistant_month_spend", args: { p_org: ORG, p_since: "2026-11-01T05:00:00.000Z" } }]);
    expectOrgScoped(rec, ORG);
  });

  it("fails open, logged, when the meter cannot be read", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const rec = createSupabaseRecorder({ tables: { organizations: [] }, rpc: () => ({ data: null, error: { message: "function assistant_month_spend does not exist" } }) });
    expect((await readAssistantBudget(rec.client, ORG, new Date())).open).toBe(true);
    expect(err.mock.calls[0]![0]).toMatch(/budget check failed, answering anyway: assistant_month_spend: function assistant_month_spend does not exist/);
    err.mockRestore();
  });
});

describe("recordAssistantAnswer and the log line", () => {
  it("never throws when the record fails, and says so in the log", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const rec = createSupabaseRecorder({ rpc: () => ({ data: null, error: { message: "boom" } }) });
    await expect(recordAssistantAnswer(rec.client, { orgId: ORG, userId: "u1", usage: USAGE, latencyMs: 12.7, tools: [], outcome: "answered" })).resolves.toBeUndefined();
    expect(rec.rpcs()[0]!.args).toMatchObject({ p_cost_micro_usd: 4, p_latency_ms: 13 });
    expect(err.mock.calls[0]![0]).toBe("[ai] org org-1: usage not recorded: boom");
    err.mockRestore();
  });

  it("logs counts and cost, never text", () => {
    expect(assistantLogLine(ORG, USAGE, 2100, ["fuel_report"], "answered")).toBe(
      "[ai] org=org-1 model=claude-haiku-5-5 outcome=answered rounds=1 in=10 cache_read=0 cache_write=0 out=5 cost_usd=0.0000 ms=2100 tools=fuel_report",
    );
  });
});
